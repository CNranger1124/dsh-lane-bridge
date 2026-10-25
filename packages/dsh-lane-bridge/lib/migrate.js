// One-shot migration from the legacy standalone qq-bridge to this plugin.
//
// The legacy bridge stored its configuration in config.json + a handful of
// state/*.json files. This module reads that layout and produces a
// dsh-lane-bridge state document; it never touches the legacy directory.
import fs from 'node:fs';
import path from 'node:path';
import { defaultDomain, defaultState } from './defaults.js';
import { normalizeState } from './store.js';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isSafeRole(name) {
  return Boolean(name) && !/[\\/:*?"<>|]/u.test(name) && !name.includes('..') && name.length <= 40;
}

function collectRoles(fromDir) {
  const dir = path.join(fromDir, 'roles');
  const roles = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return roles;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const name = entry.name.slice(0, -3);
    if (!isSafeRole(name) || name.toLowerCase() === 'readme') continue;
    const content = readText(path.join(dir, entry.name));
    if (content !== null) roles.push({ name, content, updatedAt: 0 });
  }
  return roles;
}

function collectKnowledge(fromDir) {
  const root = path.join(fromDir, 'knowledge');
  const files = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (/\.(md|txt)$/iu.test(entry.name)) {
        const content = readText(abs);
        if (content !== null) files.push({
          rel: path.relative(root, abs).replace(/\\/gu, '/'),
          content,
        });
      }
    }
  };
  visit(root);
  return files;
}

function safeId(value) {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9._-]/gu, '-').slice(0, 60) || 'domain';
}

/**
 * Read a legacy qq-bridge directory and return the migration payload.
 * No files are written here.
 */
