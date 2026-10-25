import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationKey, parseConversationKey, defaultState, sampleRoleCard } from '../lib/defaults.js';
import { resolveConversation, canReply, shouldTrigger, buildContextPrefix, roleContent } from '../lib/router.js';

test('conversation keys round-trip', () => {
  const key = conversationKey('snowluma', 'group', 123456);
  assert.equal(key, 'snowluma:group:123456');
  assert.deepEqual(parseConversationKey(key), {
    channel: 'snowluma', kind: 'group', externalId: '123456', key,
  });
  assert.equal(parseConversationKey('bad'), null);
});

test('default state is usable and self-consistent', () => {
  const state = defaultState();
  assert.equal(state.config.defaultDomainId, 'default');
  assert.equal(state.domains.length, 1);
  assert.equal(state.roles[0].name, '客服');
  assert.equal(state.roles[0].content, sampleRoleCard());
  assert.ok(state.domains[0].knowledgeScopes.includes('default'));
});

test('unbound conversations resolve to defaults but do not auto-reply', () => {
  const state = defaultState();
  const resolved = resolveConversation(state, 'snowluma:private:42');
  assert.equal(resolved.bound, false);
  assert.equal(resolved.domain.id, 'default');
  assert.equal(resolved.role, '客服');
  assert.equal(resolved.autoReply, false);
  assert.equal(canReply(state, 'snowluma:private:42'), false);
});

test('explicit private auto-reply turns an unbound private chat on', () => {
  const state = defaultState();
  state.config.autoReplyPrivate = true;
  assert.equal(canReply(state, 'snowluma:private:42'), true);
  assert.equal(canReply(state, 'snowluma:group:42'), false);
});

test('bindings override domain and per-conversation role/model', () => {
  const state = defaultState();
  state.roles.push({ name: 'VIP', content: '# VIP' });
  state.domains.push({
    ...state.domains[0],
    id: 'vip',
    name: 'VIP 客服',
    role: 'VIP',
    knowledgeScopes: ['vip'],
    allowedHostTools: ['web_search'],
    autoReply: true,
  });
  state.bindings['snowluma:group:123'] = {
    domainId: 'vip',
    enabled: true,
    role: '客服',
    preset: '',
    model: 'deepseek/deepseek-flash',
  };
  const resolved = resolveConversation(state, 'snowluma:group:123');
  assert.equal(resolved.bound, true);
  assert.equal(resolved.domain.id, 'vip');
  assert.equal(resolved.role, '客服');
  assert.equal(resolved.model, 'deepseek/deepseek-flash');
  assert.deepEqual(resolved.knowledgeScopes, ['vip']);
  assert.deepEqual(resolved.allowedHostTools, ['web_search']);
  assert.equal(resolved.autoReply, true);
  assert.equal(canReply(state, 'snowluma:group:123'), true);
});

test('disabled bindings fall back to unbound behavior', () => {
  const state = defaultState();
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: false };
  const resolved = resolveConversation(state, 'snowluma:group:1');
  assert.equal(resolved.bound, false);
  assert.equal(resolved.autoReply, false);
});

test('context prefix injects channel facts, domain prompt, and role card', () => {
  const state = defaultState();
  state.domains[0].systemPrompt = '不要说方言。';
  const resolved = resolveConversation(state, 'snowluma:group:9');
  const prefix = buildContextPrefix({
    resolved,
    roleText: roleContent(state, '客服'),
    channel: 'snowluma',
    kind: 'group',
    externalId: '9',
    senderName: '小明',
  });
  assert.match(prefix, /snowluma/);
  assert.match(prefix, /群聊/);
  assert.match(prefix, /小明/);
  assert.match(prefix, /不要说方言/);
  assert.match(prefix, /角色卡：客服/);
  assert.match(prefix, /【用户消息】/);
});


test('trigger policy gates group messages but not private chats', () => {
  const state = defaultState();
  state.roles.push({ name: 'VIP', content: '# VIP' });
  state.domains[0].trigger = 'mention';
  state.domains[0].autoReply = true;
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true };
  state.bindings['snowluma:private:2'] = { domainId: 'default', enabled: true };
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi' }), false);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi', mentionsBot: true }), true);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi', replyToBot: true }), true);
  assert.equal(shouldTrigger(state, 'snowluma:private:2', { kind: 'private', text: 'hi' }), true);

  state.domains[0].trigger = 'keyword';
  state.domains[0].keywords = ['存档', '闪退'];
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '存档在哪' }), true);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '你好' }), false);

  state.domains[0].trigger = 'off';
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '存档' }), false);
  assert.equal(shouldTrigger(state, 'snowluma:private:2', { kind: 'private', text: 'hi' }), false);
});


test('paused bindings stop auto-replies until resumed', () => {
  const state = defaultState();
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true, paused: true };
  const resolved = resolveConversation(state, 'snowluma:group:1');
  assert.equal(resolved.paused, true);
  assert.equal(canReply(state, 'snowluma:group:1'), false);
});
