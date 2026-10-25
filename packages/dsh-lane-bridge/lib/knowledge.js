// Shared, read-only knowledge base.
//
// The model-facing tools are deliberately narrow: list / search / read inside
// `knowledge/<scope>/`, Markdown or plain text only, with the same path-traversal
// defenses as the legacy qq-bridge MCP server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_EXT = new Set(['.md', '.txt']);
const MAX_READ_CHARS = 20000;
export const DRAFT_DIR = '_待审';
const MAX_DRAFT_CHARS = 2000;
const MAX_DRAFTS_PER_HOUR = 5;

function safeScope(value) {
  const scope = String(value ?? '').trim();
  if (!scope || scope.length > 60) return '';
  if (/[\\/:*?"<>|]/u.test(scope) || scope === '.' || scope === '..' || scope.includes('..')) return '';
  return scope;
}

export function listScopes(knowledgeDir) {
  try {
    return fs.readdirSync(knowledgeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => safeScope(name) === name && !name.startsWith('_'))
      .sort();
  } catch {
    return [];
  }
}

function walkScope(knowledgeDir, scope) {
  const base = path.join(knowledgeDir, scope);
  const out = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue; // drafts are private, as in qq-bridge
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) out.push(abs);
    }
  };
  visit(base);
  return out.sort();
}

function selectedScopes(knowledgeDir, scopes) {
  const existing = listScopes(knowledgeDir);
  const wanted = Array.isArray(scopes) ? scopes.map(safeScope).filter(Boolean) : [];
  const picked = wanted.filter((scope) => existing.includes(scope));
  return picked.length > 0 ? picked : existing;
}

// ── 文档头部（frontmatter）──────────────────────────────────────────────────
//
// A knowledge document is a self-contained unit, like a skill: it carries its
// own trigger words in a small frontmatter block, so retrieval is decided per
// document instead of by one global keyword list.
//
//   ---
//   title: 存档位置
//   triggers: 存档, 存档在哪, save
//   always: false
//   ---
//
// Only these three keys are understood. Parsing is deliberately forgiving: an
// unparsable head is treated as text, never as an error, because these files are
// hand-written.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

