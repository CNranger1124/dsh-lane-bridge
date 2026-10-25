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
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', 'default', '知识库.md')));
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

test('roles carry the domain and old domain.role state is migrated', () => {
  const state = normalizeState({
    domains: [
      { id: 'default', name: '默认', role: '客服' },
      { id: 'game', name: '游戏', role: '游戏客服' },
    ],
    roles: [
      { name: '客服', content: '# A' },
      { name: '游戏客服', content: '# B' },
      { name: '无主', content: '# C' },
    ],
  });
  const byName = Object.fromEntries(state.roles.map((role) => [role.name, role]));
  assert.equal(byName['客服'].domainId, 'default');
  assert.equal(byName['游戏客服'].domainId, 'game');
  // A role that names no domain falls back to the first domain.
  assert.equal(byName['无主'].domainId, 'default');
  // The domain no longer points at a role.
  assert.equal(state.domains[0].role, undefined);
  assert.equal(state.domains[1].role, undefined);
});

test('a binding role decides its domain, legacy domainId stays only as a hint', () => {
  const state = normalizeState({
    domains: [{ id: 'default' }, { id: 'game' }],
    roles: [
      { name: '客服', content: '# A', domainId: 'default' },
      { name: '游戏客服', content: '# B', domainId: 'game' },
    ],
    bindings: {
      'snowluma:group:1': { role: '游戏客服', domainId: 'default' },
      'snowluma:group:2': { domainId: 'game' },
    },
  });
  // The role wins over a stale domainId on the row.
  assert.equal(state.bindings['snowluma:group:1'].role, '游戏客服');
  assert.equal(state.bindings['snowluma:group:2'].domainId, 'game');
  // A migrated domain-only row is pinned to the role of that domain, so the UI
  // shows what the conversation really uses.
  assert.equal(state.bindings['snowluma:group:2'].role, '游戏客服');
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

    // Bookkeeping is deferred: a full-message group must not rewrite state.json
    // once per message, so the file still lags until the coalescing timer fires.
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.equal(onDisk.conversations['qqbot:group:F84F'], undefined, 'bursty writes are coalesced');
    await store.flush();
    const flushed = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.equal(flushed.conversations['qqbot:group:F84F'].seenCount, 2, 'flush persists the coalesced write');

    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.deepEqual(Object.keys(reload.get().conversations['qqbot:group:F84F'].senders).sort(), ['qqbot:8FD9', 'qqbot:AAAA']);
  } finally {
    cleanup(dir);
  }
});

test('a burst of conversation touches collapses into a single write', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir, saveDelayMs: 15 });
    await store.load();
    let writes = 0;
    const writeNow = store.saveNow.bind(store);
    store.saveNow = () => { writes += 1; writeNow(); };
    for (let index = 0; index < 20; index += 1) {
      await store.touchConversation({
        key: 'qqbot:group:F84F', channel: 'qqbot', kind: 'group', externalId: 'F84F',
        name: '群 F84F', lastAt: index, lastText: `第 ${index} 条`, senderId: '8FD9', senderName: 'RANGER',
      });
    }
    assert.equal(writes, 0, 'nothing is written while the burst is arriving');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(writes, 1, 'the whole burst is persisted once');
    assert.equal(store.get().conversations['qqbot:group:F84F'].seenCount, 20);
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
  state.config.channels['qqbot-2'] = { kind: 'qqbot', label: '砂金', enabled: true, appId: '2', appSecret: 'qq2', allowActive: false };
  state.config.github.token = 'gh';
  const { state: safe, secretStatus } = redactState(state);
  assert.equal(safe.config.pushToken, '');
  assert.equal(safe.config.channels.snowluma.accessToken, '');
  assert.equal(safe.config.channels.qqbot.appSecret, '');
  assert.equal(safe.config.channels['qqbot-2'].appSecret, '');
  assert.equal(safe.config.github.token, '');
  // Presence is per instance: a blank field on the 通道 card must keep *that*
  // bot's secret, and the other bot's secret must not be mistaken for it.
  assert.deepEqual(secretStatus, {
    pushToken: true,
    githubToken: true,
    channelSecrets: { snowluma: true, qqbot: true, discord: true, 'qqbot-2': true },
  });
});

test('channel instances normalize by kind and keep the legacy ids', () => {
  const state = normalizeState({
    config: {
      channels: {
        // 0.7.x shape: id implies the kind, no label yet.
        qqbot: { enabled: true, appId: '102111', appSecret: 's1' },
        // 0.8.0 shape: a second bot of the same kind.
        'qqbot-2': { kind: 'qqbot', label: '砂金客服', enabled: true, appId: '102222', appSecret: 's2' },
        // Valid id but no kind → not a transport we know, dropped.
        'snowluma-9': { wsUrl: 'ws://127.0.0.1:3001' },
        // Known kind but an unknown transport → dropped.
        'qqbot-3': { kind: 'telegram', appId: '102333' },
        // Spaces/case are not a valid conversation-key prefix → dropped.
        'QQ Bot 2': { kind: 'qqbot', appId: '102444' },
      },
    },
  });
  assert.deepEqual(Object.keys(state.config.channels).sort(), ['qqbot', 'qqbot-2']);
  assert.equal(state.config.channels.qqbot.kind, 'qqbot');
  assert.equal(state.config.channels.qqbot.label, '官方 QQ Bot');
  assert.equal(state.config.channels['qqbot-2'].label, '砂金客服');
  assert.equal(state.config.channels['qqbot-2'].appSecret, 's2');
  // A domain from an older state has no bot binding.
  assert.equal(state.domains[0].channelId, '');
});

test('the channel map is authoritative: a deleted bot stays deleted across reloads', async () => {
  const dir = tempDir();
  try {
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    await store.setConfig({
      channels: { 'qqbot-2': { kind: 'qqbot', label: '砂金', enabled: true, appId: '2', appSecret: 's2' } },
    });
    assert.equal(store.get().config.channels['qqbot-2'].label, '砂金');
    // Point the default domain at the new bot, then delete the bot.
    await store.setDomains(store.get().domains.map((domain) => ({ ...domain, channelId: 'qqbot-2' })));
    assert.equal(store.get().domains[0].channelId, 'qqbot-2');

    await store.removeChannels(['qqbot-2']);
    assert.equal(store.get().config.channels['qqbot-2'], undefined);
    assert.equal(store.get().config.channels.qqbot.kind, 'qqbot');
    // The domain falls back to generic routing instead of silently answering
    // nothing.
    assert.equal(store.get().domains[0].channelId, '');

    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.equal(reload.get().config.channels['qqbot-2'], undefined);
    assert.equal(reload.get().config.channels.qqbot.kind, 'qqbot');
  } finally {
    cleanup(dir);
  }
});

test('knowledge bases are adopted from disk and default is always registered', async () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, 'knowledge', '手写知识库'), { recursive: true });
    const store = new LaneStore({ dataDir: dir });
    await store.load();
    const ids = store.get().knowledgeBases.map((kb) => kb.id).sort();
    assert.deepEqual(ids, ['default', '手写知识库'].sort());
    // The registry round-trips through state.json.
    const reload = new LaneStore({ dataDir: dir });
    await reload.load();
    assert.deepEqual(reload.get().knowledgeBases.map((kb) => kb.id).sort(), ids);
  } finally {
    cleanup(dir);
  }
});
