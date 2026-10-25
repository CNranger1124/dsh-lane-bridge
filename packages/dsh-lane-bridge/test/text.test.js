import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnCollector } from '../lib/turn.js';
import { normalizeMessages, splitText, stripMarkdown } from '../lib/text.js';

test('turn collector groups text by turn and ignores chunks', () => {
  const collector = createTurnCollector();
  assert.equal(collector.push({ type: 'turn/start', data: { turn: 1 } }), null);
  collector.push({ type: 'assistant/chunk', data: { turn: 1, text: 'chunk' } });
  collector.push({ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '你好' }] } } });
  const ended = collector.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal(ended.text, '你好');
  assert.equal(ended.reason.kind, 'completed');
  assert.equal(collector.size(), 0);
});

test('turn collector reports errors and tolerates missing turns', () => {
  const collector = createTurnCollector();
  collector.push({ type: 'turn/start', data: { turn: 2 } });
  const ended = collector.push({ type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } });
  assert.equal(ended.reason.kind, 'error');
  assert.equal(collector.push({ type: 'turn/end', data: { turn: 3 } }), null);
});

test('stripMarkdown removes chat-noise markup', () => {
  const text = '## 标题\n**重要** 和 `code`\n```js\nconsole.log(1)\n```\n- 列表';
  const out = stripMarkdown(text);
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('##'));
  assert.ok(!out.includes('```'));
  assert.match(out, /code/);
  assert.match(out, /console\.log/);
});

test('splitText respects the limit and prefers paragraph boundaries', () => {
  const chunks = splitText('a'.repeat(300) + '\n\n' + 'b'.repeat(300), 400);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], 'a'.repeat(300));
  assert.equal(chunks[1], 'b'.repeat(300));
});

test('normalizeMessages accepts strings and arrays', () => {
  assert.deepEqual(normalizeMessages(' hi '), ['hi']);
  assert.deepEqual(normalizeMessages([' a ', '', 'b']), ['a', 'b']);
  assert.deepEqual(normalizeMessages(undefined), []);
});
