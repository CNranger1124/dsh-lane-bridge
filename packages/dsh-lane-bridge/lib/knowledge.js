// Shared, read-only knowledge base.
//
// The model-facing tools are deliberately narrow: list / search / read inside
// `knowledge/<scope>/`, Markdown or plain text only, with the same path-traversal
// defenses as the legacy qq-bridge MCP server.
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_EXT = new Set(['.md', '.txt']);
const MAX_READ_CHARS = 20000;

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
      .filter((name) => safeScope(name) === name)
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

export function listKnowledge(knowledgeDir, scopes = null) {
  const available = listScopes(knowledgeDir);
  const picked = selectedScopes(knowledgeDir, scopes);
  const files = [];
  for (const scope of picked) {
    for (const abs of walkScope(knowledgeDir, scope)) {
      files.push({
        scope,
        path: path.relative(path.join(knowledgeDir, scope), abs).replace(/\\/gu, '/'),
        size: fs.statSync(abs).size,
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
  const text = fs.readFileSync(found.abs, 'utf8').replace(/\r\n/gu, '\n');
  const truncated = text.length > MAX_READ_CHARS;
  return {
    ok: true,
    scope: found.scope,
    path: found.rel,
    chars: text.length,
    truncated,
    content: truncated ? `${text.slice(0, MAX_READ_CHARS)}\n…（已截断）` : text,
  };
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
      text = fs.readFileSync(abs, 'utf8').replace(/\r\n/gu, '\n');
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
export function writeKnowledge(knowledgeDir, scope, relPath, content) {
  const safe = safeScope(scope);
  if (!safe) throw new TypeError('invalid knowledge scope');
  const rel = String(relPath ?? '').trim().replace(/\\/gu, '/');
  const parts = rel.split('/').filter(Boolean);
  if (!rel || parts.some((part) => part === '..') || rel.startsWith('/') || /^[a-zA-Z]:/u.test(rel)) {
    throw new TypeError('invalid knowledge path');
  }
  if (!ALLOWED_EXT.has(path.extname(rel).toLowerCase())) throw new TypeError('only .md/.txt files are allowed');
  const base = path.resolve(path.join(knowledgeDir, safe));
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(`${base}${path.sep}`)) throw new TypeError('path escapes the knowledge scope');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content ?? ''), 'utf8');
  return { scope: safe, path: rel.replace(/\\/gu, '/'), bytes: Buffer.byteLength(String(content ?? '')) };
}
