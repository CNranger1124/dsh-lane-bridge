import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UsageStore } from '../lib/usage.js';
import { tempDir, cleanup } from './helpers.js';

test('UsageStore aggregates per conversation and total tokens', () => {
  const dir = tempDir();
  try {
    const store = new UsageStore({ file: path.join(dir, 'usage.jsonl') });
    store.record({
      key: 'snowluma:group:1',
      sessionId: 's1',
      model: 'deepseek-flash',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 5 },
    });
    store.record({
      key: 'snowluma:group:1',
      sessionId: 's1',
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
    });
    store.record({
      key: 'discord:private:u1',
      sessionId: 's2',
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    const summary = store.summary();
    assert.equal(summary.total.turns, 3);
    assert.equal(summary.total.inputTokens, 157);
    assert.equal(summary.total.outputTokens, 33);
    assert.equal(summary.total.cacheReadTokens, 30);
    assert.equal(summary.total.totalTokens, 155 + 60 + 10);
    assert.equal(summary.byKey[0].key, 'snowluma:group:1');
    assert.equal(summary.byKey[0].turns, 2);
    assert.equal(summary.recent.length, 3);
    store.clear();
    assert.equal(store.summary().total.turns, 0);
  } finally {
    cleanup(dir);
  }
});

test('UsageStore ignores malformed lines and missing keys', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'usage.jsonl');
    fs.writeFileSync(file, '{bad}\n' + JSON.stringify({ key: 'k', inputTokens: 1 }) + '\n');
    const store = new UsageStore({ file });
    store.record({ key: '', usage: { inputTokens: 99 } });
    const summary = store.summary();
    assert.equal(summary.total.turns, 1);
    assert.equal(summary.total.inputTokens, 1);
  } finally {
    cleanup(dir);
  }
});
