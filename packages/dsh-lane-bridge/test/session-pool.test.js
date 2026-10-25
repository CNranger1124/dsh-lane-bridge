import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

async function setup({ existingSession = '', repo = null, promptImpl = null } = {}) {
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
  const resolveCalls = [];
  let nextId = 1;
  // Mirrors the current DSH contract: the durable follower lives on
  // sessionController.history and every prompt must carry an AbortSignal.
  const history = {
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
  };
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
      history,
      resolveAgent: async (sessionId) => {
        resolveCalls.push(sessionId);
        const agent = makeAgent(sessionId);
        agents.set(sessionId, agent);
        queues.set(sessionId, eventQueue());
        return agent;
      },
      prompt: async (request, signal) => {
        if (!signal || typeof signal.throwIfAborted !== 'function') {
          throw new TypeError("Cannot read properties of undefined (reading 'throwIfAborted')");
        }
        signal.throwIfAborted();
        prompts.push(request);
        if (promptImpl) return promptImpl(request);
        return { accepted: true };
      },
      selectModel: async () => ({}),
    },
    sessionQuery: {},
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
    repo,
    fetchImageImpl: async () => ({ base64: 'aGk=', mediaType: 'image/png', bytes: 2, url: 'https://x/a.png' }),
    logger: ctx.logger,
    onTurnEnd: async (payload) => {
      turns.push(payload);
      resolveTurn?.(payload);
    },
  });
  return { dir, store, ctx, agents, queues, prompts, resumeCalls, resolveCalls, sent, turns, pool, memoryStore, usageStore, turnPromise };
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
      'lane_conversation_info', 'lane_escalate', 'lane_kb_draft', 'lane_kb_list', 'lane_kb_read', 'lane_kb_search',
      'lane_memory_add', 'lane_memory_read', 'lane_repo_create_issue', 'lane_repo_get_issue',
      'lane_repo_list_issues', 'lane_repo_read_file', 'lane_repo_recent_commits', 'lane_repo_search_code',
      'lane_repo_status', 'lane_send',
    ]);
    assert.deepEqual(agent.restrictions, [{ allow: [] }]);

    const draft = await agent.tools.get('lane_kb_draft').execute({
      title: '测试草稿',
      content: '这是一条由会话工具写入的测试草稿。',
      source: 'test',
    }, {});
    assert.equal(draft.ok, true);
    assert.ok(fs.existsSync(path.join(env.dir, 'knowledge', 'default', '_待审', draft.file)));

    await assert.rejects(
      () => agent.tools.get('lane_repo_status').execute({}, {}),
      /当前领域未开启 GitHub/
    );
  } finally {
    cleanup(env.dir);
  }
});

test('repo tools use the current domain repository and branch', async () => {
  const calls = [];
  const fakeRepo = {
    forRepo(args) {
      calls.push(args);
      return {
        status: () => ({ repoConfigured: true }),
        listIssues: async () => ({ repo: 'studio/game', issues: [] }),
      };
    },
  };
  const env = await setup({ repo: fakeRepo });
  try {
    await env.store.setDomains([{ ...defaultDomain(), autoReply: true, repoEnabled: true, repo: 'studio/game', branch: 'dev' }]);
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '查 issue' });
    const agent = env.agents.get('session-1');
    const result = await agent.tools.get('lane_repo_list_issues').execute({}, {});
    assert.deepEqual(result.issues, []);
    assert.deepEqual(calls.at(-1), { repo: 'studio/game', branch: 'dev' });
  } finally {
    cleanup(env.dir);
  }
});

test('prompt retries once when the inbox projection is not active yet', async () => {
  let attempts = 0;
  const env = await setup({
    promptImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('prompt rejected'), {
          code: 'session/agent-busy',
          details: { reason: 'agent inbox projection is not active' },
        });
      }
      return { accepted: true };
    },
  });
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    assert.equal(attempts, 2);
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

test('DSH event envelopes are unwrapped before the turn collector sees them', async () => {
  const env = await setup();
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '你好' });
    const queue = env.queues.get('session-1');
    queue.push({ type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } });
    queue.push({ type: 'event', event: { type: 'assistant/message', seq: 2, data: { turn: 1, message: { content: [{ type: 'text', text: '在的' }] } } } });
    queue.push({ type: 'event', event: { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } } });
    const turn = await env.turnPromise;
    assert.equal(turn.ended.text, '在的');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('cold sessions are resolved through the session controller so model selection is installed', async () => {
  const env = await setup({ existingSession: 'cold-1' });
  try {
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '恢复' });
    assert.deepEqual(env.resolveCalls, ['cold-1']);
    assert.deepEqual(env.resumeCalls, [], 'raw agents.resume would skip installSelection');
    const agent = env.agents.get('cold-1');
    assert.ok(agent.tools.has('lane_send'));
    assert.equal(env.prompts[0].sessionId, 'cold-1');
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('cold sessions fall back to agents.resume when the controller has no resolveAgent', async () => {
  const env = await setup({ existingSession: 'cold-2' });
  try {
    delete env.ctx.sessionController.resolveAgent;
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderName: '小明', text: '恢复' });
    assert.deepEqual(env.resumeCalls, ['cold-2']);
    assert.equal(env.prompts[0].sessionId, 'cold-2');
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
    await env.store.setDomains([{ ...defaultDomain(), operators: ['snowluma:123'] }]);
    await env.store.setBindings({
      'snowluma:group:1': { domainId: 'default', enabled: true },
      'snowluma:group:2': { domainId: 'default', enabled: true },
    });
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderId: '123', senderName: '小明', text: '你好' });
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


