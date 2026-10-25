// Durable state for dsh-lane-bridge.
//
// One JSON document owns the operational model (channels, domains, bindings,
// conversations, sessions). It is written atomically and updated through a
// serialized queue, because inbound messages, the Settings card, and the push
// API can all write concurrently.
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultConfig,
  defaultDomain,
  defaultState,
  sampleKnowledge,
  sampleRoleCard,
  STATE_VERSION,
} from './defaults.js';

const ROLE_EXT = '.md';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-merge plain objects; arrays and scalars replace. */
export function mergeDeep(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isObject(value) && isObject(base[key]) ? mergeDeep(base[key], value) : value;
  }
  return out;
}

/** Keep an existing secret when the editor submits a blank/placeholder value. */
export function isSecretPlaceholder(value) {
  return value === undefined || value === null || value === '' || value === '••••••••' || value === '__keep__';
}

export function mergeConfig(previous, patch) {
  const next = mergeDeep(previous, patch ?? {});
  const prevChannels = previous?.channels ?? {};
  const nextChannels = next.channels ?? {};
  for (const channel of Object.keys(prevChannels)) {
    const prev = prevChannels[channel] ?? {};
    const current = nextChannels[channel] ?? {};
    for (const key of Object.keys(current)) {
      if (!/(token|secret|appSecret|accessToken)$/iu.test(key)) continue;
      if (isSecretPlaceholder(current[key])) current[key] = prev[key] ?? '';
    }
    nextChannels[channel] = current;
  }
  if (isSecretPlaceholder(next.pushToken)) next.pushToken = previous?.pushToken ?? '';
  next.channels = nextChannels;
  if (isSecretPlaceholder(next.github?.token)) {
    next.github = { ...(next.github ?? {}), token: previous?.github?.token ?? '' };
  }
  return next;
}

function normalizeRoleList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = String(item?.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    const content = String(item?.content ?? '');
    out.push({ name, content, updatedAt: Number(item?.updatedAt) || 0 });
    seen.add(name);
  }
  if (out.length === 0) out.push({ name: '客服', content: sampleRoleCard(), updatedAt: 0 });
  return out;
}

function normalizeDomainList(raw, defaultDomainId) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = String(item?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    out.push({
      id,
      name: String(item?.name ?? id).trim() || id,
      role: String(item?.role ?? '客服').trim(),
      preset: String(item?.preset ?? 'lane-support').trim() || 'lane-support',
      model: String(item?.model ?? '').trim(),
      knowledgeScopes: Array.isArray(item?.knowledgeScopes)
        ? [...new Set(item.knowledgeScopes.map((s) => String(s).trim()).filter(Boolean))]
        : ['default'],
      allowedHostTools: Array.isArray(item?.allowedHostTools)
        ? [...new Set(item.allowedHostTools.map((s) => String(s).trim()).filter(Boolean))]
        : [],
      autoReply: item?.autoReply !== false,
      trigger: ['all', 'mention', 'keyword', 'off'].includes(String(item?.trigger)) ? String(item.trigger) : 'all',
      keywords: Array.isArray(item?.keywords)
        ? [...new Set(item.keywords.map((word) => String(word).trim()).filter(Boolean))]
        : [],
      memoryEnabled: item?.memoryEnabled === true,
      memoryMaxChars: Math.max(200, Math.min(8000, Number(item?.memoryMaxChars) || 2000)),
      kbDraftEnabled: item?.kbDraftEnabled !== false,
      repoEnabled: item?.repoEnabled === true,
      systemPrompt: String(item?.systemPrompt ?? ''),
      maxReplyChars: Number(item?.maxReplyChars) > 0 ? Number(item.maxReplyChars) : 0,
    });
    seen.add(id);
  }
  if (out.length === 0) out.push(defaultDomain());
  if (!out.some((d) => d.id === defaultDomainId)) defaultDomainId = out[0].id;
  return { domains: out, defaultDomainId };
}

