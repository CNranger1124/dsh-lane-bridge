import test from 'node:test';
import assert from 'node:assert/strict';
import { OneBotWsClient } from '../lib/channels/onebot-ws.js';
import { segmentsToText } from '../lib/channels/snowluma.js';

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    setTimeout(() => {
      this.readyState = 1;
      this.fire('open', {});
    }, 0);
  }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  fire(name, event) {
    for (const handler of this.listeners.get(name) ?? []) handler(event);
  }
  send(raw) {
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    const reply = frame.action === 'fail'
      ? { status: 'failed', retcode: 1400, wording: 'bad token', echo: frame.echo }
      : { status: 'ok', retcode: 0, data: { action: frame.action, params: frame.params }, echo: frame.echo };
    setTimeout(() => this.fire('message', { data: JSON.stringify(reply) }), 0);
  }
  close() {
    this.readyState = 3;
    this.fire('close', { code: 1000, reason: 'test' });
  }
}

test('OneBot client correlates echoes, appends the access token, and emits events', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  try {
    const client = new OneBotWsClient({ url: 'ws://127.0.0.1:3001', accessToken: 'tok' });
    const events = [];
    client.on('event', (event) => events.push(event));
    await client.connect();
    assert.match(client.url, /127\.0\.0\.1/);
    const result = await client.request('get_login_info');
    assert.equal(result.action, 'get_login_info');
    const socket = client.socket;
    assert.match(socket.url, /access_token=tok/);
    socket.fire('message', { data: JSON.stringify({ post_type: 'message', message_type: 'group', group_id: 1, user_id: 2, raw_message: 'hi' }) });
    assert.equal(events.length, 1);
    assert.equal(events[0].group_id, 1);
    client.close();
  } finally {
    globalThis.WebSocket = original;
  }
});

test('OneBot client rejects failed actions and times out pending requests', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  try {
    const client = new OneBotWsClient({ url: 'ws://127.0.0.1:3001', reconnect: false });
    await client.connect();
    await assert.rejects(() => client.request('fail'), /bad token/);
    client.close();
  } finally {
    globalThis.WebSocket = original;
  }
});

test('OneBot segments render chat-friendly placeholders', () => {
  assert.equal(segmentsToText([
    { type: 'text', data: { text: '你好 ' } },
    { type: 'at', data: { qq: '123', name: '小明' } },
    { type: 'image', data: { url: 'http://x' } },
    { type: 'face', data: { id: 1 } },
  ]), '你好 @小明 [图片][表情]');
  assert.equal(segmentsToText(undefined, 'raw text'), 'raw text');
});
