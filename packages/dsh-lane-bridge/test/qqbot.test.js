import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { QqbotAdapter } from '../lib/channels/qqbot.js';

class FakeBot extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.sent = [];
    this.stopped = false;
  }
  start() {
    return new Promise(() => {});
  }
  stop() {
    this.stopped = true;
  }
  async sendText(target, content) {
    this.sent.push({ target, content });
    return { id: `sent-${this.sent.length}` };
  }
}

async function readyAdapter() {
  const adapter = new QqbotAdapter({
    config: { appId: 'app', appSecret: 'secret' },
    logger: { info() {}, warn() {}, debug() {} },
    loadQqbotModule: async () => ({ QQBot: FakeBot }),
  });
  await adapter.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  adapter.bot.emit('ready', { user: { id: 'bot-openid', username: 'bot' } });
  return adapter;
}

test('QQ Bot adapter connects and normalizes c2c/group messages', async () => {
  const adapter = await readyAdapter();
  try {
    assert.equal(adapter.status().connected, true);
    assert.equal(adapter.status().selfId, 'bot-openid');
    const messages = [];
    adapter.on('message', (message) => messages.push(message));
    adapter.bot.emit('message', {}, {
      kind: 'c2c',
      senderId: 'u-1',
      senderName: 'Alice',
      content: '你好',
      messageId: 'm-1',
      replyTarget: { scope: 'c2c', targetId: 'u-1', msgId: 'm-1' },
    });
    adapter.bot.emit('message', {}, {
      kind: 'group',
      senderId: 'u-2',
      senderName: 'Bob',
      content: '群消息',
      messageId: 'm-2',
      replyTarget: { scope: 'group', targetId: 'g-1', msgId: 'm-2' },
    });
    adapter.bot.emit('message', {}, {
      kind: 'group',
      senderId: 'bot',
      senderIsBot: true,
      content: 'ignore',
      replyTarget: { scope: 'group', targetId: 'g-1' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].kind, 'private');
    assert.equal(messages[0].externalId, 'u-1');
    assert.equal(messages[1].kind, 'group');
    assert.equal(messages[1].externalId, 'g-1');
    assert.equal(messages[1].text, '群消息');
  } finally {
    await adapter.stop();
  }
});

test('QQ Bot adapter replies passively inside the window and refuses active sends', async () => {
  const adapter = await readyAdapter();
  try {
    await adapter.send({ kind: 'private', externalId: 'u-1', replyToId: 'm-1', replyToAt: Date.now() }, ['第一条', '第二条']);
    assert.equal(adapter.bot.sent.length, 2);
    assert.deepEqual(adapter.bot.sent[0].target, { scope: 'c2c', targetId: 'u-1', msgId: 'm-1' });

    // Outside the passive window there is no msgId to reply to: QQ would treat
    // this as an active message, which needs a platform permission we do not have.
    await assert.rejects(
      () => adapter.send({ kind: 'group', externalId: 'g-1', replyToId: 'm-old', replyToAt: Date.now() - 10 * 60 * 1000 }, ['群']),
      /主动消息没有权限/u
    );
    assert.equal(adapter.bot.sent.length, 2, 'must not hit the API');
    // A conversation that never received a message is active too.
    await assert.rejects(() => adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']), /主动消息没有权限/u);
  } finally {
    await adapter.stop();
  }
});

test('allowing active messages sends without msgId and decorates permission errors', async () => {
  const adapter = new QqbotAdapter({
    config: { appId: 'app', appSecret: 'secret', allowActive: true },
    logger: { info() {}, warn() {}, debug() {} },
    loadQqbotModule: async () => ({ QQBot: FakeBot }),
  });
  await adapter.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  adapter.bot.emit('ready', { user: { id: 'bot-openid' } });
  try {
    await adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']);
    assert.deepEqual(adapter.bot.sent[0].target, { scope: 'group', targetId: 'g-1' });

    // The platform rejecting an active message gets an actionable hint.
    adapter.bot.sendText = async () => {
      throw new Error('API Error [/v2/groups/g-1/messages]: 主动消息失败, 无权限');
    };
    await assert.rejects(
      () => adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']),
      /主动消息权限\/额度/u
    );
  } finally {
    await adapter.stop();
  }
});

test('QQ Bot adapter reports missing credentials without starting', async () => {
  const adapter = new QqbotAdapter({
    config: { appId: '', appSecret: '' },
    logger: { info() {}, warn() {}, debug() {} },
    loadQqbotModule: async () => ({ QQBot: FakeBot }),
  });
  await adapter.start();
  assert.match(adapter.status().lastError, /appId/u);
  await adapter.stop();
});

test('QQ Bot group @ events count as mentions even without a mentions array', async () => {
  const adapter = await readyAdapter();
  try {
    const messages = [];
    adapter.on('message', (message) => messages.push(message));
    adapter.bot.emit('message', {}, {
      kind: 'group',
      rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      senderId: 'u-3',
      senderName: 'Carol',
      content: 'Bug 反馈',
      messageId: 'm-3',
      groupOpenid: 'g-9',
    });
    adapter.bot.emit('message', {}, {
      kind: 'group',
      rawEventType: 'GROUP_MESSAGE_CREATE',
      senderId: 'u-4',
      senderName: 'Dave',
      content: '闲聊',
      messageId: 'm-4',
      groupOpenid: 'g-9',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].mentionsBot, true);
    assert.equal(messages[0].externalId, 'g-9');
    // A full-message event that does not mention the bot stays a non-mention.
    assert.equal(messages[1].mentionsBot, false);
  } finally {
    await adapter.stop();
  }
});