/** Sanitize an arbitrary object into the current state shape. */
export function normalizeState(raw) {
  const base = defaultState();
  const src = isObject(raw) ? raw : {};
  const config = mergeDeep(defaultConfig(), isObject(src.config) ? src.config : {});
  config.enabled = config.enabled !== false;
  config.autoReplyPrivate = config.autoReplyPrivate === true;
  config.autoReplyGroups = config.autoReplyGroups === true;
  config.pushToken = String(config.pushToken ?? '');
  config.defaultDomainId = String(config.defaultDomainId ?? 'default');
  config.reply = mergeDeep(base.config.reply, isObject(config.reply) ? config.reply : {});
  config.reply.maxChars = Math.max(200, Math.min(10000, Number(config.reply.maxChars) || 1500));
  config.reply.chunkDelayMs = Math.max(0, Math.min(10000, Number(config.reply.chunkDelayMs) || 0));
  config.reply.debounceMs = Math.max(0, Math.min(10000, Number(config.reply.debounceMs) || 0));
  config.reply.stripMarkdown = config.reply.stripMarkdown !== false;
  config.handoff = mergeDeep(base.config.handoff, isObject(config.handoff) ? config.handoff : {});
  config.handoff.enabled = config.handoff.enabled !== false;
  config.handoff.targetKey = String(config.handoff.targetKey ?? '').trim();
  config.handoff.ackMessage = String(config.handoff.ackMessage ?? '').slice(0, 500);
  config.media = mergeDeep(base.config.media, isObject(config.media) ? config.media : {});
  config.media.enabled = config.media.enabled !== false;
  config.media.maxBytes = Math.max(64 * 1024, Math.min(20 * 1024 * 1024, Number(config.media.maxBytes) || 8 * 1024 * 1024));
  config.media.maxCount = Math.max(0, Math.min(8, Number(config.media.maxCount) || 0));
  config.media.timeoutMs = Math.max(1000, Math.min(60000, Number(config.media.timeoutMs) || 15000));
  config.github = mergeDeep(base.config.github, isObject(config.github) ? config.github : {});
  config.github.enabled = config.github.enabled === true;
  config.github.repo = String(config.github.repo ?? '').trim().slice(0, 200);
  config.github.token = String(config.github.token ?? '');
  config.github.branch = String(config.github.branch ?? '').trim().slice(0, 120);
  config.github.allowCreateIssue = config.github.allowCreateIssue === true;
  config.github.issueLabel = String(config.github.issueLabel ?? 'agent').trim().slice(0, 40) || 'agent';
  config.github.maxCreatesPerHour = Math.max(0, Math.min(20, Number(config.github.maxCreatesPerHour) || 3));
  config.github.maxFileChars = Math.max(2000, Math.min(60000, Number(config.github.maxFileChars) || 20000));
  config.channels = mergeDeep(base.config.channels, isObject(config.channels) ? config.channels : {});

  const { domains, defaultDomainId } = normalizeDomainList(src.domains, config.defaultDomainId);
  config.defaultDomainId = defaultDomainId;

  const roles = normalizeRoleList(src.roles);
  const roleNames = new Set(roles.map((r) => r.name));

  const bindings = {};
  if (isObject(src.bindings)) {
    for (const [key, value] of Object.entries(src.bindings)) {
      if (!/^[^:]+:(group|private):.+$/u.test(key) || !isObject(value)) continue;
      const domainId = String(value.domainId ?? defaultDomainId);
      if (!domains.some((d) => d.id === domainId)) continue;
      bindings[key] = {
        domainId,
        enabled: value.enabled !== false,
        role: String(value.role ?? ''),
        preset: String(value.preset ?? ''),
        model: String(value.model ?? ''),
        note: String(value.note ?? ''),
        paused: value.paused === true,
        pauseReason: String(value.pauseReason ?? ''),
        pausedAt: Number(value.pausedAt) || 0,
        updatedAt: Number(value.updatedAt) || 0,
      };
    }
  }

  const conversations = {};
  if (isObject(src.conversations)) {
    for (const [key, value] of Object.entries(src.conversations)) {
      if (!/^[^:]+:(group|private):.+$/u.test(key) || !isObject(value)) continue;
      conversations[key] = {
        key,
        channel: String(value.channel ?? key.split(':')[0]),
        kind: value.kind === 'private' ? 'private' : 'group',
        externalId: String(value.externalId ?? key.split(':').slice(2).join(':')),
        name: String(value.name ?? ''),
        lastAt: Number(value.lastAt) || 0,
        lastText: String(value.lastText ?? '').slice(0, 500),
        replyToId: String(value.replyToId ?? ''),
        seenCount: Number(value.seenCount) || 0,
      };
    }
  }

  const sessions = {};
  if (isObject(src.sessions)) {
    for (const [key, value] of Object.entries(src.sessions)) {
      if (!/^[^:]+:(group|private):.+$/u.test(key) || !isObject(value)) continue;
      const sessionId = String(value.sessionId ?? '');
      if (!sessionId) continue;
      sessions[key] = {
        sessionId,
        role: String(value.role ?? ''),
        roleKey: String(value.roleKey ?? ''),
        preset: String(value.preset ?? ''),
        model: String(value.model ?? ''),
        updatedAt: Number(value.updatedAt) || 0,
      };
    }
  }

  // A domain may point at a role card that no longer exists; fall back to the
  // first role so a deleted role never breaks a live conversation.
  const fallbackRole = roles[0]?.name ?? '客服';
  for (const domain of domains) {
    if (!roleNames.has(domain.role)) domain.role = fallbackRole;
  }
  for (const binding of Object.values(bindings)) {
    if (binding.role && !roleNames.has(binding.role)) binding.role = '';
  }

  return {
    version: STATE_VERSION,
    revision: Number(src.revision) || 0,
    config,
    domains,
    roles,
    bindings,
    conversations,
    sessions,
  };
}

