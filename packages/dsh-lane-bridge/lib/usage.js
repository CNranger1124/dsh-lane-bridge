// Lightweight token usage ledger.
//
// DSH already exposes per-assistant-message usage; this module keeps a local
// JSONL ledger so the Settings card can answer "which conversation is burning
// tokens" without querying the Host. It intentionally stores tokens only, not
// money: pricing changes and belongs to a future dashboard.
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_READ_LINES = 50_000;
const MAX_RECENT = 50;

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeUsage(usage = {}) {
  const input = number(usage.inputTokens);
  const output = number(usage.outputTokens);
  const cacheRead = number(usage.cacheReadTokens);
  const cacheWrite = number(usage.cacheWriteTokens);
  const reasoning = number(usage.reasoningTokens);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
    totalTokens: number(usage.totalTokens) || input + output + cacheRead + cacheWrite,
  };
}

export class UsageStore {
  constructor({ file, logger = null }) {
    if (!file) throw new TypeError('UsageStore requires file');
    this.file = file;
    this.logger = logger;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
  }

  record({ key, sessionId = '', model = '', provider = '', usage = {}, at = Date.now() }) {
    if (!key || !usage || typeof usage !== 'object') return;
    const entry = {
      at: Number(at) || Date.now(),
      key: String(key),
      sessionId: String(sessionId),
      model: String(model || ''),
      provider: String(provider || ''),
      ...normalizeUsage(usage),
    };
    try {
      const stat = fs.existsSync(this.file) ? fs.statSync(this.file) : null;
      if (stat && stat.size > MAX_FILE_BYTES) {
        try { fs.renameSync(this.file, `${this.file}.1`); } catch {}
      }
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(this.file, 0o600); } catch {}
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] 用量记录失败：${error?.message ?? error}`);
    }
  }

  readEntries() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const lines = text.split(/\r?\n/u);
    if (lines.length > MAX_READ_LINES) lines.splice(0, lines.length - MAX_READ_LINES);
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry.key === 'string') out.push(entry);
      } catch {}
    }
    return out;
  }

  summary() {
    const entries = this.readEntries();
    const empty = () => ({ turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 });
    const total = empty();
    const byKey = new Map();
    for (const entry of entries) {
      const row = byKey.get(entry.key) ?? empty();
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) {
        total[field] += number(entry[field]);
        row[field] += number(entry[field]);
      }
      total.turns += 1;
      row.turns += 1;
      byKey.set(entry.key, row);
    }
    return {
      total,
      byKey: [...byKey.entries()]
        .map(([key, row]) => ({ key, ...row }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
      recent: entries.slice(-MAX_RECENT).reverse(),
    };
  }

  clear() {
    try { fs.rmSync(this.file, { force: true }); } catch {}
    try { fs.rmSync(`${this.file}.1`, { force: true }); } catch {}
  }
}
