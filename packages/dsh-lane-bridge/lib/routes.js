// Authenticated-ish HTTP boundary used by the Settings card and the push API.
//
// Browser writes are same-origin + custom-header guarded; external push uses a
// bearer token. The routes are mounted on DSH's own web server under
// `/lane-bridge`, so no second port or cookie jar exists.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  approveDraft,
  createKnowledgeBase,
  discardDraft,
  knowledgeBaseInfo,
  listDrafts,
  listKnowledge,
  listScopes,
  moveKnowledge,
  readKnowledge,
  removeKnowledgeBase,
  renameKnowledgeBase,
  writeKnowledge,
} from './knowledge.js';
import { redactState } from './store.js';
import { normalizeMessages, splitText, stripMarkdown } from './text.js';
import { channelKindOf, normalizeChannelId, normalizeOperators, parseConversationKey } from './defaults.js';

const PREFIX = '/lane-bridge';
const MAX_BODY = 2 * 1024 * 1024;
// Build identity the running host actually loaded. The settings page shows it,
// so "did the new version get loaded?" is answerable without guessing.
const VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '');
  } catch {
    return '';
  }
})();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function trustedOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === '' || origin === 'null' || origin === 'file://') return true; // desktop IPC / non-browser caller
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}


function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  return value;
}