function splitList(value) {
  return String(value ?? '')
    .split(/[,，、;；]/u)
    .map((item) => item.trim().replace(/^["']|["']$/gu, ''))
    .filter(Boolean);
}

/** Parse optional frontmatter. Returns the metadata plus the clean body. */
export function parseDocument(text) {
  const source = String(text ?? '').replace(/\r\n/gu, '\n');
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { meta: { title: '', triggers: [], always: false }, body: source, hasFrontmatter: false };
  const data = { title: '', triggers: [], always: false };
  let pendingList = '';
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const item = /^[-*]\s+(.+)$/u.exec(line);
    if (item && pendingList === 'triggers') {
      data.triggers.push(...splitList(item[1]));
      continue;
    }
    const pair = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/u.exec(line);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    pendingList = value ? '' : key;
    if (key === 'title') data.title = value.replace(/^["']|["']$/gu, '').slice(0, 120);
    else if (key === 'triggers' || key === 'trigger' || key === 'keywords') data.triggers.push(...splitList(value));
    else if (key === 'always') data.always = /^(true|yes|1)$/iu.test(value);
  }
  return {
    meta: {
      title: data.title,
      triggers: [...new Set(data.triggers.map((item) => item.trim()).filter(Boolean))],
      always: data.always,
    },
    body: source.slice(match[0].length),
    hasFrontmatter: true,
  };
}

/** Render metadata back into a frontmatter block (omitted when there is none). */
export function formatDocument({ meta = {}, body = '' } = {}) {
  const title = String(meta.title ?? '').trim();
  const triggers = Array.isArray(meta.triggers) ? meta.triggers.map((item) => String(item).trim()).filter(Boolean) : [];
  const always = meta.always === true;
  if (!title && triggers.length === 0 && !always) return String(body ?? '');
  const lines = ['---'];
  if (title) lines.push(`title: ${title}`);
  if (triggers.length > 0) lines.push(`triggers: ${triggers.join(', ')}`);
  if (always) lines.push('always: true');
  lines.push('---', '');
  return `${lines.join('\n')}${String(body ?? '').replace(/^\n+/u, '')}`;
}

/** Title for display: frontmatter, else the first heading, else the file name. */
export function documentTitle(meta, body, fallback) {
  if (meta?.title) return meta.title;
  const heading = (String(body ?? '').match(/^#\s+(.+)$/mu)?.[1] ?? '').trim();
  return heading || String(fallback ?? '');
}

export function listKnowledge(knowledgeDir, scopes = null) {
  const available = listScopes(knowledgeDir);
  const picked = selectedScopes(knowledgeDir, scopes);
  const files = [];
  for (const scope of picked) {
    for (const abs of walkScope(knowledgeDir, scope)) {
      const rel = path.relative(path.join(knowledgeDir, scope), abs).replace(/\\/gu, '/');
      let text = '';
      try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const parsed = parseDocument(text);
      files.push({
        scope,
        path: rel,
        size: fs.statSync(abs).size,
        title: documentTitle(parsed.meta, parsed.body, rel),
        triggers: parsed.meta.triggers,
        always: parsed.meta.always,
      });
    }
  }
  return { scopes: available, selected: picked, files, count: files.length };
}

function resolveReadPath(knowledgeDir, scopes, requested) {
  const raw = String(requested ?? '').trim().replace(/\\/gu, '/');
  if (!raw) return { ok: false, message: 'path 不能为空' };
  if (raw.startsWith('/') || /^[a-zA-Z]:/u.test(raw)) return { ok: false, message: 'path 必须是知识库内的相对路径' };
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return { ok: false, message: 'path 不允许包含 ..' };
  if (parts.includes(DRAFT_DIR)) return { ok: false, message: '待审草稿不参与检索，只有管理员采纳后的内容才会进入知识库' };
  const scope = safeScope(parts[0]);
  const picked = selectedScopes(knowledgeDir, scopes);
  // Accept both `scope/file.md` and `file.md` (the latter searches selected scopes).
  let candidates;
  if (scope && parts.length > 1 && picked.includes(scope)) {
    if (!ALLOWED_EXT.has(path.extname(parts.at(-1)).toLowerCase())) return { ok: false, message: '只支持 .md / .txt 文本文件' };
    candidates = [{ scope, rel: parts.slice(1).join('/') }];
  } else {
    if (!ALLOWED_EXT.has(path.extname(parts.at(-1)).toLowerCase())) return { ok: false, message: '只支持 .md / .txt 文本文件' };
    candidates = picked.map((s) => ({ scope: s, rel: parts.join('/') }));
  }
  for (const candidate of candidates) {
    const base = path.resolve(path.join(knowledgeDir, candidate.scope));
    const abs = path.resolve(base, candidate.rel);
    if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) continue;
    if (fs.existsSync(abs)) return { ok: true, scope: candidate.scope, rel: candidate.rel, abs };
  }
  return { ok: false, message: `没有这个文件：${raw}` };
}

export function readKnowledge(knowledgeDir, scopes, requested) {
  const found = resolveReadPath(knowledgeDir, scopes, requested);
  if (!found.ok) return found;
  const raw = fs.readFileSync(found.abs, 'utf8').replace(/\r\n/gu, '\n');
  const parsed = parseDocument(raw);
  const text = parsed.body;
  const truncated = text.length > MAX_READ_CHARS;
  return {
    ok: true,
    scope: found.scope,
    path: found.rel,
    title: documentTitle(parsed.meta, text, found.rel),
    meta: parsed.meta,
    triggers: parsed.meta.triggers,
    always: parsed.meta.always,
    chars: text.length,
    truncated,
    content: truncated ? `${text.slice(0, MAX_READ_CHARS)}\n…（已截断）` : text,
  };
}

/**
 * Documents whose own trigger words appear in the inbound text.
 *
 * This is the unit of retrieval: one Markdown file = one skill-like document,
 * carrying its own triggers. `always: true` documents are included regardless,
 * which is how a "product overview" stays in context.
 */
export function matchDocuments(knowledgeDir, scopes = null, text = '', limit = 4) {
  const lower = String(text ?? '').toLowerCase();
  const picked = selectedScopes(knowledgeDir, scopes);
  const scored = [];
  for (const scope of picked) {
    for (const abs of walkScope(knowledgeDir, scope)) {
      let raw = '';
      try { raw = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const parsed = parseDocument(raw);
      const rel = path.relative(path.join(knowledgeDir, scope), abs).replace(/\\/gu, '/');
      const matched = parsed.meta.triggers.filter((trigger) => lower.includes(String(trigger).toLowerCase()));
      if (matched.length === 0 && parsed.meta.always !== true) continue;
      // Prefer more matched triggers, then longer triggers (更具体的词组优先),
      // and rank `always` documents last so a specific hit wins the budget.
      const longest = matched.reduce((max, trigger) => Math.max(max, trigger.length), 0);
      scored.push({
        scope,
        path: rel,
        title: documentTitle(parsed.meta, parsed.body, rel),
        body: parsed.body,
        triggers: parsed.meta.triggers,
        matched,
        always: parsed.meta.always === true,
        score: matched.length * 100 + longest * 10 + (parsed.meta.always ? 1 : 0),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const max = Math.max(1, Math.min(20, Number(limit) || 4));
  return scored.slice(0, max);
}

function sectionsOf(text) {
  const sections = [];
  let heading = '(开头部分)';
  let lines = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (match) {
      if (lines.join('\n').trim()) sections.push({ heading, text: lines.join('\n') });
      heading = match[2].trim();
      lines = [line];
    } else {
      lines.push(line);
    }
  }
  if (lines.join('\n').trim()) sections.push({ heading, text: lines.join('\n') });
  return sections;
}

export function searchKnowledge(knowledgeDir, scopes, query, limit = 8) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return { ok: false, message: 'query 不能为空' };
  const max = Math.max(1, Math.min(30, Number(limit) || 8));
  const hits = [];
  for (const file of listKnowledge(knowledgeDir, scopes).files) {
    const abs = path.join(knowledgeDir, file.scope, file.path);
    let text = '';
    try {
      // Frontmatter is metadata, not content: searching it would produce hits the
      // model cannot see.
      text = parseDocument(fs.readFileSync(abs, 'utf8')).body.replace(/\r\n/gu, '\n');
    } catch {
      continue;
    }
    const lower = text.toLowerCase();
    if (!terms.every((term) => lower.includes(term))) continue;
    for (const section of sectionsOf(text)) {
      const sectionLower = section.text.toLowerCase();
      if (!terms.every((term) => sectionLower.includes(term))) continue;
      const first = terms.map((term) => sectionLower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, first - 120);
      const end = Math.min(section.text.length, first + 480);
      hits.push({
        scope: file.scope,
        path: file.path,
        heading: section.heading,
        snippet: `${start > 0 ? '…' : ''}${section.text.slice(start, end).replace(/\s+/gu, ' ').trim()}${end < section.text.length ? '…' : ''}`,
      });
      if (hits.length >= max) return { ok: true, query, count: hits.length, hits };
    }
  }
  return { ok: true, query, count: hits.length, hits };
}

/** Create or replace one document. Used by the Settings card. */
export function writeKnowledge(knowledgeDir, scope, relPath, content, meta = null) {
  const safe = safeScope(scope);
  if (!safe) throw new TypeError('invalid knowledge scope');
  const rel = String(relPath ?? '').trim().replace(/\\/gu, '/');
  const parts = rel.split('/').filter(Boolean);
  if (!rel || parts.some((part) => part === '..') || rel.startsWith('/') || /^[a-zA-Z]:/u.test(rel)) {
    throw new TypeError('invalid knowledge path');
  }
  if (parts.includes(DRAFT_DIR)) throw new TypeError('草稿区只能通过审批流程写入');
  if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) throw new TypeError('only .md/.txt files are allowed');
  const base = path.resolve(path.join(knowledgeDir, safe));
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(`${base}${path.sep}`)) throw new TypeError('path escapes the knowledge scope');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // `meta` (title/triggers/always) becomes the frontmatter block; passing null
  // keeps whatever head the caller already wrote into `content`.
  const payload = meta ? formatDocument({ meta, body: String(content ?? '') }) : String(content ?? '');
  fs.writeFileSync(abs, payload, 'utf8');
  return { scope: safe, path: rel.replace(/\\/gu, '/'), bytes: Buffer.byteLength(payload) };
}

// ── 待审草稿（AI 起草 → 人工采纳/丢弃）──────────────────────────────────────
//
// Drafts live under `knowledge/<scope>/_待审/`. `walkScope` skips every `_`
// entry, so unapproved drafts cannot be listed, searched or read by the model.

function draftDir(knowledgeDir, scope) {
  return path.join(knowledgeDir, scope, DRAFT_DIR);
}

function draftHash(title, body) {
  return crypto.createHash('sha1').update(`${title}\u0000${body}`).digest('hex');
}

function slugify(value) {
  const out = String(value ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/gu, ' ')
    .replace(/\s+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return out || 'draft';
}

export function parseDraft(text) {
  const source = String(text ?? '');
  const title = (source.match(/^#\s+(.+)$/mu)?.[1] ?? '').trim().slice(0, 80);
  const origin = (source.match(/^>\s*来源[：:]\s*(.+)$/mu)?.[1] ?? '').trim();
  const body = source
    .split(/\r?\n/u)
    .filter((line) => !/^#\s+/u.test(line) && !/^>\s*(来源|起草)[：:]/u.test(line))
    .join('\n')
    .trim();
  return { title, source: origin, body };
}

function readDraftMeta(knowledgeDir, scope, file) {
  const abs = path.join(draftDir(knowledgeDir, scope), file);
  let text = '';
  let mtime = 0;
  try {
    text = fs.readFileSync(abs, 'utf8');
    mtime = fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
  const parsed = parseDraft(text);
  return {
    scope,
    file,
    title: parsed.title || file,
    source: parsed.source,
    preview: parsed.body.replace(/\s+/gu, ' ').slice(0, 140),
    chars: parsed.body.length,
    mtime,
    hash: draftHash(parsed.title, parsed.body),
  };
}

function targetFiles(knowledgeDir, scope) {
  const base = path.join(knowledgeDir, scope);
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && ALLOWED_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

export function listDrafts(knowledgeDir, scopes = null) {
  const allScopes = listScopes(knowledgeDir);
  const wanted = Array.isArray(scopes) ? scopes.map(safeScope).filter(Boolean) : [];
  const picked = wanted.length ? allScopes.filter((scope) => wanted.includes(scope)) : allScopes;
  const drafts = [];
  const targets = {};
  for (const scope of picked) {
    targets[scope] = targetFiles(knowledgeDir, scope);
    let entries = [];
    try {
      entries = fs.readdirSync(draftDir(knowledgeDir, scope), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const meta = readDraftMeta(knowledgeDir, scope, entry.name);
      if (meta) drafts.push(meta);
    }
  }
  drafts.sort((a, b) => b.mtime - a.mtime);
  return { scopes: allScopes, drafts, targets };
}

export function writeDraft(knowledgeDir, scope, { title, content, source }) {
  const safe = safeScope(scope);
  if (!safe) throw new TypeError('invalid knowledge scope');
  const cleanTitle = String(title ?? '').replace(/[\r\n]+/gu, ' ').trim().slice(0, 80);
  const cleanContent = String(content ?? '').trim().slice(0, MAX_DRAFT_CHARS);
  const cleanSource = String(source ?? '').replace(/[\r\n]+/gu, ' ').trim().slice(0, 240);
  if (!cleanTitle) throw new TypeError('title 不能为空');
  if (cleanContent.length < 10) throw new TypeError('content 太短（至少 10 字）');
  if (!cleanSource) throw new TypeError('source 不能为空：要能指出这条结论是从哪查到的');

  const dir = draftDir(knowledgeDir, safe);
  const existing = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const meta = readDraftMeta(knowledgeDir, safe, entry.name);
      if (meta) existing.push(meta);
    }
  } catch {}

  const hash = draftHash(cleanTitle, cleanContent);
  const duplicate = existing.find((draft) => draft.hash === hash);
  if (duplicate) return { ...duplicate, duplicate: true };

  const cutoff = Date.now() - 60 * 60 * 1000;
  if (existing.filter((draft) => draft.mtime >= cutoff).length >= MAX_DRAFTS_PER_HOUR) {
    throw new Error(`本小时已经起草 ${MAX_DRAFTS_PER_HOUR} 条，先别继续写；把这次的结论直接回给用户即可`);
  }

  const stamp = new Date().toISOString().replace(/[:T]/gu, '-').slice(0, 19);
  const file = `${stamp}-${slugify(cleanTitle)}.md`;
  const body = [
    `# ${cleanTitle}`,
    '',
    `> 来源：${cleanSource}`,
    `> 起草：${new Date().toISOString()}（客服 AI 生成，**待人工审核**；未采纳前不参与检索）`,
    '',
    cleanContent,
    '',
  ].join('\n');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), body, 'utf8');
  return { ...readDraftMeta(knowledgeDir, safe, file), duplicate: false };
}

function safeDraftFile(file) {
  const name = path.basename(String(file ?? '').trim());
  if (!name || !ALLOWED_EXT.has(path.extname(name).toLowerCase())) throw new TypeError('草稿文件名不合法');
  return name;
}

export function approveDraft(knowledgeDir, { scope, file, target } = {}) {
  const safe = safeScope(scope);
  if (!safe) throw new TypeError('invalid knowledge scope');
  const safeFile = safeDraftFile(file);
  const draftPath = path.join(draftDir(knowledgeDir, safe), safeFile);
  if (!fs.existsSync(draftPath)) throw new Error('草稿不存在（可能已被处理）');
  const parsed = parseDraft(fs.readFileSync(draftPath, 'utf8'));
  if (!parsed.body) throw new Error('草稿正文为空，先补内容再采纳');

  const targets = targetFiles(knowledgeDir, safe);
  const wanted = path.basename(String(target ?? '').trim());
  const targetName = wanted && ALLOWED_EXT.has(path.extname(wanted).toLowerCase())
    ? wanted
    : (targets.includes('常见问题.md') ? '常见问题.md' : (targets[0] ?? '常见问题.md'));
  if (!ALLOWED_EXT.has(path.extname(targetName).toLowerCase())) throw new TypeError('目标文件必须是 .md/.txt');

  const base = path.resolve(path.join(knowledgeDir, safe));
  const abs = path.resolve(base, targetName);
  if (!abs.startsWith(`${base}${path.sep}`)) throw new TypeError('目标文件越出知识库目录');
  const previous = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').replace(/\s*$/u, '') : `# ${safe} 知识库`;
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  try {
    const backupDir = path.join(path.dirname(knowledgeDir), 'kb-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `${safe}-${targetName}-${stamp}.md`), previous, 'utf8');
  } catch {}
  const block = `\n\n## ${parsed.title || targetName}\n\n${parsed.body}\n\n> 来源：${parsed.source || '（未注明）'}（采纳于 ${new Date().toISOString().slice(0, 10)}）\n`;
  fs.writeFileSync(abs, `${previous}${block}`, 'utf8');
  fs.rmSync(draftPath, { force: true });
  return { ok: true, scope: safe, target: targetName, title: parsed.title, file: safeFile };
}

export function discardDraft(knowledgeDir, { scope, file } = {}) {
  const safe = safeScope(scope);
  if (!safe) throw new TypeError('invalid knowledge scope');
  const safeFile = safeDraftFile(file);
  const abs = path.join(draftDir(knowledgeDir, safe), safeFile);
  if (!fs.existsSync(abs)) throw new Error('草稿不存在（可能已被处理）');
  fs.rmSync(abs, { force: true });
  return { ok: true, scope: safe, file: safeFile };
}
