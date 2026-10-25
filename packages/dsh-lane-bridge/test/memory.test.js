import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../lib/memory.js';
import { tempDir, cleanup } from './helpers.js';

test('MemoryStore appends, dedupes, and renders newest entries first', () => {
  const dir = tempDir();
  try {
    const store = new MemoryStore({ dir: path.join(dir, 'memories') });
    store.append('support', '玩家 A 在 1.2.3 合成界面点星标没反应');
    store.append('support', '玩家 A 是 Windows 11');
    store.append('support', '玩家 A 在 1.2.3 合成界面点星标没反应');
    const data = store.load('support');
    assert.equal(data.entries.length, 2);
    const text = store.render('support', 2000);
    assert.match(text, /Windows 11/);
    assert.match(text, /星标/);
    assert.ok(text.indexOf('Windows 11') < text.indexOf('星标'), 'newest first');
  } finally {
    cleanup(dir);
  }
});

test('MemoryStore replace/clear and maxChars truncation', () => {
  const dir = tempDir();
  try {
    const store = new MemoryStore({ dir: path.join(dir, 'memories') });
    const result = store.replace('support', '- 第一条\n- 第二条\n\n- 第二条\n- 第三条');
    assert.equal(result.count, 3);
    const short = store.render('support', 200);
    assert.ok(short.length <= 200);
    store.clear('support');
    assert.equal(store.load('support').entries.length, 0);
    assert.equal(store.render('support', 200), '');
  } finally {
    cleanup(dir);
  }
});

test('MemoryStore isolates domains and survives a corrupt file', () => {
  const dir = tempDir();
  try {
    const store = new MemoryStore({ dir: path.join(dir, 'memories') });
    store.append('a', 'A 的记忆');
    store.append('b', 'B 的记忆');
    assert.match(store.render('a'), /A 的记忆/);
    assert.doesNotMatch(store.render('a'), /B 的记忆/);
    fs.writeFileSync(path.join(dir, 'memories', 'a.json'), '{not json');
    assert.deepEqual(store.load('a').entries, []);
  } finally {
    cleanup(dir);
  }
});
