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

test('QQ Bot keeps msg_id for replies and refuses msg_id-less sends', async () => {
  const adapter = await readyAdapter();
  try {
    // A reply always carries msg_id, however old it is: the platform decides
    // whether it is still valid (5 minutes), we must not strip it ourselves.
    await adapter.send({ kind: 'private', externalId: 'u-1', replyToId: 'm-1', replyToAt: Date.now() }, ['第一条', '第二条']);
    assert.equal(adapter.bot.sent.length, 2);
    assert.deepEqual(adapter.bot.sent[0].target, { scope: 'c2c', targetId: 'u-1', msgId: 'm-1' });
    await adapter.send({ kind: 'group', externalId: 'g-1', replyToId: 'm-old', replyToAt: Date.now() - 60 * 60 * 1000 }, ['旧消息也带 msg_id']);
    assert.deepEqual(adapter.bot.sent[2].target, { scope: 'group', targetId: 'g-1', msgId: 'm-old' });

    // No msg_id at all = an active message; default is to refuse locally.
    await assert.rejects(() => adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']), /主动消息没有权限/u);
    assert.equal(adapter.bot.sent.length, 3, 'must not hit the API');
  } finally {
    await adapter.stop();
  }
});

test('a passive reply is capped at five bubbles per received message', async () => {
  const adapter = await readyAdapter();
  try {
    await adapter.send({ kind: 'group', externalId: 'g-1', replyToId: 'm-1' }, ['1', '2', '3', '4', '5', '6', '7']);
    assert.equal(adapter.bot.sent.length, 5);
    assert.equal(adapter.bot.sent.every((item) => item.target.msgId === 'm-1'), true);
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

    // 40034105 is a permission error, not the 60 qpm rate limit.
    adapter.bot.sendText = async () => {
      throw new Error('API Error [/v2/groups/g-1/messages]: 40034105 主动消息发送失败，无权限');
    };
    await assert.rejects(
      () => adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']),
      /未上线|主动消息无权限/u
    );

    // Rate-limit errors get their own explanation.
    adapter.bot.sendText = async () => {
      throw new Error('40034100 主动消息发送超过频控限制');
    };
    await assert.rejects(
      () => adapter.send({ kind: 'group', externalId: 'g-1' }, ['群']),
      /60 qpm|频控/u
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

test('full-mode group messages are not treated as mentions of the bot', async () => {
  const adapter = await readyAdapter();
  try {
    const messages = [];
    adapter.on('message', (message) => messages.push(message));
    // Someone @-ed another member: mentions is non-empty but not us.
    adapter.bot.emit('message', {}, {
      kind: 'group',
      rawEventType: 'GROUP_MESSAGE_CREATE',
      senderId: 'u-5',
      senderName: 'Eve',
      content: '<@someone-else> 看这个',
      messageId: 'm-5',
      groupOpenid: 'g-1',
      mentions: [{ id: 'someone-else', username: 'Bob' }],
    });
    // Structurally marked as us.
    adapter.bot.emit('message', {}, {
      kind: 'group',
      rawEventType: 'GROUP_MESSAGE_CREATE',
      senderId: 'u-6',
      senderName: 'Frank',
      content: '存档在哪',
      messageId: 'm-6',
      groupOpenid: 'g-1',
      mentions: [{ id: 'bot-openid', is_you: true }],
    });
    // Only the text marker reveals it.
    adapter.bot.emit('message', {}, {
      kind: 'group',
      rawEventType: 'GROUP_MESSAGE_CREATE',
      senderId: 'u-7',
      senderName: 'Grace',
      content: '<@bot-openid> 闪退了',
      messageId: 'm-7',
      groupOpenid: 'g-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(messages.length, 3);
    assert.equal(messages[0].mentionsBot, false, '@-ing someone else is not @-ing us');
    assert.equal(messages[1].mentionsBot, true);
    assert.equal(messages[2].mentionsBot, true);
    // @ markers are stripped so keyword matching sees the plain sentence.
    assert.equal(messages[2].text, '闪退了');
    assert.equal(messages[0].text, '看这个');
  } finally {
    await adapter.stop();
  }
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
