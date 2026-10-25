import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationKey, parseConversationKey, defaultState, sampleRoleCard } from '../lib/defaults.js';
import { resolveConversation, canReply, shouldTrigger, buildContextPrefix, roleContent, isOperator } from '../lib/router.js';

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

test('domains can override the global GitHub repository and branch', () => {
  const state = defaultState();
  state.config.github = { ...(state.config.github ?? {}), repo: 'global/repo', branch: 'main' };
  state.domains.push({
    ...state.domains[0],
    id: 'game',
    name: '游戏客服',
    repo: 'studio/game',
    branch: 'release',
  });
  state.bindings['snowluma:group:9'] = { domainId: 'game', enabled: true };
  const bound = resolveConversation(state, 'snowluma:group:9');
  assert.equal(bound.repo, 'studio/game');
  assert.equal(bound.repoBranch, 'release');
  const fallback = resolveConversation(state, 'snowluma:group:10');
  assert.equal(fallback.repo, 'global/repo');
  assert.equal(fallback.repoBranch, 'main');
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
  state.domains[0].triggers = ['mention'];
  state.domains[0].autoReply = true;
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true };
  state.bindings['snowluma:private:2'] = { domainId: 'default', enabled: true };
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi' }), false);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi', mentionsBot: true }), true);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: 'hi', replyToBot: true }), true);
  assert.equal(shouldTrigger(state, 'snowluma:private:2', { kind: 'private', text: 'hi' }), true);

  state.domains[0].triggers = ['keyword'];
  state.domains[0].keywords = ['存档', '闪退'];
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '存档在哪' }), true);
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '你好' }), false);

  state.domains[0].triggers = ['off'];
  assert.equal(shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '存档' }), false);
  assert.equal(shouldTrigger(state, 'snowluma:private:2', { kind: 'private', text: 'hi' }), false);
});

test('mention and keyword triggers combine with OR', () => {
  const state = defaultState();
  state.domains[0].autoReply = true;
  state.domains[0].triggers = ['mention', 'keyword'];
  state.domains[0].keywords = ['存档', '闪退'];
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true };
  const group = (extra) => shouldTrigger(state, 'snowluma:group:1', { kind: 'group', text: '你好', ...extra });
  // Either policy alone is enough.
  assert.equal(group({ mentionsBot: true }), true);
  assert.equal(group({ text: '存档在哪' }), true);
  // Neither hit means stay quiet.
  assert.equal(group({ text: '大家早上好' }), false);
  // `all` wins over the other policies.
  state.domains[0].triggers = ['mention', 'keyword', 'all'];
  assert.equal(group({ text: '随便聊聊' }), true);
  // `off` is exclusive and stops everything, even a mention.
  state.domains[0].triggers = ['off', 'mention'];
  assert.equal(group({ mentionsBot: true }), false);
});


test('paused bindings stop auto-replies until resumed', () => {
  const state = defaultState();
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true, paused: true };
  const resolved = resolveConversation(state, 'snowluma:group:1');
  assert.equal(resolved.paused, true);
  assert.equal(canReply(state, 'snowluma:group:1'), false);
});


test('operator whitelist is per-domain, channel-scoped, and empty means nobody', () => {
  const state = defaultState();
  state.bindings['snowluma:group:1'] = { domainId: 'default', enabled: true };
  state.bindings['qqbot:group:9'] = { domainId: 'default', enabled: true };
  // Default install: no administrators at all.
  assert.equal(isOperator(state, 'snowluma:group:1', '123'), false);

  state.domains[0].operators = ['snowluma:123', 'qqbot:8FD96C63'];
  assert.equal(isOperator(state, 'snowluma:group:1', '123'), true);
  // Channel prefix must match: the same id on another channel is not enough.
  assert.equal(isOperator(state, 'qqbot:group:9', '123'), false);
  assert.equal(isOperator(state, 'qqbot:group:9', '8FD96C63'), true);
  // A channel-less entry matches any channel.
  state.domains[0].operators = ['123'];
  assert.equal(isOperator(state, 'qqbot:group:9', '123'), true);
  assert.equal(isOperator(state, 'snowluma:group:1', ''), false);

  // `*` is the explicit "trust the room" escape hatch.
  state.domains[0].operators = ['*'];
  assert.equal(isOperator(state, 'snowluma:group:1', 'anyone'), true);

  // A second domain does not inherit the first domain's whitelist.
  state.domains.push({ ...state.domains[0], id: 'vip', name: 'VIP', operators: [] });
  state.bindings['snowluma:group:2'] = { domainId: 'vip', enabled: true };
  assert.equal(isOperator(state, 'snowluma:group:2', 'anyone'), false);
});

test('the prompt marks an operator and stays quiet for everyone else', () => {
  const base = {
    resolved: { domain: { name: '默认客服' }, role: '客服' },
    roleText: '', memoryText: '', channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明',
  };
  assert.match(buildContextPrefix(base), /本次发言者：小明\n/u);
  assert.match(buildContextPrefix({ ...base, senderIsOperator: true }), /本次发言者：小明（本领域管理员，可执行管理操作）/u);
});
