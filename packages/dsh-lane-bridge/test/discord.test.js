import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DiscordAdapter } from '../lib/channels/discord.js';

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.user = { id: 'bot-1', username: 'lane-bot', tag: 'lane-bot#0001' };
    this.sent = [];
    this.destroyed = false;
    this.channels = {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          this.sent.push(payload);
          return { id: `sent-${this.sent.length}` };
        },
      }),
    };
    this.users = {
      fetch: async (id) => ({
        id,
        createDM: async () => ({
          send: async (payload) => {
            this.sent.push(payload);
            return { id: `dm-${this.sent.length}` };
          },
        }),
      }),
    };
  }
  login(token) {
    this.token = token;
    setTimeout(() => this.emit('ready'), 0);
    return Promise.resolve();
  }
  destroy() {
    this.destroyed = true;
  }
}

function makeMessage(overrides = {}) {
  return {
    id: 'm-1',
    content: '你好',
    system: false,
    author: { bot: false, id: 'u-1', username: 'alice' },
    guild: { id: 'g-1' },
    channelId: 'c-1',
    member: { displayName: 'Alice' },
    mentions: { users: { has: () => false } },
    reference: null,
    attachments: { size: 0 },
    ...overrides,
  };
}

async function readyAdapter(config = {}) {
  const adapter = new DiscordAdapter({
    config: { token: 'token', ...config },
    logger: { info() {}, warn() {}, debug() {} },
    loadDiscordModule: async () => ({ Client: FakeClient }),
  });
  await adapter.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  return adapter;
}

test('Discord adapter connects, normalizes group messages, and ignores bots', async () => {
  const adapter = await readyAdapter();
  try {
    assert.equal(adapter.status().connected, true);
    assert.equal(adapter.status().selfId, 'bot-1');
    const messages = [];
    adapter.on('message', (message) => messages.push(message));
    adapter.client.emit('messageCreate', makeMessage());
    adapter.client.emit('messageCreate', makeMessage({ author: { bot: true, id: 'b', username: 'b' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].channel, 'discord');
    assert.equal(messages[0].kind, 'group');
    assert.equal(messages[0].externalId, 'c-1');
    assert.equal(messages[0].senderName, 'Alice');
    assert.equal(messages[0].text, '你好');
    assert.equal(messages[0].replyToId, 'm-1');
  } finally {
    await adapter.stop();
  }
});

test('Discord requireMention gates group messages unless mentioned or replied', async () => {
  const adapter = await readyAdapter({ requireMention: true });
  try {
    const messages = [];
    adapter.on('message', (message) => messages.push(message));
    adapter.client.emit('messageCreate', makeMessage());
    adapter.client.emit('messageCreate', makeMessage({
      mentions: { users: { has: (id) => id === 'bot-1' } },
    }));
    adapter.client.emit('messageCreate', makeMessage({ reference: { messageId: 'bot-msg' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 2);
  } finally {
    await adapter.stop();
  }
});

test('Discord sends with reply metadata and never parses mentions', async () => {
  const adapter = await readyAdapter();
  try {
    await adapter.send({ kind: 'group', externalId: 'c-1', replyToId: 'm-1' }, ['第一条', '第二条']);
    assert.equal(adapter.client.sent.length, 2);
    assert.equal(adapter.client.sent[0].content, '第一条');
    assert.deepEqual(adapter.client.sent[0].allowedMentions, { parse: [] });
    assert.deepEqual(adapter.client.sent[0].reply, { messageReference: 'm-1', failIfNotExists: false });

    await adapter.send({ kind: 'private', externalId: 'u-1' }, ['私聊']);
    assert.equal(adapter.client.sent.length, 3);
    assert.equal(adapter.client.sent[2].content, '私聊');
  } finally {
    await adapter.stop();
  }
});

test('Discord without a token reports an actionable error', async () => {
  const adapter = new DiscordAdapter({ config: { token: '' }, logger: { warn() {}, info() {}, debug() {} } });
  await adapter.start();
  assert.match(adapter.status().lastError, /Token/u);
  await adapter.stop();
});