export function createRoutes({ store, channels, pool, memoryStore = null, usageStore = null, repo = null, logger = null, listPresets = null }) {
  const knowledgeDir = store.paths.knowledgeDir;

  // Same-origin is the CSRF boundary. The custom header is sent by the
  // Settings card but is not required: the Desktop transport may carry fetch
  // over IPC without forwarding arbitrary headers.
  const canWriteFromBrowser = (req) => trustedOrigin(req);

  const canPush = (req) => {
    const token = String(store.get()?.config?.pushToken ?? '');
    const header = String(req.headers.authorization ?? '');
    if (token && header.startsWith('Bearer ') && safeEqual(header.slice(7), token)) return true;
    return canWriteFromBrowser(req);
  };

  async function handleState(req, res) {
    if (!trustedOrigin(req)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden' });
    }
    const { state, secretStatus } = redactState(store.get());
    sendJson(res, 200, {
      ok: true,
      version: 1,
      state,
      secretStatus,
      channels: channels.status(),
      github: repo?.status?.() ?? null,
      paths: { dataDir: store.paths.dataDir },
    });
  }

  async function handleConfig(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    if (!body || typeof body.config !== 'object' || body.config === null) {
      return sendJson(res, 400, { ok: false, error: 'config 必须是对象' });
    }
    const previous = store.get().config;
    const patch = { ...body.config };
    if (patch.channels && typeof patch.channels === 'object') {
      // Each entry is one bot. Unknown ids and kinds are dropped instead of
      // being persisted as half-configured ghosts; store.normalizeState does the
      // field-level sanitizing.
      const entries = {};
      for (const [rawId, entry] of Object.entries(patch.channels)) {
        if (!entry || typeof entry !== 'object') continue;
        const id = normalizeChannelId(rawId);
        if (!id || !channelKindOf(id, entry)) continue;
        entries[id] = entry;
      }
      patch.channels = entries;
    }
    await store.setConfig(patch);
    // Only restart the instances whose entry actually changed: saving one card
    // must not drop every other bot's connection.
    let changed = null;
    if (patch.channels) {
      const next = store.get().config.channels ?? {};
      changed = Object.keys(patch.channels).filter((id) => {
        const before = previous.channels?.[id];
        return !before || JSON.stringify(before) !== JSON.stringify(next[id]);
      });
      for (const id of Object.keys(previous.channels ?? {})) {
        if (!Object.hasOwn(next, id) && !changed.includes(id)) changed.push(id);
      }
    }
    const fullRestart = patch.enabled !== undefined && patch.enabled !== previous.enabled;
    if (fullRestart) {
      await channels.sync().catch((error) => logger?.warn?.(`[lane-bridge] 通道重启失败：${error?.message ?? error}`));
    } else if (changed && changed.length > 0) {
      await channels.sync(changed).catch((error) => logger?.warn?.(`[lane-bridge] 通道重启失败：${error?.message ?? error}`));
    }
    return handleState(req, res);
  }

  async function handleDomains(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const domains = requireArray(body.domains, 'domains');
    for (const domain of domains) {
      if (!domain || typeof domain !== 'object') throw new Error('domain 必须是对象');
      if (!/^[a-zA-Z0-9._-]{1,60}$/u.test(String(domain.id ?? ''))) throw new Error('domain.id 只允许字母数字 . _ -');
      if (domain.knowledgeScopes !== undefined && !Array.isArray(domain.knowledgeScopes)) throw new Error('knowledgeScopes 必须是数组');
      if (domain.kbTriggerKeywords !== undefined && !Array.isArray(domain.kbTriggerKeywords)) throw new Error('kbTriggerKeywords 必须是数组');
      if (domain.allowedHostTools !== undefined && !Array.isArray(domain.allowedHostTools)) throw new Error('allowedHostTools 必须是数组');
      if (domain.operators !== undefined) {
        if (!Array.isArray(domain.operators)) throw new Error('domain.operators 必须是数组');
        for (const entry of domain.operators) {
          if (normalizeOperators([entry]).length === 0) {
            throw new Error(`管理者 id 格式不对：${entry}；应为「渠道:id」（如 qqbot:8FD96C63...）、纯 id，或 * 表示所有人`);
          }
        }
      }
      if (domain.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(domain.repo).trim())) {
        throw new Error(`domain.repo 格式应为 owner/repo：${domain.repo}`);
      }
      if (domain.branch && /[\\\s]/u.test(String(domain.branch))) throw new Error('domain.branch 不能包含空白或反斜杠');
    }
    await store.setDomains(domains);
    return handleState(req, res);
  }

  async function handleRoles(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const roles = requireArray(body.roles, 'roles');
    if (roles.length === 0) throw new Error('至少保留一张角色卡');
    for (const role of roles) {
      const name = String(role?.name ?? '').trim();
      if (!name || name.length > 40) throw new Error('角色名长度必须在 1~40 之间');
      if (/[\\/:*?"<>|]/u.test(name) || name.includes('..')) throw new Error(`角色名不合法：${name}`);
      if (String(role.content ?? '').length > 200_000) throw new Error(`角色卡过长：${name}`);
    }
    await store.setRoles(roles);
    return handleState(req, res);
  }

  async function handleBindings(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    if (body.key !== undefined) {
      const key = String(body.key);
      if (!parseConversationKey(key)) throw new Error(`非法会话 key：${key}`);
      if (body.binding === null) await store.deleteBinding(key);
      else await store.upsertBinding(key, body.binding ?? {});
      return handleState(req, res);
    }
    const bindings = body.bindings;
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error('bindings 必须是对象');
    const domains = new Set(store.get().domains.map((domain) => domain.id));
    const roles = new Set(store.get().roles.map((role) => role.name));
    for (const [key, binding] of Object.entries(bindings)) {
      if (!parseConversationKey(key)) throw new Error(`非法会话 key：${key}`);
      if (!binding || typeof binding !== 'object') throw new Error(`binding 必须是对象：${key}`);
      // The conversation names a role; the role carries the domain. `domainId` is
      // still accepted for state written before 0.4.0.
      if (binding.domainId && !domains.has(String(binding.domainId))) throw new Error(`domain 不存在：${binding.domainId}`);
      if (binding.role && !roles.has(String(binding.role))) throw new Error(`角色卡不存在：${binding.role}`);
    }
    await store.setBindings(bindings);
    return handleState(req, res);
  }

  async function handlePush(req, res) {
    if (!canPush(req)) return sendJson(res, 401, { ok: false, error: 'push token 无效或来源不被允许' });
    const body = await readBody(req);
    const targets = Array.isArray(body.targets)
      ? [...new Set(body.targets.map((item) => String(item).trim()).filter(Boolean))]
      : [String(body.target ?? '').trim()];
    if (targets.length === 0 || targets.some((target) => !parseConversationKey(target))) {
      return sendJson(res, 400, { ok: false, error: 'target/targets 必须是 <channel>:<group|private>:<id>' });
    }
    if (targets.length > 50) return sendJson(res, 400, { ok: false, error: '单次最多 50 个目标' });
    const cfg = store.get().config;
    let messages = normalizeMessages(body.messages ?? body.message);
    if (cfg.reply?.stripMarkdown !== false) messages = messages.map((message) => stripMarkdown(message));
    const maxChars = Math.max(200, Number(cfg.reply?.maxChars) || 1500);
    const chunks = messages.flatMap((message) => splitText(message, maxChars)).slice(0, 20);
    if (chunks.length === 0) return sendJson(res, 400, { ok: false, error: 'messages 为空' });
    const results = [];
    for (const target of targets) {
      try {
        // A push is not a reply: never reuse the conversation's msg_id.
        const result = await channels.sendKey(target, chunks, { reply: false });
        results.push({ target, ok: true, sent: chunks.length, resultCount: Array.isArray(result) ? result.length : 1 });
      } catch (error) {
        results.push({ target, ok: false, error: String(error?.message ?? error) });
      }
    }
    const okCount = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);
    logger?.info?.(`[lane-bridge] push -> ${targets.join(', ')}：${okCount}/${targets.length} 成功`);
    // 207 = some targets failed, so the caller must read `results`. A bare status
    // line is useless without the reason, so it is spelled out here too.
    return sendJson(res, okCount === targets.length ? 200 : 207, {
      ok: okCount > 0,
      results,
      target: targets[0],
      sent: chunks.length,
      error: failed.length > 0
        ? `${failed.length}/${targets.length} 个会话发送失败：${failed.map((item) => `${item.target}：${item.error}`).join('；')}`
        : undefined,
    });
  }

  // Agent presets the host actually declares. The Settings card uses this to
  // build a dropdown instead of asking the operator to type an id from memory.
  async function handlePresets(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    let rows = null;
    if (typeof listPresets === 'function') {
      try {
        rows = await listPresets();
      } catch (error) {
        logger?.warn?.(`[lane-bridge] 读取 agent preset 列表失败：${error?.message ?? error}`);
      }
    }
    const presets = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row?.id ?? '').trim(),
      name: String(row?.name ?? '').trim(),
      description: String(row?.description ?? '').trim(),
      isDefault: row?.isDefault === true,
      broken: row?.broken === undefined ? '' : String(row.broken),
    })).filter((row) => row.id);
    return sendJson(res, 200, { ok: true, presets, fallback: !Array.isArray(rows) });
  }

  async function handleKnowledge(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const url = new URL(req.url ?? '/', 'http://x');
      const scope = url.searchParams.get('scope');
      return sendJson(res, 200, { ok: true, ...listKnowledge(knowledgeDir, scope ? [scope] : null) });
    }
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    // Renaming a document and moving it between knowledge bases are the same
    // filesystem operation, so they share one action.
    if (body.action === 'move') {
      const result = moveKnowledge(knowledgeDir, {
        scope: body.scope,
        path: body.path,
        targetScope: body.targetScope,
        targetPath: body.targetPath,
        force: body.force === true,
      });
      return sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, ...result } : { ok: false, error: result.message });
    }
    const meta = body.meta && typeof body.meta === 'object'
      ? {
        title: String(body.meta.title ?? '').trim().slice(0, 120),
        triggers: Array.isArray(body.meta.triggers)
          ? [...new Set(body.meta.triggers.map((item) => String(item).trim()).filter(Boolean))].slice(0, 30)
          : [],
        // `domains` is deprecated: a document is owned by its knowledge base and
        // a domain reaching that base sees all of it.
        domains: [],
        always: body.meta.always === true,
      }
      : null;
    const result = writeKnowledge(knowledgeDir, body.scope, body.path, body.content, meta);
    return sendJson(res, 200, { ok: true, ...result });
  }

  // Knowledge bases: the named containers a domain binds. Renaming or deleting
  // one is a filesystem move, so it also repoints every domain that bound it.
  async function handleKnowledgeBases(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
      const registered = store.get().knowledgeBases;
      const onDisk = new Set(listScopes(knowledgeDir));
      const bases = registered.map((kb) => ({ ...knowledgeBaseInfo(knowledgeDir, kb.id), name: kb.name, id: kb.id, missing: !onDisk.has(kb.id) }));
      return sendJson(res, 200, { ok: true, bases, orphanDirs: [...onDisk].filter((id) => !registered.some((kb) => kb.id === id)) });
    }
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const action = String(body.action ?? '').trim();
    if (action === 'create') {
      const result = createKnowledgeBase(knowledgeDir, body.name);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.message });
      await store.upsertKnowledgeBase({ id: result.id, name: String(body.name ?? result.id).trim() || result.id });
      return sendJson(res, 200, { ok: true, id: result.id, bases: store.get().knowledgeBases });
    }
    if (action === 'rename') {
      const from = String(body.id ?? '').trim();
      const to = String(body.name ?? '').trim();
      const result = renameKnowledgeBase(knowledgeDir, from, to);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.message });
      await store.renameKnowledgeBase(from, result.id);
      return sendJson(res, 200, { ok: true, id: result.id, bases: store.get().knowledgeBases });
    }
    if (action === 'delete') {
      const id = String(body.id ?? '').trim();
      const result = removeKnowledgeBase(knowledgeDir, id, { force: body.force === true });
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.message, docs: result.docs });
      await store.removeKnowledgeBase(id);
      return sendJson(res, 200, { ok: true, bases: store.get().knowledgeBases });
    }
    return sendJson(res, 400, { ok: false, error: 'action 必须是 create/rename/delete' });
  }

  async function handleKnowledgeRead(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const url = new URL(req.url ?? '/', 'http://x');
    const pathValue = url.searchParams.get('path');
    const scope = url.searchParams.get('scope');
    if (!pathValue) return sendJson(res, 400, { ok: false, error: 'path 不能为空' });
    const result = readKnowledge(knowledgeDir, scope ? [scope] : null, pathValue);
    if (!result.ok) return sendJson(res, 404, { ok: false, error: result.message });
    return sendJson(res, 200, { ok: true, ...result });
  }

  async function handleKbDrafts(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return sendJson(res, 200, { ok: true, ...listDrafts(knowledgeDir) });
    }
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const scope = String(body.scope ?? '').trim();
    const file = String(body.file ?? '').trim();
    if (body.action === 'discard') return sendJson(res, 200, { ok: true, ...discardDraft(knowledgeDir, { scope, file }) });
    if (body.action === 'approve') {
      return sendJson(res, 200, {
        ok: true,
        ...approveDraft(knowledgeDir, { scope, file, triggers: body.triggers }),
      });
    }
    return sendJson(res, 400, { ok: false, error: 'action 必须是 approve/discard' });
  }

  async function handleGithub(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    if (!repo) return sendJson(res, 503, { ok: false, error: 'GitHub 模块不可用' });
    const url = new URL(req.url ?? '/', 'http://x');
    const route = url.pathname.slice(`${PREFIX}/api/github`.length);
    try {
      if (route === '/auth') return sendJson(res, 200, { ok: true, ...(await repo.authStatus()) });
      if (route === '/repos') return sendJson(res, 200, { ok: true, ...(await repo.listRepos({ limit: url.searchParams.get('limit') })) });
      if (route === '/branches') return sendJson(res, 200, { ok: true, ...(await repo.listBranches({ repo: url.searchParams.get('repo') })) });
      return sendJson(res, 404, { ok: false, error: 'unknown github route' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  function requireDomain(value) {
    const domainId = String(value ?? '').trim();
    const domain = store.get().domains.find((item) => item.id === domainId);
    if (!domain) throw new Error(`领域不存在：${domainId}`);
    return domain;
  }

  async function handleUsage(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    if (!usageStore) return sendJson(res, 503, { ok: false, error: 'usage store unavailable' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return sendJson(res, 200, { ok: true, ...usageStore.summary() });
    }
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    usageStore.clear();
    return sendJson(res, 200, { ok: true, ...usageStore.summary() });
  }

  async function handleMemory(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    if (!memoryStore) return sendJson(res, 503, { ok: false, error: 'memory store unavailable' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      const url = new URL(req.url ?? '/', 'http://x');
      const domain = requireDomain(url.searchParams.get('domain'));
      const data = memoryStore.load(domain.id);
      return sendJson(res, 200, {
        ok: true,
        domainId: domain.id,
        count: data.entries.length,
        text: memoryStore.render(domain.id, domain.memoryMaxChars),
      });
    }
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const domain = requireDomain(body.domainId);
    if (body.action === 'clear') {
      memoryStore.clear(domain.id);
      return sendJson(res, 200, { ok: true, domainId: domain.id, count: 0 });
    }
    const result = memoryStore.replace(domain.id, body.text, { source: 'operator' });
    return sendJson(res, 200, { ok: true, domainId: domain.id, ...result });
  }

  async function handleHandoff(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const key = String(body.key ?? '').trim();
    if (!parseConversationKey(key)) return sendJson(res, 400, { ok: false, error: '非法会话 key' });
    const action = String(body.action ?? 'escalate');
    if (action === 'resume') await pool.resume(key);
    else if (action === 'pause') await pool.pause(key, body.reason ?? 'operator');
    else if (action === 'escalate') await pool.escalate(key, { reason: body.reason ?? '', summary: body.summary ?? '' });
    else return sendJson(res, 400, { ok: false, error: 'action 必须是 escalate/pause/resume' });
    return handleState(req, res);
  }

  async function handleSessionReset(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const key = String(body.key ?? '').trim();
    if (!parseConversationKey(key)) return sendJson(res, 400, { ok: false, error: '非法会话 key' });
    await pool.reset(key);
    return handleState(req, res);
  }

  async function handleRestart(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const id = normalizeChannelId(body?.id);
    if (id) {
      // One bot per request: the 通道 card retries itself, not the whole fleet.
      if (!store.get().config.channels?.[id]) {
        return sendJson(res, 404, { ok: false, error: `未知通道：${id}` });
      }
      await channels.restart(id);
      return handleState(req, res);
    }
    await channels.sync();
    return handleState(req, res);
  }

  async function handleRemoveChannel(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    const id = normalizeChannelId(body?.id);
    if (!id) return sendJson(res, 400, { ok: false, error: '通道 id 不合法' });
    if (!store.get().config.channels?.[id]) {
      return sendJson(res, 404, { ok: false, error: `未知通道：${id}` });
    }
    await store.removeChannels([id]);
    await channels.sync().catch((error) => logger?.warn?.(`[lane-bridge] 通道重启失败：${error?.message ?? error}`));
    return handleState(req, res);
  }

  async function handleChannelLogs(req, res) {
    if (!trustedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    return sendJson(res, 200, { ok: true, lines: channels.logs?.() ?? [] });
  }

  async function handleConversations(req, res) {
    if (!canWriteFromBrowser(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const body = await readBody(req);
    if (!body.key) return sendJson(res, 400, { ok: false, error: 'key 不能为空' });
    await store.update((draft) => {
      if (body.remove === true) delete draft.conversations[body.key];
    });
    return handleState(req, res);
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = url.pathname;
    if (!pathname.startsWith(PREFIX)) return sendJson(res, 404, { ok: false, error: 'not found' });
    const route = pathname.slice(PREFIX.length) || '/';
    try {
      if (route === '/api/state' && (req.method === 'GET' || req.method === 'HEAD')) return await handleState(req, res);
      if (route === '/api/health') return sendJson(res, 200, { ok: true, uptime: process.uptime(), version: VERSION });
      if (route === '/api/presets') return await handlePresets(req, res);
      if (route === '/api/config' && req.method === 'POST') return await handleConfig(req, res);
      if (route === '/api/domains' && req.method === 'POST') return await handleDomains(req, res);
      if (route === '/api/roles' && req.method === 'POST') return await handleRoles(req, res);
      if (route === '/api/bindings' && req.method === 'POST') return await handleBindings(req, res);
      if (route === '/api/conversations' && req.method === 'POST') return await handleConversations(req, res);
      if (route === '/api/push' && req.method === 'POST') return await handlePush(req, res);
      if (route === '/api/session/reset' && req.method === 'POST') return await handleSessionReset(req, res);
      if (route === '/api/handoff' && req.method === 'POST') return await handleHandoff(req, res);
      if (route === '/api/memory') return await handleMemory(req, res);
      if (route === '/api/usage') return await handleUsage(req, res);
      if (route === '/api/channels/restart' && req.method === 'POST') return await handleRestart(req, res);
      if (route === '/api/channels/remove' && req.method === 'POST') return await handleRemoveChannel(req, res);
      if (route === '/api/channels/logs') return await handleChannelLogs(req, res);
      if (route === '/api/knowledge') return await handleKnowledge(req, res);
      if (route === '/api/kb') return await handleKnowledgeBases(req, res);
      if (route === '/api/knowledge/read') return await handleKnowledgeRead(req, res);
      if (route === '/api/kb/drafts') return await handleKbDrafts(req, res);
      if (route.startsWith('/api/github/')) return await handleGithub(req, res);
      return sendJson(res, 404, { ok: false, error: `unknown route: ${route}` });
    } catch (error) {
      logger?.warn?.(`[lane-bridge] HTTP ${route} 失败：${error?.message ?? error}`);
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  return { handle, PREFIX };
}

export const ROUTE_PREFIX = PREFIX;