export function buildMigration({ fromDir }) {
  const warnings = [];
  const legacyConfig = readJson(path.join(fromDir, 'config.json')) ?? {};
  const roleBindings = readJson(path.join(fromDir, 'state', 'role-bindings.json')) ?? {};
  const legacySessions = readJson(path.join(fromDir, 'state', 'sessions.json')) ?? {};
  const roles = collectRoles(fromDir);
  const knowledge = collectKnowledge(fromDir);
  const state = defaultState();

  if (roles.length > 0) state.roles = roles;
  else warnings.push('旧仓库没有 roles/*.md，使用内置示例角色卡');
  if (knowledge.length === 0) warnings.push('旧仓库没有 knowledge/ 文档，使用内置示例知识库');

  const roleNames = new Set(state.roles.map((role) => role.name));
  const scopeNames = new Set(knowledge.map((file) => file.rel.split('/')[0]).filter(Boolean));

  // Channels: keep the SnowLuma endpoint/token if present. The new plugin does
  // not launch SnowLuma, so no other process setting is carried over.
  const snow = legacyConfig.snowluma ?? {};
  state.config.channels.snowluma = {
    enabled: Boolean(snow.wsUrl || snow.accessToken || legacyConfig.allow?.groups?.length || legacyConfig.allow?.private?.length),
    wsUrl: String(snow.wsUrl || 'ws://127.0.0.1:3001'),
    accessToken: String(snow.accessToken || ''),
    homeDir: String(snow.homeDir || (snow.launcherPath ? path.dirname(String(snow.launcherPath)) : '')),
  };
  if (snow.launcherPath) {
    warnings.push('SnowLuma launcherPath 没有迁移：新插件只读它的 config 目录做 token 发现，不启动进程');
  }

  const support = legacyConfig.support ?? {};
  const supportConversations = new Set(Array.isArray(support.conversations)
    ? support.conversations.map(String)
    : []);
  const hasSupport = support.enabled !== false && supportConversations.size > 0;

  const domains = [defaultDomain()];
  if (hasSupport) {
    const scopes = scopeNames.has('客服') ? ['客服'] : (scopeNames.has('default') ? ['default'] : [...scopeNames].slice(0, 1));
    domains.push({
      ...defaultDomain(),
      id: 'support',
      name: '客服',
      knowledgeScopes: scopes.length > 0 ? scopes : ['default'],
      autoReply: true,
    });
  }
  state.domains = domains;

  // 0.4.0 model: roles carry the domain, conversations only name a role. Give
  // every migrated domain its own role card, so a binding always has something
  // to point at, and so a conversation switches infrastructure by role.
  const baseRole = state.roles[0] ?? { name: '客服', content: '' };
  for (const domain of state.domains) {
    if (state.roles.some((role) => role.domainId === domain.id)) continue;
    const sameName = state.roles.find((role) => role.name === baseRole.name);
    if (domain.id === 'default' && sameName) {
      sameName.domainId = 'default';
      continue;
    }
    const name = domain.id === 'default' ? baseRole.name : `${baseRole.name}（${domain.name || domain.id}）`;
    state.roles.push({
      name: roleNames.has(name) ? `${name}-${domain.id}` : name,
      content: baseRole.content,
      domainId: domain.id,
      updatedAt: 0,
    });
  }
  const roleForDomain = (domainId) => (state.roles.find((role) => role.domainId === domainId) ?? state.roles[0]).name;
  for (const role of state.roles) {
    if (!role.domainId) role.domainId = state.domains[0].id;
  }
  const bindings = {};
  const addBinding = (key, domainId, legacyRole) => {
    if (!/^[^:]+:(group|private):.+/u.test(key)) return;
    // A migrated conversation names a role; that role already carries the
    // domain. Prefer a legacy per-conversation role only when it is bound to the
    // same domain, otherwise the domain would silently move.
    const bound = state.roles.find((role) => role.name === legacyRole && role.domainId === domainId);
    bindings[key] = {
      domainId,
      enabled: true,
      role: bound ? bound.name : roleForDomain(domainId),
      preset: '',
      model: '',
      note: 'migrated from qq-bridge',
      updatedAt: 0,
    };
  };
  for (const id of legacyConfig.allow?.private ?? []) {
    addBinding(`snowluma:private:${id}`, hasSupport && supportConversations.has(`private:${id}`) ? 'support' : 'default', roleBindings.private?.[id]);
  }
  for (const id of legacyConfig.allow?.groups ?? []) {
    addBinding(`snowluma:group:${id}`, hasSupport && supportConversations.has(`group:${id}`) ? 'support' : 'default', roleBindings.groups?.[id]);
  }
  for (const key of supportConversations) {
    const [kind, id] = key.split(':');
    addBinding(`snowluma:${key}`, 'support', (kind === 'group' ? roleBindings.groups?.[id] : roleBindings.private?.[id]) ?? '客服');
  }
  state.bindings = bindings;
  if (Object.keys(bindings).length === 0) {
    warnings.push('旧配置的 allow.private / allow.groups 为空：没有迁移任何绑定，请在 Settings 里绑定会话');
  }

  const sessions = {};
  for (const [legacyKey, sessionId] of Object.entries(legacySessions.sessions ?? {})) {
    if (!/^(group|private):\d+$/u.test(legacyKey) || !sessionId) continue;
    const key = `snowluma:${legacyKey}`;
    const binding = bindings[key];
    sessions[key] = {
      sessionId: String(sessionId),
      role: binding?.role || (hasSupport ? '客服' : state.roles[0].name),
      roleKey: '',
      preset: 'lane-support',
      model: '',
      updatedAt: 0,
    };
  }
  state.sessions = sessions;

  state.config.reply.maxChars = Number(legacyConfig.socialV2?.send?.maxMessageChars) > 0
    ? Math.min(10000, Math.max(200, Number(legacyConfig.socialV2.send.maxMessageChars)))
    : 1500;
  state.config.pushToken = '';
  state.config.enabled = true;
  state.config.autoReplyPrivate = false;
  state.config.autoReplyGroups = false;

  return {
    state: normalizeState(state),
    roles: state.roles,
    knowledge,
    warnings,
    summary: {
      roles: state.roles.length,
      knowledgeFiles: knowledge.length,
      domains: state.domains.length,
      bindings: Object.keys(state.bindings).length,
      sessions: Object.keys(state.sessions).length,
    },
  };
}

function writeRoleFiles(dataDir, roles) {
  const dir = path.join(dataDir, 'roles');
  fs.mkdirSync(dir, { recursive: true });
  for (const role of roles) {
    fs.writeFileSync(path.join(dir, `${role.name}.md`), role.content, 'utf8');
  }
}

function writeKnowledge(dataDir, files) {
  for (const file of files) {
    const dest = path.join(dataDir, 'knowledge', file.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.content, 'utf8');
  }
}

export function applyMigration({ fromDir, dataDir, force = false, dryRun = false }) {
  const targetState = path.join(dataDir, 'state.json');
  if (fs.existsSync(targetState) && !force) {
    throw new Error(`目标已存在：${targetState}（确认要覆盖请加 --force）`);
  }
  const plan = buildMigration({ fromDir });
  if (!dryRun) {
    fs.mkdirSync(dataDir, { recursive: true });
    writeRoleFiles(dataDir, plan.roles);
    writeKnowledge(dataDir, plan.knowledge);
    fs.writeFileSync(targetState, `${JSON.stringify(plan.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return { ...plan.summary, warnings: plan.warnings, stateFile: targetState, dryRun };
}
