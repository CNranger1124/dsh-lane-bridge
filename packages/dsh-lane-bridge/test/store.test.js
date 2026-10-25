import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LaneStore, mergeConfig, normalizeState, redactState } from '../lib/store.js';
import { defaultState } from '../lib/defaults.js';
import { tempDir, cleanup } from './helpers.js';

test('LaneStore seeds state, role card, and knowledge base', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    assert.ok(fs.existsSync(path.join(dir, 'state.json')));
    assert.ok(fs.existsSync(path.join(dir, 'roles', '客服.md')));
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', 'default', '常见问题.md')));
    const state = store.get();
    assert.equal(state.version, 1);
    assert.equal(state.domains[0].id, 'default');
  } finally {
    cleanup(dir);
  }
});

test('state survives a reload and keeps secrets when the editor submits blanks', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    await store.setConfig({
      pushToken: 'push-secret',
      channels: { snowluma: { accessToken: 'ws-secret', wsUrl: 'ws://127.0.0.1:3001' } },
    });
    await store.setConfig({ pushToken: '', channels: { snowluma: { accessToken: '' } } });
    assert.equal(store.get().config.pushToken, 'push-secret');
    assert.equal(store.get().config.channels.snowluma.accessToken, 'ws-secret');

    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.equal(reload.get().config.pushToken, 'push-secret');
    assert.equal(reload.get().config.channels.snowluma.accessToken, 'ws-secret');
    assert.equal(reload.get().revision, store.get().revision);
  } finally {
    cleanup(dir);
  }
});

test('mergeConfig keeps placeholders and accepts real replacements', () => {
  const base = { pushToken: 'old', channels: { qqbot: { appSecret: 'old-secret' } }, github: { token: 'old-gh' } };
  const merged = mergeConfig(base, { pushToken: '__keep__', channels: { qqbot: { appSecret: 'new-secret' } }, github: { token: '' } });
  assert.equal(merged.pushToken, 'old');
  assert.equal(merged.channels.qqbot.appSecret, 'new-secret');
  assert.equal(merged.github.token, 'old-gh');
});

test('normalizeState repairs broken bindings/domains and keeps the default domain valid', () => {
  const state = normalizeState({
    config: { defaultDomainId: 'missing' },
    domains: [{ id: 'a' }, { id: 'a' }, { id: '' }],
    roles: [{ name: '客服', content: 'x' }],
    bindings: {
      'snowluma:group:1': { domainId: 'missing' },
      'bad-key': { domainId: 'a' },
      'snowluma:private:2': { domainId: 'a', enabled: false },
    },
  });
  assert.equal(state.domains.length, 1);
  assert.equal(state.config.defaultDomainId, 'a');
  assert.equal(state.domains[0].repo, '');
  assert.equal(state.domains[0].branch, '');
  assert.equal(state.bindings['snowluma:group:1'], undefined);
  assert.equal(state.bindings['bad-key'], undefined);
  assert.equal(state.bindings['snowluma:private:2'].enabled, false);
});

test('normalizeState combines multi-select triggers and keeps the legacy field in sync', () => {
  const state = normalizeState({
    domains: [
      { id: 'a', triggers: ['keyword', 'mention'] },
      { id: 'b', trigger: 'keyword' },
      { id: 'c', triggers: ['off', 'mention'] },
      { id: 'd', triggers: [] },
    ],
    roles: [{ name: '客服', content: 'x' }],
  });
  assert.deepEqual(state.domains.find((d) => d.id === 'a').triggers, ['mention', 'keyword']);
  assert.equal(state.domains.find((d) => d.id === 'a').trigger, 'mention');
  assert.deepEqual(state.domains.find((d) => d.id === 'b').triggers, ['keyword'], 'old single-value state still works');
  assert.deepEqual(state.domains.find((d) => d.id === 'c').triggers, ['off'], 'off is exclusive');
  assert.deepEqual(state.domains.find((d) => d.id === 'd').triggers, ['all'], 'empty falls back to all');
});

test('normalizeState clamps the context-budget and retrieval knobs', () => {
  const state = normalizeState({
    domains: [{
      id: 'game',
      sessionMaxTurns: '12',
      kbAutoRetrieve: 'yes',
      kbTriggerKeywords: [' 存档 ', '存档', '', '闪退'],
      kbRetrieveChars: 99999,
      memoryMaxChars: 1,
    }],
    roles: [{ name: '客服', content: 'x' }],
  });
  const domain = state.domains[0];
  assert.equal(domain.sessionMaxTurns, 12);
  assert.equal(domain.kbAutoRetrieve, false, 'only a real true enables retrieval');
  assert.deepEqual(domain.kbTriggerKeywords, ['存档', '闪退']);
  assert.equal(domain.kbRetrieveChars, 8000);
  assert.equal(domain.memoryMaxChars, 200);

  const defaults = normalizeState({ domains: [{ id: 'x' }], roles: [{ name: '客服', content: 'x' }] });
  assert.equal(defaults.domains[0].sessionMaxTurns, 0);
  assert.equal(defaults.domains[0].kbRetrieveChars, 1500);
  assert.deepEqual(defaults.domains[0].kbTriggerKeywords, []);

  const bad = normalizeState({ domains: [{ id: 'x', sessionMaxTurns: -5 }], roles: [{ name: '客服', content: 'x' }] });
  assert.equal(bad.domains[0].sessionMaxTurns, 0);
});

