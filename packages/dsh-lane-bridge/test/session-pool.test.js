import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneStore } from '../lib/store.js';
import { SessionPool } from '../lib/session-pool.js';
import { MemoryStore } from '../lib/memory.js';
import { UsageStore } from '../lib/usage.js';
import { defaultDomain } from '../lib/defaults.js';
import { tempDir, cleanup } from './helpers.js';

function makeAgent(sessionId) {
  const tools = new Map();
  const restrictions = [];
  const agent = {
    session: { id: sessionId },
    ctx: {
      tools: {
        register(definition) {
          tools.set(definition.name, definition);
          return () => tools.delete(definition.name);
        },
        restrict(filter) {
          restrictions.push(filter);
          return () => {};
        },
      },
    },
    tools,
    restrictions,
  };
  return agent;
}

function eventQueue() {
  const items = [];
  let waiter = null;
  return {
    push(item) {
      items.push(item);
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve();
      }
    },
    async shift(signal) {
      while (items.length === 0) {
        await new Promise((resolve, reject) => {
          waiter = resolve;
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return items.shift();
    },
  };
}

async function setup({ existingSession = '' } = {}) {
  const dir = tempDir();
  const store = new LaneStore({ dataDir: dir });
  await store.load();
  await store.setDomains([{ ...defaultDomain(), autoReply: true }]);
  await store.setBindings({ 'snowluma:group:1': { domainId: 'default', enabled: true } });
  if (existingSession) {
    await store.setSession('snowluma:group:1', { sessionId: existingSession, role: '客服', preset: 'lane-support' });
  }

  const agents = new Map();
  const queues = new Map();
  const prompts = [];
  const resumeCalls = [];
  let nextId = 1;
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    workspaceController: { create: async () => ({ workspace: { workspaceId: 'ws-1' } }) },
    sessionController: {
      create: async () => {
        const sessionId = `session-${nextId++}`;
        agents.set(sessionId, makeAgent(sessionId));
        queues.set(sessionId, eventQueue());
        return { sessionId };
      },
      prompt: async (request) => {
        prompts.push(request);
        return { accepted: true };
      },
      selectModel: async () => ({}),
    },
    sessionQuery: {
      follow(request, signal) {
        const sessionId = request.address.sessionId;
        return (async function* follow() {
          yield { type: 'snapshot', records: [] };
          const queue = queues.get(sessionId) ?? eventQueue();
          queues.set(sessionId, queue);
          for (;;) {
            if (signal?.aborted) return;
            try {
              const item = await queue.shift(signal);
              if (item === null) return;
              yield item;
            } catch {
              return;
            }
          }
        })();
      },
    },
    agents: {
      get: (sessionId) => agents.get(sessionId) ?? null,
      resume: async ({ resumeSessionId, setup: setupFn }) => {
        resumeCalls.push(resumeSessionId);
        const agent = makeAgent(resumeSessionId);
        setupFn?.(agent.ctx, agent);
        agents.set(resumeSessionId, agent);
        queues.set(resumeSessionId, eventQueue());
        return { agent, dispose: async () => {} };
      },
    },
  };

  const memoryStore = new MemoryStore({ dir: `${dir}/memories` });
  const usageStore = new UsageStore({ file: `${dir}/usage.jsonl` });
  const sent = [];
  const channelManager = {
    sendKey: async (key, messages) => {
      sent.push({ key, messages });
      return messages.map(() => ({ ok: true }));
    },
  };
  const turns = [];
  let resolveTurn = null;
  const turnPromise = new Promise((resolve) => { resolveTurn = resolve; });
  const pool = new SessionPool({
    ctx,
    store,
    channelManager,
    workspaceDir: `${dir}/workspace`,
    knowledgeDir: store.paths.knowledgeDir,
    memoryStore,
    usageStore,
    fetchImageImpl: async () => ({ base64: 'aGk=', mediaType: 'image/png', bytes: 2, url: 'https://x/a.png' }),
    logger: ctx.logger,
    onTurnEnd: async (payload) => {
      turns.push(payload);
      resolveTurn?.(payload);
    },
  });
  return { dir, store, ctx, agents, queues, prompts, resumeCalls, sent, turns, pool, memoryStore, usageStore, turnPromise };
}

test('first prompt creates a session, registers lane tools, restricts host tools, and injects the role card', async () => {
  const env = await setup();
  try {
    const inbound = { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' };
    const sessionId = await env.pool.prompt('snowluma:group:1', inbound);
    assert.equal(sessionId, 'session-1');
    assert.equal(env.prompts.length, 1);
    assert.match(env.prompts[0].content[0].text, /【角色卡：客服】/);
    assert.match(env.prompts[0].content[0].text, /小明/);
    assert.equal(env.store.get().sessions['snowluma:group:1'].sessionId, 'session-1');
    const agent = env.agents.get('session-1');
    assert.deepEqual([...agent.tools.keys()].sort(), [
      'lane_conversation_info', 'lane_escalate', 'lane_kb_list', 'lane_kb_read', 'lane_kb_search',
      'lane_memory_add', 'lane_memory_read', 'lane_send',
    ]);
    assert.deepEqual(agent.restrictions, [{ allow: [] }]);
  } finally {
    cleanup(env.dir);
  }
});

test('later turns do not re-inject the role card unless the role changes', async () => {
  const env = await setup();
  try {
    const inbound = { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '第一句' };
    await env.pool.prompt('snowluma:group:1', inbound);
    await env.pool.prompt('snowluma:group:1', { ...inbound, text: '第二句' });
    assert.equal(env.prompts.length, 2);
    assert.match(env.prompts[0].content[0].text, /【角色卡：客服】/);
    assert.doesNotMatch(env.prompts[1].content[0].text, /【角色卡：客服】/);
    assert.match(env.prompts[1].content[0].text, /第二句/);
  } finally {
    cleanup(env.dir);
  }
});

test('turn events are collected and delivered to onTurnEnd', async () => {
  const env = await setup();
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    const queue = env.queues.get('session-1');
    queue.push({ type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } });
    queue.push({ type: 'event', event: { type: 'assistant/message', seq: 2, data: { turn: 1, message: { content: [{ type: 'text', text: '收到' }] } } } });
    queue.push({ type: 'event', event: { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } } });
    const turn = await env.turnPromise;
    assert.equal(turn.ended.text, '收到');
    assert.equal(turn.ended.reason.kind, 'completed');
    assert.equal(turn.key, 'snowluma:group:1');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('cold sessions are resumed through agents.resume and configured before the prompt', async () => {
  const env = await setup({ existingSession: 'cold-1' });
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '恢复' });
    assert.deepEqual(env.resumeCalls, ['cold-1']);
    const agent = env.agents.get('cold-1');
    assert.ok(agent.tools.has('lane_send'));
    assert.equal(env.prompts[0].sessionId, 'cold-1');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('lane_send marks the turn as sent and reaches the channel manager', async () => {
  const env = await setup();
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    const agent = env.agents.get('session-1');
    const send = agent.tools.get('lane_send');
    const result = await send.execute({ messages: ['第一条', '第二条'] });
    assert.equal(result.ok, true);
    assert.equal(result.sent, 2);
    assert.equal(env.sent.length, 1);
    assert.deepEqual(env.sent[0].messages, ['第一条', '第二条']);
    assert.equal(env.pool.consumeTurnSent('snowluma:group:1'), 1);
    assert.equal(env.pool.consumeTurnSent('snowluma:group:1'), 0);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('lane_send can broadcast only to bound conversations', async () => {
  const env = await setup();
  try {
    await env.store.setBindings({
      'snowluma:group:1': { domainId: 'default', enabled: true },
      'snowluma:group:2': { domainId: 'default', enabled: true },
    });
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    const agent = env.agents.get('session-1');
    const send = agent.tools.get('lane_send');
    const result = await send.execute({ targets: ['snowluma:group:1', 'snowluma:group:2'], messages: '通知' });
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
    assert.equal(env.sent.length, 2);
    assert.equal(env.pool.consumeTurnSent('snowluma:group:1'), 1);
    await assert.rejects(
      () => send.execute({ targets: ['snowluma:group:999'], messages: 'x' }),
      /未绑定/u
    );
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('reset forgets the session mapping so the next message starts fresh', async () => {
  const env = await setup();
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    assert.equal(env.store.get().sessions['snowluma:group:1'].sessionId, 'session-1');
    await env.pool.reset('snowluma:group:1');
    assert.equal(env.store.get().sessions['snowluma:group:1'], undefined);
    const next = await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '新会话' });
    assert.notEqual(next, 'session-1');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('domain memory is injected into the prompt', async () => {
  const env = await setup();
  try {
    await env.store.setDomains([{ ...defaultDomain(), autoReply: true, memoryEnabled: true, memoryMaxChars: 2000 }]);
    env.memoryStore.append('default', '玩家 A 在 1.2.3 闪退，Windows 11');
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '又闪退了' });
    const text = env.prompts[0].content[0].text;
    assert.match(text, /【领域共享记忆】/);
    assert.match(text, /Windows 11/);
    assert.match(text, /又闪退了/);
    const agent = env.agents.get('session-1');
    const add = agent.tools.get('lane_memory_add');
    const read = agent.tools.get('lane_memory_read');
    const added = await add.execute({ text: '客服建议先让玩家验证文件完整性' });
    assert.equal(added.ok, true);
    const memory = await read.execute({});
    assert.equal(memory.enabled, true);
    assert.match(memory.text, /文件完整性/);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('buildContent attaches fetched images and respects the media switch', async () => {
  const env = await setup();
  try {
    const content = await env.pool.buildContent('看图', { images: [{ url: 'https://x/a.png' }] });
    assert.equal(content.length, 2);
    assert.equal(content[1].type, 'image');
    assert.equal(content[1].mediaType, 'image/png');
    assert.equal(content[1].data, 'aGk=');
    await env.store.setConfig({ media: { enabled: false } });
    const textOnly = await env.pool.buildContent('看图', { images: [{ url: 'https://x/a.png' }] });
    assert.equal(textOnly.length, 1);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('escalate pauses the binding, notifies the operator, and resume restores it', async () => {
  const env = await setup();
  try {
    await env.store.setBindings({
      'snowluma:group:1': { domainId: 'default', enabled: true },
      'snowluma:group:2': { domainId: 'default', enabled: true },
    });
    await env.store.setConfig({ handoff: { enabled: true, targetKey: 'snowluma:group:2', ackMessage: '已转人工' } });
    const result = await env.pool.escalate('snowluma:group:1', { reason: '用户要求人工', summary: '星标没反应' });
    assert.equal(result.paused, true);
    assert.equal(result.notified, true);
    assert.equal(env.store.get().bindings['snowluma:group:1'].paused, true);
    assert.equal(env.sent.length, 2);
    assert.equal(env.sent[0].key, 'snowluma:group:2');
    assert.match(env.sent[0].messages[0], /转人工/);
    assert.equal(env.sent[1].key, 'snowluma:group:1');
    assert.deepEqual(env.sent[1].messages, ['已转人工']);
    await env.pool.resume('snowluma:group:1');
    assert.equal(env.store.get().bindings['snowluma:group:1'].paused, false);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});


test('assistant usage events are recorded in the usage ledger', async () => {
  const env = await setup();
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    const queue = env.queues.get('session-1');
    queue.push({ type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } });
    queue.push({ type: 'event', event: {
      type: 'assistant/message',
      seq: 2,
      data: {
        turn: 1,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
        message: { source: { model: 'deepseek-flash', provider: 'deepseek' }, content: [{ type: 'text', text: '收到' }] },
      },
    } });
    queue.push({ type: 'event', event: { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } } });
    await env.turnPromise;
    const summary = env.usageStore.summary();
    assert.equal(summary.total.turns, 1);
    assert.equal(summary.total.inputTokens, 100);
    assert.equal(summary.byKey[0].key, 'snowluma:group:1');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});
