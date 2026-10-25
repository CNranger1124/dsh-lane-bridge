// Shared, domain-scoped memory.
//
// Knowledge base documents are the product's canonical facts; memory is the
// softer layer — "this player reported the same crash yesterday", "the guild
// prefers short answers". It is deliberately per-domain, not per-conversation,
// so a support team can accumulate context without mixing tenants.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 200;
const MAX_ENTRY_CHARS = 500;
const MAX_RENDER_CHARS = 8000;

function safeDomainId(value) {
  const id = String(value ?? '').trim();
  return /^[a-zA-Z0-9._-]{1,60}$/u.test(id) ? id : '';
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  }
}

function normalizeEntries(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const text = String(item?.text ?? '').trim().slice(0, MAX_ENTRY_CHARS);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({
      id: String(item?.id ?? `${Date.now().toString(36)}-${out.length}`),
      text,
      source: String(item?.source ?? '').slice(0, 80),
      createdAt: Number(item?.createdAt) || Date.now(),
      updatedAt: Number(item?.updatedAt) || Number(item?.createdAt) || Date.now(),
    });
  }
  return out.slice(-MAX_ENTRIES);
}

export class MemoryStore {
  constructor({ dir, logger = null }) {
    if (!dir) throw new TypeError('MemoryStore requires dir');
    this.dir = dir;
    this.logger = logger;
    fs.mkdirSync(this.dir, { recursive: true });
    try { fs.chmodSync(this.dir, 0o700); } catch { /* Windows */ }
  }

  fileFor(domainId) {
    const id = safeDomainId(domainId);
    if (!id) throw new TypeError('invalid domain id');
    return path.join(this.dir, `${id}.json`);
  }

  load(domainId) {
    const file = this.fileFor(domainId);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { version: 1, entries: normalizeEntries(raw?.entries) };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger?.warn?.(`[lane-bridge] 记忆文件读取失败（${domainId}）：${error?.message ?? error}`);
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      }
      return { version: 1, entries: [] };
    }
  }

  save(domainId, entries) {
    const file = this.fileFor(domainId);
    atomicWrite(file, `${JSON.stringify({ version: 1, entries: normalizeEntries(entries) }, null, 2)}\n`);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  }

  append(domainId, text, { source = 'agent' } = {}) {
    const clean = String(text ?? '').trim().slice(0, MAX_ENTRY_CHARS);
    if (!clean) throw new TypeError('memory text is empty');
    const current = this.load(domainId).entries;
    const previous = current.find((entry) => entry.text === clean);
    const rest = current.filter((entry) => entry.text !== clean);
    const now = Date.now();
    rest.push({
      id: previous?.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      text: clean,
      source: String(source ?? '').slice(0, 80),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
    const entries = rest.slice(-MAX_ENTRIES);
    this.save(domainId, entries);
    return { entries: entries.length, entry: entries[entries.length - 1] };
  }

  /** Replace the whole memory from a plain-text editor (one bullet/line per entry). */
  replace(domainId, text, { source = 'operator' } = {}) {
    const lines = String(text ?? '').split(/\r?\n/u);
    const now = Date.now();
    const entries = [];
    const seen = new Set();
    for (const line of lines) {
      const clean = line.replace(/^\s*[-*•]\s*/u, '').trim().slice(0, MAX_ENTRY_CHARS);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      entries.push({
        id: `${now.toString(36)}-${entries.length}`,
        text: clean,
        source,
        createdAt: now,
        updatedAt: now,
      });
      if (entries.length >= MAX_ENTRIES) break;
    }
    this.save(domainId, entries);
    return { count: entries.length };
  }

  clear(domainId) {
    this.save(domainId, []);
  }

  render(domainId, maxChars = 2000) {
    const limit = Math.max(200, Math.min(MAX_RENDER_CHARS, Number(maxChars) || 2000));
    const entries = this.load(domainId).entries;
    const out = [];
    let used = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const line = `- ${entries[index].text}`;
      if (used + line.length + 1 > limit) break;
      out.unshift(line);
      used += line.length + 1;
    }
    if (out.length === 0) return '';
    return out.join('\n');
  }
}
