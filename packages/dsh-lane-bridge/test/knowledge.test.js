import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  approveDraft, discardDraft, formatDocument, listDrafts, listKnowledge, matchDocuments, moveKnowledge,
  parseDocument, readKnowledge, searchKnowledge, writeDraft, writeKnowledge,
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

test('documents parse their own frontmatter without touching the body', () => {
  const withHead = parseDocument('---\ntitle: 存档位置\ntriggers: 存档, 存档在哪，save\ndomains: default, vip\nalways: true\n---\n\n# 存档\n\n正文。\n');
  assert.equal(withHead.meta.title, '存档位置');
  assert.deepEqual(withHead.meta.triggers, ['存档', '存档在哪', 'save']);
  assert.deepEqual(withHead.meta.domains, ['default', 'vip']);
  assert.equal(withHead.meta.always, true);
  assert.equal(withHead.body.trim(), '# 存档\n\n正文。');

  // List form and no frontmatter at all.
  const listForm = parseDocument('---\ntriggers:\n  - 联机\n  - 好友\n---\n正文\n');
  assert.deepEqual(listForm.meta.triggers, ['联机', '好友']);
  const plain = parseDocument('# 标题\n\n正文\n');
  assert.deepEqual(plain.meta.triggers, []);
  assert.equal(plain.hasFrontmatter, false);
  assert.match(plain.body, /# 标题/u);

  // Round trip: rendering then parsing gives the same metadata.
  const rendered = formatDocument({ meta: { title: 'T', triggers: ['a', 'b'], domains: ['x'], always: true }, body: '# T\n\nx' });
  const back = parseDocument(rendered);
  assert.deepEqual(back.meta, { title: 'T', triggers: ['a', 'b'], domains: ['x'], always: true });
  assert.equal(back.body.trim(), '# T\n\nx');
  // No metadata means no frontmatter block is emitted.
  assert.equal(formatDocument({ meta: { triggers: [] }, body: '# x' }), '# x');
});

test('matchDocuments picks documents by their own triggers, never the whole base', () => {
  const dir = tempDir();
  try {
    seed(dir);
    writeKnowledge(dir, '客服', '存档.md', '# 存档位置\n\n在 saves 目录。\n', { triggers: ['存档', 'save'] });
    writeKnowledge(dir, '客服', '联机.md', '# 联机\n\n只支持局域网。\n', { triggers: ['联机'] });
    writeKnowledge(dir, '产品', '概述.md', '# 产品\n\n卡牌游戏。\n', { triggers: [], always: true });

    const hit = matchDocuments(dir, ['客服'], '存档在哪');
    assert.deepEqual(hit.map((doc) => doc.path), ['存档.md']);
    assert.deepEqual(hit[0].matched, ['存档']);
    assert.match(hit[0].body, /saves/u);

    // A different trigger selects a different single document.
    const other = matchDocuments(dir, ['客服'], '联机怎么开');
    assert.deepEqual(other.map((doc) => doc.path), ['联机.md']);

    // No hit at all → nothing (the seeded docs have no triggers).
    assert.deepEqual(matchDocuments(dir, ['客服'], '你好'), []);

    // `always: true` documents are included regardless of the text.
    const always = matchDocuments(dir, ['产品'], '随便');
    assert.deepEqual(always.map((doc) => doc.path), ['概述.md']);
    assert.equal(always[0].always, true);
  } finally {
    cleanup(dir);
  }
});

test('writeKnowledge stores frontmatter and readKnowledge hides it from the body', () => {
  const dir = tempDir();
  try {
    seed(dir);
    writeKnowledge(dir, '客服', '触发.md', '# 正文标题\n\n内容。\n', { title: '标题', triggers: ['甲'], always: false });
    const raw = fs.readFileSync(path.join(dir, '客服', '触发.md'), 'utf8');
    assert.match(raw, /^---\ntitle: 标题\ntriggers: 甲\n---/u);
    const read = readKnowledge(dir, ['客服'], '客服/触发.md');
    assert.equal(read.ok, true);
    assert.equal(read.title, '标题');
    assert.deepEqual(read.triggers, ['甲']);
    assert.doesNotMatch(read.content, /^---/u);
    assert.match(read.content, /正文标题/u);
    // Search must not match frontmatter-only words.
    const miss = searchKnowledge(dir, ['客服'], '甲');
    assert.equal(miss.hits.some((hit) => hit.path === '触发.md'), false);
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

test('documents belong to their knowledge base, not to a per-document domain list', async () => {
  const dir = tempDir();
  try {
    writeKnowledge(dir, '宝具', '机制.md', '# 宝具\n\n正文 A\n', { title: '宝具机制', triggers: ['宝具'] });
    // Legacy frontmatter naming another domain must no longer hide the document:
    // the domain reaches it by binding the knowledge base.
    writeKnowledge(dir, '存档', '位置.md', '# 存档\n\n正文 B\n', { title: '存档位置', triggers: ['存档'], domains: ['vip'] });
    const listed = listKnowledge(dir, ['宝具', '存档']);
    assert.deepEqual(listed.files.map((file) => `${file.scope}/${file.path}`).sort(), ['存档/位置.md', '宝具/机制.md']);
    assert.equal(listed.files[0].domains, undefined, 'documents no longer expose a domain list');
    assert.deepEqual(matchDocuments(dir, ['宝具', '存档'], '宝具不生效').map((doc) => doc.scope), ['宝具']);
    // An empty binding means "no knowledge", never "everything on disk".
    assert.equal(listKnowledge(dir, []).count, 0);
    assert.deepEqual(matchDocuments(dir, [], '宝具不生效'), []);
  } finally {
    cleanup(dir);
  }
});

test('documents can be renamed and moved between knowledge bases', async () => {
  const dir = tempDir();
  try {
    writeKnowledge(dir, '宝具', '机制.md', '# 宝具机制\n\n正文\n', { title: '宝具机制', triggers: ['宝具'] });
    fs.mkdirSync(path.join(dir, '存档'), { recursive: true });
    fs.writeFileSync(path.join(dir, '存档', '占位.md'), '# 占位\n', 'utf8');

    const renamed = moveKnowledge(dir, { scope: '宝具', path: '机制.md', targetScope: '宝具', targetPath: '宝具机制.md' });
    assert.equal(renamed.ok, true);
    assert.ok(fs.existsSync(path.join(dir, '宝具', '宝具机制.md')));
    assert.ok(!fs.existsSync(path.join(dir, '宝具', '机制.md')));

    const moved = moveKnowledge(dir, { scope: '宝具', path: '宝具机制.md', targetScope: '存档', targetPath: '图鉴.md' });
    assert.equal(moved.ok, true);
    assert.deepEqual({ scope: moved.scope, path: moved.path }, { scope: '存档', path: '图鉴.md' });
    assert.ok(fs.existsSync(path.join(dir, '存档', '图鉴.md')));
    assert.equal(listKnowledge(dir, ['宝具']).count, 0, 'the source base is empty');
    assert.deepEqual(listKnowledge(dir, ['存档']).files.map((file) => file.path).sort(), ['占位.md', '图鉴.md']);

    // Overwriting an existing document needs an explicit force.
    const clash = moveKnowledge(dir, { scope: '存档', path: '图鉴.md', targetScope: '存档', targetPath: '占位.md' });
    assert.equal(clash.ok, false);
    assert.match(clash.message, /目标已存在/u);
    const forced = moveKnowledge(dir, { scope: '存档', path: '图鉴.md', targetScope: '存档', targetPath: '占位.md', force: true });
    assert.equal(forced.ok, true);

    // Missing source / unknown target base are reported, not thrown.
    assert.equal(moveKnowledge(dir, { scope: '存档', path: '不存在.md', targetScope: '存档', targetPath: 'x.md' }).ok, false);
    assert.equal(moveKnowledge(dir, { scope: '存档', path: '占位.md', targetScope: '没有这个库', targetPath: 'x.md' }).ok, false);
    assert.equal(moveKnowledge(dir, { scope: '存档', path: '../默认/逃逸.md', targetScope: '存档', targetPath: 'x.md' }).ok, false);
  } finally {
    cleanup(dir);
  }
});