/** Return a browser-safe projection: secrets become presence flags. */
export function redactState(state) {
  const clone = JSON.parse(JSON.stringify(state));
  const secretStatus = {
    pushToken: Boolean(state?.config?.pushToken),
    snowlumaAccessToken: Boolean(state?.config?.channels?.snowluma?.accessToken),
    qqbotAppSecret: Boolean(state?.config?.channels?.qqbot?.appSecret),
    discordToken: Boolean(state?.config?.channels?.discord?.token),
    githubToken: Boolean(state?.config?.github?.token),
  };
  if (clone.config) {
    clone.config.pushToken = '';
    if (clone.config.channels?.snowluma) clone.config.channels.snowluma.accessToken = '';
    if (clone.config.channels?.qqbot) clone.config.channels.qqbot.appSecret = '';
    if (clone.config.channels?.discord) clone.config.channels.discord.token = '';
    if (clone.config.github) clone.config.github.token = '';
  }
  return { state: clone, secretStatus };
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows cannot rename over an existing file in some states.
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  }
}

function safeRoleFileName(name) {
  return String(name ?? '').replace(/[\\/:*?"<>|]/gu, '_').replace(/^\.+$/u, '_').slice(0, 80);
}

function readRoleFiles(rolesDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(rolesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(ROLE_EXT)) continue;
    const name = entry.name.slice(0, -ROLE_EXT.length);
    if (!name || name.startsWith('_')) continue;
    try {
      const content = fs.readFileSync(path.join(rolesDir, entry.name), 'utf8');
      out.push({ name, content, updatedAt: fs.statSync(path.join(rolesDir, entry.name)).mtimeMs });
    } catch {
      /* a single unreadable role must not break the plugin */
    }
  }
  return out;
}

export class LaneStore {
  /**
   * @param {object} options
   * @param {string} options.dataDir
   * @param {string} [options.logger]
   */
  constructor({ dataDir, logger = null }) {
    if (!dataDir) throw new TypeError('LaneStore requires dataDir');
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.rolesDir = path.join(dataDir, 'roles');
    this.knowledgeDir = path.join(dataDir, 'knowledge');
    this.logger = logger;
    this.state = null;
    this.queue = Promise.resolve();
  }

  get paths() {
    return { dataDir: this.dataDir, stateFile: this.file, rolesDir: this.rolesDir, knowledgeDir: this.knowledgeDir };
  }

  get() {
    if (!this.state) throw new Error('LaneStore.load() has not completed');
    return this.state;
  }

  async load() {
    fs.mkdirSync(this.rolesDir, { recursive: true });
    fs.mkdirSync(this.knowledgeDir, { recursive: true });
    for (const dir of [this.dataDir, this.rolesDir, this.knowledgeDir]) {
      try { fs.chmodSync(dir, 0o700); } catch { /* Windows ignores POSIX modes */ }
    }
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger?.warn?.(`[lane-bridge] state.json 读取失败，使用默认配置：${error?.message ?? error}`);
        // Never silently overwrite a corrupt document: keep a copy for forensics.
        try {
          const backup = `${this.file}.corrupt-${Date.now()}`;
          fs.copyFileSync(this.file, backup);
          this.logger?.warn?.(`[lane-bridge] 已备份损坏的 state.json 到 ${backup}`);
        } catch {}
      }
    }
    this.state = normalizeState(raw);

    // Role files are the durable editable copy; the state carries a cached
    // copy for the UI. Reconcile both directions on load.
    const fromDisk = readRoleFiles(this.rolesDir);
    if (fromDisk.length > 0) {
      this.state.roles = normalizeRoleList(fromDisk);
    } else {
      for (const role of this.state.roles) this.#writeRoleFile(role.name, role.content);
    }
    for (const role of this.state.roles) {
      const file = path.join(this.rolesDir, `${safeRoleFileName(role.name)}${ROLE_EXT}`);
      if (!fs.existsSync(file)) this.#writeRoleFile(role.name, role.content);
    }

    await this.#seedKnowledge();
    await this.save();
    return this.state;
  }

  async #seedKnowledge() {
    const hasAny = (() => {
      try {
        return fs.readdirSync(this.knowledgeDir, { withFileTypes: true }).some((e) => e.isDirectory());
      } catch {
        return false;
      }
    })();
    if (hasAny) return;
    for (const [rel, content] of Object.entries(sampleKnowledge())) {
      const file = path.join(this.knowledgeDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
  }

  #writeRoleFile(name, content) {
    fs.mkdirSync(this.rolesDir, { recursive: true });
    fs.writeFileSync(path.join(this.rolesDir, `${safeRoleFileName(name)}${ROLE_EXT}`), String(content ?? ''), 'utf8');
  }

  /** Serialize one mutation and persist the normalized result. */
  async update(mutator) {
    const run = async () => {
      const draft = JSON.parse(JSON.stringify(this.get()));
      const result = await mutator(draft);
      draft.revision = (Number(draft.revision) || 0) + 1;
      const next = normalizeState(draft);
      this.state = next;
      await this.save();
      return result;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async save() {
    atomicWrite(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  async setConfig(patch) {
    return this.update((draft) => {
      draft.config = mergeConfig(draft.config, patch);
      if (draft.config.defaultDomainId) {
        // keep the invariant when the editor renames/removes the default
        const exists = draft.domains.some((d) => d.id === draft.config.defaultDomainId);
        if (!exists) draft.config.defaultDomainId = draft.domains[0]?.id ?? 'default';
      }
    });
  }

  async setDomains(domains) {
    return this.update((draft) => {
      draft.domains = domains;
    });
  }

  async setRoles(roles) {
    return this.update((draft) => {
      const next = normalizeRoleList(roles);
      const previous = new Map(draft.roles.map((r) => [r.name, r]));
      draft.roles = next.map((role) => ({ ...role, updatedAt: role.updatedAt || Date.now() }));
      // Remove files for roles deleted by the editor; write changed ones.
      let existing = [];
      try {
        existing = fs.readdirSync(this.rolesDir).filter((f) => f.toLowerCase().endsWith(ROLE_EXT));
      } catch {}
      const keep = new Set(draft.roles.map((r) => `${safeRoleFileName(r.name)}${ROLE_EXT}`));
      for (const file of existing) {
        if (!keep.has(file)) fs.rmSync(path.join(this.rolesDir, file), { force: true });
      }
      for (const role of draft.roles) {
        const previousRole = previous.get(role.name);
        if (!previousRole || previousRole.content !== role.content) this.#writeRoleFile(role.name, role.content);
      }
    });
  }

  async setBindings(bindings) {
    return this.update((draft) => {
      draft.bindings = bindings;
    });
  }

  async upsertBinding(key, patch) {
    return this.update((draft) => {
      draft.bindings[key] = { ...(draft.bindings[key] ?? {}), ...patch, updatedAt: Date.now() };
    });
  }

  async deleteBinding(key) {
    return this.update((draft) => {
      delete draft.bindings[key];
    });
  }

  async touchConversation(conversation) {
    return this.update((draft) => {
      const current = draft.conversations[conversation.key] ?? {};
      draft.conversations[conversation.key] = {
        ...current,
        ...conversation,
        seenCount: (Number(current.seenCount) || 0) + 1,
      };
    });
  }

  async setSession(key, session) {
    return this.update((draft) => {
      if (session === null) delete draft.sessions[key];
      else draft.sessions[key] = { ...session, updatedAt: Date.now() };
    });
  }
}

export function defaultDataDir(homeDir) {
  return path.join(homeDir || process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh'), 'lane-bridge');
}
