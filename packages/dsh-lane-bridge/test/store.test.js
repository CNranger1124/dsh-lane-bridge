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
  assert.equal(state.bindings['snowluma:group:1'], undefined);
  assert.equal(state.bindings['bad-key'], undefined);
  assert.equal(state.bindings['snowluma:private:2'].enabled, false);
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
