import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ChannelManager } from '../lib/channels/manager.js';
import { defaultConfig } from '../lib/defaults.js';

function fakeAdapter(id, kind) {
  const adapter = new EventEmitter();
  adapter.id = id;
  adapter.kind = kind;
  adapter.started = false;
  adapter.sent = [];
  adapter.state = { connected: false, selfId: '', nickname: '', lastError: '', lastEventAt: 0 };
  adapter.status = () => ({ id, kind, started: adapter.started, ...adapter.state });
  adapter.setStatus = (patch) => {
    adapter.state = { ...adapter.state, ...patch };
    adapter.emit('status', adapter.status());
  };
  adapter.setError = (error) => adapter.setStatus({ lastError: String(error?.message ?? error), connected: false });
  adapter.start = async () => {
    adapter.started = true;
    adapter.setStatus({ connected: true });
  };
  adapter.stop = async () => {
    adapter.started = false;
    adapter.setStatus({ connected: false });
  };
  adapter.send = async (conversation) => {
    adapter.sent.push(conversation);
    return [{ ok: true }];
  };
  return adapter;
}

function setup() {
  const config = defaultConfig();
  config.channels.qqbot = { ...config.channels.qqbot, enabled: true, appId: '102111', appSecret: 's1' };
  config.channels['qqbot-2'] = {
    kind: 'qqbot',
    label: '砂金客服',
    enabled: true,
    appId: '102222',
    appSecret: 's2',
    allowActive: false,
  };
  const manager = new ChannelManager({ getConfig: () => config, onMessage: () => {} });
  manager.buildAdapter = (id, entry) => fakeAdapter(id, entry.kind);
  return { config, manager };
}

test('every configured bot gets its own adapter and status', async () => {
  const { manager } = setup();
  await manager.sync();
  const statuses = manager.status();
  assert.deepEqual(statuses.map((item) => item.id), ['snowluma', 'qqbot', 'discord', 'qqbot-2']);
  assert.equal(statuses.find((item) => item.id === 'qqbot-2').label, '砂金客服');
  assert.equal(statuses.find((item) => item.id === 'qqbot-2').connected, true);
  assert.equal(statuses.find((item) => item.id === 'discord').connected, false);
  assert.equal(manager.adapterFor('qqbot').id, 'qqbot');
  assert.equal(manager.adapterFor('qqbot-2').id, 'qqbot-2');
});

test('restarting one bot rebuilds only that adapter', async () => {
  const { manager } = setup();
  await manager.sync();
  const first = manager.adapterFor('qqbot');
  const second = manager.adapterFor('qqbot-2');
  await manager.restart('qqbot-2');
  assert.equal(manager.adapterFor('qqbot'), first, 'the other bot is not reconnected');
  assert.equal(first.started, true);
  assert.notEqual(manager.adapterFor('qqbot-2'), second);
  assert.equal(manager.adapterFor('qqbot-2').started, true);
});

test('sync(ids) leaves other adapters untouched', async () => {
  const { manager } = setup();
  await manager.sync();
  const first = manager.adapterFor('qqbot');
  await manager.sync(['qqbot-2']);
  assert.equal(manager.adapterFor('qqbot'), first);
});

test('stopping one bot does not stop the others', async () => {
  const { config, manager } = setup();
  await manager.sync();
  const other = manager.adapterFor('qqbot-2');
  config.channels.qqbot.enabled = false;
  await manager.sync(['qqbot']);
  assert.equal(manager.adapterFor('qqbot'), null);
  assert.equal(manager.adapterFor('qqbot-2'), other);
  assert.equal(other.started, true);
  assert.equal(manager.status().find((item) => item.id === 'qqbot').enabled, false);
});

test('sendKey routes by instance id, not by kind', async () => {
  const { manager } = setup();
  await manager.sync();
  await manager.sendKey('qqbot-2:group:987654', ['hi']);
  assert.equal(manager.adapterFor('qqbot').sent.length, 0);
  assert.equal(manager.adapterFor('qqbot-2').sent.length, 1);
  assert.deepEqual(manager.adapterFor('qqbot-2').sent[0], {
    channel: 'qqbot-2',
    kind: 'group',
    externalId: '987654',
    reply: false,
    replyToId: '',
    replyToAt: 0,
  });
});

test('removing a bot from the config drops its status on the next full sync', async () => {
  const { config, manager } = setup();
  await manager.sync();
  delete config.channels['qqbot-2'];
  await manager.sync();
  assert.equal(manager.adapterFor('qqbot-2'), null);
  assert.equal(manager.status().some((item) => item.id === 'qqbot-2'), false);
});

test('a globally disabled plugin reports every bot as stopped', async () => {
  const { config, manager } = setup();
  config.enabled = false;
  await manager.sync();
  assert.equal(manager.adapterFor('qqbot'), null);
  const statuses = manager.status();
  assert.equal(statuses.length, 4);
  assert.ok(statuses.every((item) => item.enabled === false));
  assert.ok(statuses.every((item) => item.hint.includes('总开关')));
});