test('normalizeState keeps per-domain repository overrides', () => {
  const state = normalizeState({
    domains: [{
      id: 'game',
      name: '游戏',
      repo: '  studio/game  ',
      branch: ' release ',
      repoEnabled: true,
    }],
    roles: [{ name: '客服', content: 'x' }],
  });
  assert.equal(state.domains[0].repo, 'studio/game');
  assert.equal(state.domains[0].branch, 'release');
  assert.equal(state.domains[0].repoEnabled, true);
});

test('normalizeState keeps a clean operator whitelist and drops junk', () => {
  const state = normalizeState({
    domains: [{
      id: 'game',
      operators: ['snowluma:123', ' snowluma:123 ', '@qqbot:8FD9', '', 'has space', 'a:b:c', 42, '*'],
    }],
    roles: [{ name: '客服', content: 'x' }],
  });
  assert.deepEqual(state.domains[0].operators, ['snowluma:123', 'qqbot:8FD9', '42', '*']);

  const empty = normalizeState({ domains: [{ id: 'x' }], roles: [{ name: '客服', content: 'x' }] });
  assert.deepEqual(empty.domains[0].operators, [], 'missing whitelist means nobody');
});

test('conversations remember recent senders in whitelist format', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    await store.touchConversation({
      key: 'qqbot:group:F84F', channel: 'qqbot', kind: 'group', externalId: 'F84F',
      name: '群 F84F', lastAt: 1, lastText: 'hi', senderId: '8FD9', senderName: 'RANGER',
    });
    await store.touchConversation({
      key: 'qqbot:group:F84F', channel: 'qqbot', kind: 'group', externalId: 'F84F',
      name: '群 F84F', lastAt: 2, lastText: 'hi again', senderId: 'AAAA', senderName: '阿明',
    });
    const convo = store.get().conversations['qqbot:group:F84F'];
    assert.deepEqual(Object.keys(convo.senders).sort(), ['qqbot:8FD9', 'qqbot:AAAA']);
    assert.equal(convo.senders['qqbot:AAAA'].name, '阿明');
    assert.equal(convo.senderId, undefined, 'per-message sender is not duplicated at the top level');

    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.deepEqual(Object.keys(reload.get().conversations['qqbot:group:F84F'].senders).sort(), ['qqbot:8FD9', 'qqbot:AAAA']);
  } finally {
    cleanup(dir);
  }
});

test('role files are the editable source of truth and deleted roles remove files', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    await store.setRoles([
      { name: '客服', content: '# 新客服' },
      { name: 'VIP', content: '# VIP' },
    ]);
    assert.equal(fs.readFileSync(path.join(dir, 'roles', '客服.md'), 'utf8'), '# 新客服');
    assert.ok(fs.existsSync(path.join(dir, 'roles', 'VIP.md')));

    await store.setRoles([{ name: 'VIP', content: '# VIP2' }]);
    assert.ok(!fs.existsSync(path.join(dir, 'roles', '客服.md')));
    assert.equal(fs.readFileSync(path.join(dir, 'roles', 'VIP.md'), 'utf8'), '# VIP2');

    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.equal(reload.get().roles[0].name, 'VIP');
    assert.equal(reload.get().roles[0].content, '# VIP2');
  } finally {
    cleanup(dir);
  }
});

test('redactState never leaks secrets but reports presence', () => {
  const state = defaultState();
  state.config.pushToken = 'push';
  state.config.channels.snowluma.accessToken = 'ws';
  state.config.channels.qqbot.appSecret = 'qq';
  state.config.channels.discord.token = 'dc';
  state.config.github.token = 'gh';
  const { state: safe, secretStatus } = redactState(state);
  assert.equal(safe.config.pushToken, '');
  assert.equal(safe.config.channels.snowluma.accessToken, '');
  assert.equal(safe.config.channels.qqbot.appSecret, '');
  assert.equal(safe.config.github.token, '');
  assert.deepEqual(secretStatus, {
    pushToken: true,
    snowlumaAccessToken: true,
    qqbotAppSecret: true,
    discordToken: true,
    githubToken: true,
  });
});