test('a member outside the operator whitelist cannot use admin-only tools', async () => {
  const env = await setup();
  try {
    await env.store.setDomains([{
      ...defaultDomain(),
      memoryEnabled: true,
      repoEnabled: true,
      operators: ['snowluma:999'],
    }]);
    await env.store.setBindings({
      'snowluma:group:1': { domainId: 'default', enabled: true },
      'snowluma:group:2': { domainId: 'default', enabled: true },
    });
    await env.pool.prompt('snowluma:group:1', {
      channel: 'snowluma', kind: 'group', externalId: '1', senderId: '123', senderName: '路人', text: '帮我提个 issue',
    });
    const agent = env.agents.get('session-1');
    await assert.rejects(() => agent.tools.get('lane_repo_create_issue').execute({ title: 't', body: 'b' }), /仅限管理员/u);
    await assert.rejects(() => agent.tools.get('lane_memory_add').execute({ text: 'x' }), /仅限管理员/u);
    await assert.rejects(
      () => agent.tools.get('lane_send').execute({ target: 'snowluma:group:2', messages: 'x' }),
      /仅限管理员/u
    );
    // Talking in its own conversation is still allowed.
    const own = await agent.tools.get('lane_send').execute({ messages: '好的' });
    assert.equal(own.ok, true);
    assert.deepEqual(own.targets, ['snowluma:group:1']);
    const info = await agent.tools.get('lane_conversation_info').execute({});
    assert.equal(info.isOperator, false);
    assert.equal(info.senderId, '123');
    assert.doesNotMatch(env.prompts[0].content[0].text, /本领域管理员/u);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('a whitelisted sender is marked as administrator in the prompt', async () => {
  const env = await setup();
  try {
    await env.store.setDomains([{ ...defaultDomain(), operators: ['qqbot:8FD96C63'] }]);
    await env.store.setSession('snowluma:group:1', { sessionId: 'session-old', role: '客服', preset: 'lane-support', roleKey: '' });
    await env.pool.prompt('snowluma:group:1', {
      channel: 'snowluma', kind: 'group', externalId: '1', senderId: '123', senderName: '小明', text: '你好',
    });
    // Channel-scoped entry must not leak to another channel.
    assert.doesNotMatch(env.prompts[0].content[0].text, /本领域管理员/u);

    await env.pool.reset('snowluma:group:1');
    await env.store.setDomains([{ ...defaultDomain(), operators: ['snowluma:123'] }]);
    await env.pool.prompt('snowluma:group:1', {
      channel: 'snowluma', kind: 'group', externalId: '1', senderId: '123', senderName: '小明', text: '你好',
    });
    assert.match(env.prompts[1].content[0].text, /本次发言者：小明（本领域管理员，可执行管理操作）/u);
  } finally {
    await env.pool.stop();
    cleanup(env.dir);
  }
});

test('alternating speakers re-inject the role card so identity branches stay correct', async () => {
  const env = await setup();
  try {
    await env.store.setDomains([{ ...defaultDomain(), operators: ['snowluma:123'] }]);
    const say = (senderId, senderName) => env.pool.prompt('snowluma:group:1', {
      channel: 'snowluma', kind: 'group', externalId: '1', senderId, senderName, text: '你好',
    });
    await say('456', '路人');
    await say('123', '小明');
    await say('456', '路人');
    const cards = env.prompts.map((prompt) => prompt.content[0].text);
    // Every turn flips identity, so the (potentially branch-y) role card must be
    // re-injected each time instead of being cached from the first speaker.
    for (const text of cards) assert.match(text, /【角色卡：客服】/u);
    assert.match(cards[0], /发言者身份：普通成员/u);
    assert.match(cards[1], /发言者身份：管理员/u);
    assert.match(cards[2], /发言者身份：普通成员/u);
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
    await env.store.setDomains([{ ...defaultDomain(), autoReply: true, memoryEnabled: true, memoryMaxChars: 2000, operators: ['snowluma:123'] }]);
    env.memoryStore.append('default', '玩家 A 在 1.2.3 闪退，Windows 11');
    await env.pool.prompt('snowluma:group:1', { channel: 'snowluma', kind: 'group', externalId: '1', senderId: '123', senderName: '小明', text: '又闪退了' });
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
