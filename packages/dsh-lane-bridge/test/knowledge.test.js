import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  approveDraft, discardDraft, listDrafts, listKnowledge, readKnowledge, searchKnowledge, writeDraft, writeKnowledge,
} from '../lib/knowledge.js';
import { tempDir, cleanup } from './helpers.js';

function seed(dir) {
  fs.mkdirSync(path.join(dir, '客服'), { recursive: true });
  fs.mkdirSync(path.join(dir, '产品'), { recursive: true });
  fs.writeFileSync(path.join(dir, '客服', '常见问题.md'), '# 常见问题\n\n## 存档在哪里\n\n存档在游戏目录的 saves 文件夹。\n\n## 能联机吗\n\n目前不支持联机。\n');
  fs.writeFileSync(path.join(dir, '客服', '排障.md'), '# 排障\n\n## 闪退\n\n先更新显卡驱动，再提供报错原文。\n');
  fs.writeFileSync(path.join(dir, '产品', '概述.md'), '# 产品\n\n这是一个卡牌游戏。\n');
  fs.mkdirSync(path.join(dir, '客服', '_待审'), { recursive: true });
  fs.writeFileSync(path.join(dir, '客服', '_待审', 'draft.md'), '# 未采纳\n\n这条不应被检索。\n');
}

test('listKnowledge shows scopes and hides drafts', () => {
  const dir = tempDir();
  try {
    seed(dir);
    const result = listKnowledge(dir, ['客服']);
    assert.deepEqual(result.scopes, ['产品', '客服']);
    assert.equal(result.count, 2);
    assert.ok(result.files.every((file) => !file.path.includes('_待审')));
  } finally {
    cleanup(dir);
  }
});

test('readKnowledge accepts scope-qualified and bare paths', () => {
  const dir = tempDir();
  try {
    seed(dir);
    const qualified = readKnowledge(dir, ['客服'], '客服/常见问题.md');
    assert.equal(qualified.ok, true);
    assert.match(qualified.content, /saves/);
    const bare = readKnowledge(dir, ['客服'], '常见问题.md');
    assert.equal(bare.ok, true);
    assert.equal(bare.scope, '客服');
  } finally {
    cleanup(dir);
  }
});

test('readKnowledge rejects traversal and non-text files', () => {
  const dir = tempDir();
  try {
    seed(dir);
    fs.writeFileSync(path.join(dir, '客服', 'secret.bin'), 'x');
    assert.equal(readKnowledge(dir, ['客服'], '../outside.md').ok, false);
    assert.equal(readKnowledge(dir, ['客服'], '/etc/passwd').ok, false);
    assert.equal(readKnowledge(dir, ['客服'], 'secret.bin').ok, false);
  } finally {
    cleanup(dir);
  }
});

test('searchKnowledge requires every term and returns snippets', () => {
  const dir = tempDir();
  try {
    seed(dir);
    const hit = searchKnowledge(dir, ['客服'], '存档 文件夹');
    assert.equal(hit.ok, true);
    assert.equal(hit.count, 1);
    assert.match(hit.hits[0].snippet, /saves/);
    const miss = searchKnowledge(dir, ['客服'], '存档 不存在');
    assert.equal(miss.count, 0);
    const all = searchKnowledge(dir, ['客服'], '闪退');
    assert.equal(all.count, 1);
    assert.equal(all.hits[0].path, '排障.md');
  } finally {
    cleanup(dir);
  }
});

test('draft lifecycle: write, hide, list, approve, discard', () => {
  const dir = tempDir();
  try {
    seed(dir);
    const draft = writeDraft(dir, '客服', {
      title: '存档位置在哪',
      content: 'Windows 存档在游戏目录的 saves 文件夹。',
      source: 'commit abc123',
    });
    assert.equal(draft.duplicate, false);
    assert.equal(draft.scope, '客服');
    assert.match(draft.file, /\.md$/);
    assert.equal(listKnowledge(dir, ['客服']).count, 2);
    assert.equal(readKnowledge(dir, ['客服'], '客服/_待审/' + draft.file).ok, false);
    assert.equal(searchKnowledge(dir, ['客服'], '存档').hits.some((hit) => hit.path.includes('_待审')), false);

    const listed = listDrafts(dir);
    assert.ok(listed.drafts.some((item) => item.file === draft.file && item.source === 'commit abc123'));
    assert.ok(listed.targets['客服'].includes('常见问题.md'));

    const approved = approveDraft(dir, { scope: '客服', file: draft.file, target: '常见问题.md' });
    assert.equal(approved.target, '常见问题.md');
    assert.match(fs.readFileSync(path.join(dir, '客服', '常见问题.md'), 'utf8'), /Windows 存档/);
    assert.equal(listDrafts(dir).drafts.some((item) => item.file === draft.file), false);

    const second = writeDraft(dir, '客服', {
      title: '临时结论',
      content: '这是一条准备丢弃的临时结论。',
      source: '群反馈',
    });
    discardDraft(dir, { scope: '客服', file: second.file });
    assert.equal(listDrafts(dir).drafts.some((item) => item.file === second.file), false);

    const duplicate = writeDraft(dir, '客服', {
      title: '重复标题',
      content: '重复内容至少十个字符。',
      source: 'commit x',
    });
    const again = writeDraft(dir, '客服', {
      title: '重复标题',
      content: '重复内容至少十个字符。',
      source: 'commit x',
    });
    assert.equal(again.duplicate, true);
    assert.equal(again.file, duplicate.file);
  } finally {
    cleanup(dir);
  }
});

test('writeKnowledge creates nested files and blocks escapes', () => {
  const dir = tempDir();
  try {
    seed(dir);
    const result = writeKnowledge(dir, '客服', '新目录/新文档.md', '# 新\n');
    assert.equal(result.scope, '客服');
    assert.ok(fs.existsSync(path.join(dir, '客服', '新目录', '新文档.md')));
    assert.throws(() => writeKnowledge(dir, '客服', '../escape.md', 'x'), /invalid|escapes/u);
    assert.throws(() => writeKnowledge(dir, '客服', 'x.bin', 'x'), /only/iu);
    assert.throws(() => writeKnowledge(dir, '..', 'x.md', 'x'), /scope/iu);
  } finally {
    cleanup(dir);
  }
});
