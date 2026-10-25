import test from 'node:test';
import assert from 'node:assert/strict';
import { InboundQueue, mergeInboundMessages } from '../lib/inbound-queue.js';

test('mergeInboundMessages combines bursts and keeps mention metadata', () => {
  const merged = mergeInboundMessages([
    { text: '在吗', kind: 'group', externalId: '1', images: [] },
    { text: '问个问题', kind: 'group', externalId: '1', images: [{ url: 'x' }], mentionsBot: true },
    { text: '存档在哪', kind: 'group', externalId: '1', replyToId: 'm-3' },
  ]);
  assert.equal(merged.text, '在吗\n问个问题\n存档在哪');
  assert.equal(merged.images.length, 1);
  assert.equal(merged.mentionsBot, true);
  assert.equal(merged.replyToId, 'm-3');
  assert.equal(mergeInboundMessages([]), null);
});

test('InboundQueue debounces and flushes one merged message', async () => {
  const flushed = [];
  const queue = new InboundQueue({
    delayMs: 20,
    onFlush: async (key, message) => { flushed.push({ key, message }); },
  });
  queue.push('k', { text: 'a' });
  queue.push('k', { text: 'b' });
  assert.equal(queue.size, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].message.text, 'a\nb');
  assert.equal(queue.size, 0);
  queue.stop();
});

test('InboundQueue delay 0 flushes immediately and stop prevents timers', async () => {
  const flushed = [];
  const queue = new InboundQueue({
    delayMs: 0,
    onFlush: async (key, message) => { flushed.push(message.text); },
  });
  queue.push('k', { text: 'now' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(flushed, ['now']);

  const slow = new InboundQueue({
    delayMs: 1000,
    onFlush: async () => { throw new Error('should not flush'); },
  });
  slow.push('k', { text: 'later' });
  slow.stop();
  assert.equal(slow.size, 0);
});

test('InboundQueue reads a dynamic delay function', async () => {
  let delay = 0;
  const flushed = [];
  const queue = new InboundQueue({
    delayMs: () => delay,
    onFlush: async (key, message) => { flushed.push(message.text); },
  });
  queue.push('k', { text: 'instant' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(flushed, ['instant']);
  delay = 10;
  queue.push('k2', { text: 'delayed' });
  assert.equal(queue.size, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(flushed, ['instant', 'delayed']);
  queue.stop();
});
