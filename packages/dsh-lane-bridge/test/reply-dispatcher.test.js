import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyDispatcher, DEFAULT_APOLOGY } from '../lib/reply-dispatcher.js';

function setup({ sent = 0 } = {}) {
  const sentMessages = [];
  const store = {
    get: () => ({ config: { reply: { maxChars: 300, stripMarkdown: true } } }),
  };
  const channels = {
    sendKey: async (key, messages) => {
      sentMessages.push({ key, messages });
      return messages.map(() => ({}));
    },
  };
  let sentLeft = sent;
  const dispatcher = createReplyDispatcher({
    store,
    channels,
    consumeSent: () => {
      const value = sentLeft;
      sentLeft = 0;
      return value;
    },
    logger: { warn() {}, debug() {} },
  });
  return { dispatcher, sentMessages, store };
}

test('reply dispatcher strips markdown and chunks long text', async () => {
  const { dispatcher, sentMessages } = setup();
  await dispatcher({
    key: 'snowluma:group:1',
    resolved: { maxReplyChars: 300 },
    ended: { text: `**标题**\n\n${'a'.repeat(700)}`, reason: { kind: 'completed' } },
  });
  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].messages.length >= 2);
  assert.ok(!sentMessages[0].messages[0].includes('**'));
});

test('reply dispatcher does not double-send after lane_send', async () => {
  const { dispatcher, sentMessages } = setup({ sent: 1 });
  await dispatcher({
    key: 'snowluma:group:1',
    resolved: { maxReplyChars: 300 },
    ended: { text: '不应发送', reason: { kind: 'completed' } },
  });
  assert.equal(sentMessages.length, 0);
});

test('reply dispatcher sends one apology on a failed turn', async () => {
  const { dispatcher, sentMessages } = setup();
  await dispatcher({
    key: 'snowluma:group:1',
    resolved: { maxReplyChars: 300 },
    ended: { text: '', reason: { kind: 'error', error: { message: 'boom' } } },
  });
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].messages, [DEFAULT_APOLOGY]);
});

test('reply dispatcher stays quiet for an empty successful turn', async () => {
  const { dispatcher, sentMessages } = setup();
  await dispatcher({
    key: 'snowluma:group:1',
    resolved: { maxReplyChars: 300 },
    ended: { text: '   ', reason: { kind: 'completed' } },
  });
  assert.equal(sentMessages.length, 0);
});
