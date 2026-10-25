import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTemplate, renderTemplate, TEMPLATE_VARIABLES, TEMPLATE_CONDITIONS } from '../lib/template.js';

test('plain text passes through untouched', () => {
  assert.equal(renderTemplate('普通角色卡，没有变量。', { operator: true }), '普通角色卡，没有变量。');
  assert.equal(renderTemplate('', {}), '');
  assert.equal(renderTemplate(null, {}), '');
  assert.equal(hasTemplate('no braces'), false);
  assert.equal(hasTemplate('{{identity}}'), true);
});

test('variables interpolate and unknown names disappear instead of leaking', () => {
  const ctx = { identity: '管理员', sender: '小明', channel: 'qqbot', group: true, operator: true };
  assert.equal(renderTemplate('身份：{{identity}}，来自 {{channel}}，{{sender}}', ctx), '身份：管理员，来自 qqbot，小明');
  // A typo must degrade to "missing words", never to a literal {{oops}}.
  assert.equal(renderTemplate('A{{oops}}B', ctx), 'AB');
  // Booleans are readable, objects are not allowed to stringify into [object Object].
  assert.equal(renderTemplate('{{operator}}', ctx), '是');
  assert.equal(renderTemplate('{{nested}}', { nested: { a: 1 } }), '');
});

test('conditional blocks pick the right branch for administrators', () => {
  const card = '## 权限\n{{#if operator}}可以建 issue、看内部排期。{{else}}只做客服，不透露内部信息。{{/if}}';
  assert.match(renderTemplate(card, { operator: true }), /可以建 issue、看内部排期。/u);
  assert.doesNotMatch(renderTemplate(card, { operator: true }), /只做客服/u);
  assert.match(renderTemplate(card, { operator: false }), /只做客服，不透露内部信息。/u);
  assert.doesNotMatch(renderTemplate(card, { operator: false }), /建 issue/u);
});

test('a missing else means "render nothing" and text around the block survives', () => {
  const card = '前 {{#if operator}}仅管理员可见{{/if}} 后';
  assert.equal(renderTemplate(card, { operator: true }).replace(/\s+/gu, ' '), '前 仅管理员可见 后');
  assert.equal(renderTemplate(card, { operator: false }).replace(/\s+/gu, ' '), '前 后');
});

test('group/private conditions work and blocks may contain variables', () => {
  const card = '{{#if group}}群聊里的{{sender}}{{else}}私聊里的{{sender}}{{/if}}';
  assert.equal(renderTemplate(card, { group: true, sender: '小明' }), '群聊里的小明');
  assert.equal(renderTemplate(card, { group: false, sender: '小明' }), '私聊里的小明');
});

test('unknown conditions are false, and multiple blocks render independently', () => {
  assert.equal(renderTemplate('{{#if nope}}x{{/if}}ok', {}), 'ok');
  const card = '{{#if operator}}A{{/if}}{{#if group}}B{{/if}}';
  assert.equal(renderTemplate(card, { operator: true, group: false }), 'A');
  assert.equal(renderTemplate(card, { operator: false, group: true }), 'B');
});

test('documented vocabulary stays in sync with the renderer', () => {
  const names = TEMPLATE_VARIABLES.map(([name]) => name);
  assert.deepEqual(names, ['identity', 'sender', 'senderId', 'channel', 'kind', 'externalId', 'domain', 'role']);
  assert.deepEqual(TEMPLATE_CONDITIONS, ['operator', 'group', 'private']);
});
