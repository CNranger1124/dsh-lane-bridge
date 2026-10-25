// Session orchestration: one DSH session per external conversation.
//
// New conversations are created through `sessionController` so the configured
// agent preset is honored. Existing (cold) sessions are resumed through
// `agents.resume({ setup })`, which lets us attach the conversation's tools and
// restrictions BEFORE the first model turn.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTurnCollector, isTurnError } from './turn.js';
import { createLaneTools } from './tools.js';
import {
  buildContextPrefix,
  conversationLabel,
  formatInboundText,
  isOperator,
  resolveConversation,
  roleContent,
} from './router.js';
import { publicError, splitText, stripMarkdown } from './text.js';
import { parseConversationKey } from './defaults.js';
import { matchDocuments, searchKnowledge } from './knowledge.js';
import { fetchImage } from './media.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// How many turns the retire prompt gets before the bridge gives up and resets
// anyway. A model that ignores the instruction must not pin the conversation.
const RETIRE_TIMEOUT_MS = 90_000;
const RETIRE_TEXT = [
  '【系统】本次会话即将归档：已经达到本领域的最大对话轮数，接下来会新建一个会话继续接待。',
  '请立刻调用 lane_retire 沉淀本次对话，然后不要再说别的：',
  '1) memory：后续还需要知道的事实（玩家反复报的问题、已确认的环境、有效的临时方案），每条 ≤200 字；',
  '2) kb：本次对话里确认过、且现有知识库没有覆盖的产品口径，写成草稿（会进人工审核）；',
  '3) 没有可沉淀的就是空数组。',
  '不要总结给用户看，不要道别，不要复述这段指令。',
].join('\n');

function promptErrorText(error) {
  return [
    error?.code ?? '',
    error?.message ?? '',
    error?.details?.reason ?? '',
  ].filter(Boolean).join(' ');
}

function isTransientProjectionError(error) {
  const text = promptErrorText(error);
  return /inbox|projection|not active|not registered|not ready/iu.test(text)
    || String(error?.code ?? '') === 'session/agent-busy';
}

// DSH wraps durable events as `{ type: 'event', event }` (both in the opening
// snapshot and on the live stream). Unwrap that envelope before inspecting the
// event, and keep accepting a bare event for older hosts.
function normalizeFollowRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw.type === 'event' && raw.event && typeof raw.event === 'object' ? raw.event : raw;
  if (typeof outer.type !== 'string') return null;
  return { event: outer, seq: typeof outer.seq === 'number' ? outer.seq : null };
}

function snapshotRecords(raw) {
  if (!Array.isArray(raw.records)) return [];
  const out = [];
  for (const record of raw.records) {
    const normalized = normalizeFollowRecord(record);
    if (normalized) out.push(normalized);
  }
  return out;
}

export class SessionPool {
  /**
   * @param {object} options
   * @param {import('@deepseek-ai/cordis').Context} options.ctx
   * @param {import('./store.js').LaneStore} options.store
   * @param {import('./channels/manager.js').ChannelManager} options.channelManager
   * @param {string} options.workspaceDir
   * @param {string} options.knowledgeDir
   * @param {object} [options.logger]
   * @param {(event: object) => Promise<void>} options.onTurnEnd
   */
  constructor({ ctx, store, channelManager, workspaceDir, knowledgeDir, memoryStore = null, usageStore = null, repo = null, logger = null, onTurnEnd, fetchImageImpl = fetchImage, retireTimeoutMs = RETIRE_TIMEOUT_MS }) {
    this.ctx = ctx;
    this.store = store;
    this.channelManager = channelManager;
    this.workspaceDir = workspaceDir;
    this.knowledgeDir = knowledgeDir;
    this.memoryStore = memoryStore;
    this.usageStore = usageStore;
    this.repo = repo;
    this.fetchImageImpl = fetchImageImpl;
    this.logger = logger;
    this.onTurnEnd = onTurnEnd;
    this.workspaceId = '';
    this.follows = new Map(); // sessionId -> { ac, key, started }
    this.collectors = new Map(); // sessionId -> collector
    this.configured = new Map(); // key -> { sessionId, signature, disposers }
    this.handles = new Map(); // key -> AgentHandle (resume-created only)
    this.turnSent = new Map(); // key -> count
    this.turnSender = new Map(); // key -> { senderId, senderName, isOperator, at }
    this.keyBySession = new Map(); // sessionId -> key
    this.retiring = new Set(); // keys currently being sedimented + reset
    this.retireWaiter = null; // { key, resolve } waiting for the retire turn to end
    this.retireTimeoutMs = Math.max(50, Number(retireTimeoutMs) || RETIRE_TIMEOUT_MS);
    this.retireResult = null; // { key, memory, kb } reported by lane_retire
  }

  async ensureWorkspace() {
    if (this.workspaceId) return this.workspaceId;
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    try {
      const result = await this.ctx.workspaceController.create({ path: this.workspaceDir });
      this.workspaceId = String(result?.workspace?.workspaceId ?? result?.workspace?.id ?? '');
      if (this.workspaceId) return this.workspaceId;
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] 工作区创建失败（改用 cwd）：${error?.message ?? error}`);
    }
    return '';
  }

  markTurnSent(key) {
    this.turnSent.set(key, (this.turnSent.get(key) ?? 0) + 1);
  }

  /**
   * Who is speaking right now in this conversation. Set by prompt() before the
   * turn is submitted, read by the lane_* tools to decide whether the caller is
   * an operator. One session serves the whole group, so this must be per-turn,
   * not stored on the session.
   */
  currentSender(key) {
    return this.turnSender.get(key) ?? null;
  }

  consumeTurnSent(key) {
    const count = this.turnSent.get(key) ?? 0;
    this.turnSent.delete(key);
    return count;
  }

  async configureAgent(agentCtx, agent, key, resolved) {
    const signature = JSON.stringify({
      role: resolved.role,
      preset: resolved.preset,
      model: resolved.model,
      scopes: resolved.knowledgeScopes,
      tools: resolved.allowedHostTools,
    });
    const previous = this.configured.get(key);
    if (previous && previous.sessionId === agent?.session?.id && previous.signature === signature) return;
    if (previous) {
      for (const dispose of previous.disposers.reverse()) {
        try { dispose(); } catch {}
      }
      this.configured.delete(key);
    }
    const disposers = [];
    try {
      const tools = createLaneTools({ key, pool: this, store: this.store, knowledgeDir: this.knowledgeDir, memoryStore: this.memoryStore, repo: this.repo, logger: this.logger });
      for (const tool of tools) {
        disposers.push(agentCtx.tools.register(tool));
      }
      const allow = Array.isArray(resolved.allowedHostTools) ? resolved.allowedHostTools : [];
      try {
        disposers.push(agentCtx.tools.restrict({ allow }));
      } catch (error) {
        // A typo or a DSH upgrade that renamed a tool must not silently widen
        // the surface: fall back to no inherited tools and leave a loud log.
        this.logger?.warn?.(`[lane-bridge] ${key} 允许的宿主工具不可用（${allow.join(', ') || '空'}）：${error?.message ?? error}；已收紧为无宿主工具`);
        disposers.push(agentCtx.tools.restrict({ allow: [] }));
      }
      this.configured.set(key, { sessionId: agent?.session?.id ?? '', signature, disposers });
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try { dispose(); } catch {}
      }
      this.logger?.warn?.(`[lane-bridge] ${key} 工具注册失败：${error?.message ?? error}`);
    }
  }

  async ensureSession(key, resolved) {
    const state = this.store.get();
    const record = state.sessions?.[key];
    if (record?.sessionId) {
      const sessionId = record.sessionId;
      let agent = this.ctx.agents.get(sessionId);
      if (!agent) {
        // Resume through the Session Controller when possible. Its setup also
        // installs the session-local model selection; resuming straight through
        // `agents.resume` leaves it unset, and the next prompt assembly then
        // fails on the persona's {{model}} variable. The controller also
        // re-mounts the preset stored in the session header.
        if (typeof this.ctx.sessionController?.resolveAgent === 'function') {
          try {
            agent = await this.ctx.sessionController.resolveAgent(sessionId);
            this.logger?.debug?.(`[lane-bridge] 已恢复会话 ${key} -> ${sessionId.slice(0, 8)}`);
          } catch (error) {
            this.logger?.warn?.(`[lane-bridge] 会话恢复失败，将为 ${key} 新建会话：${error?.message ?? error}`);
          }
        }
        if (!agent) {
          try {
            const handle = await this.ctx.agents.resume({
              resumeSessionId: sessionId,
              setup: (agentCtx, resumed) => this.configureAgent(agentCtx, resumed, key, resolved),
            });
            agent = handle.agent;
            this.handles.set(key, handle);
            this.logger?.debug?.(`[lane-bridge] 已恢复会话 ${key} -> ${sessionId.slice(0, 8)}`);
          } catch (error) {
            this.logger?.warn?.(`[lane-bridge] 会话恢复失败，将为 ${key} 新建会话：${error?.message ?? error}`);
          }
        }
      }
      if (agent) {
        await this.configureAgent(agent.ctx, agent, key, resolved);
        this.keyBySession.set(sessionId, key);
        void this.startFollow(sessionId, key);
        return sessionId;
      }
    }

    // Create a fresh session. `sessionController` resolves the preset and
    // attaches the session to the bridge workspace.
    const workspaceId = await this.ensureWorkspace();
    let created;
    try {
      created = await this.ctx.sessionController.create({
        ...(workspaceId ? { workspaceId } : { cwd: this.workspaceDir }),
        agentPreset: resolved.preset || undefined,
      });
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] 创建会话失败（preset=${resolved.preset}）：${error?.message ?? error}`);
      created = await this.ctx.sessionController.create({
        ...(workspaceId ? { workspaceId } : { cwd: this.workspaceDir }),
      });
    }
    const sessionId = String(created.sessionId);
    const agent = this.ctx.agents.get(sessionId);
    if (agent) await this.configureAgent(agent.ctx, agent, key, resolved);
    await this.store.setSession(key, {
      sessionId,
      role: resolved.role,
      roleKey: '',
      preset: resolved.preset,
      model: resolved.model,
    });
    this.keyBySession.set(sessionId, key);
    void this.startFollow(sessionId, key);
    return sessionId;
  }

  async applyModel(sessionId, resolved) {
    const model = String(resolved.model ?? '').trim();
    if (!model) return;
    const slash = model.indexOf('/');
    if (slash <= 0 || slash >= model.length - 1) {
      this.logger?.warn?.(`[lane-bridge] 领域模型 "${model}" 需要写成 provider/model，已跳过 selectModel`);
      return;
    }
    try {
      await this.ctx.sessionController.selectModel({
        sessionId,
        provider: model.slice(0, slash),
        model: model.slice(slash + 1),
      });
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] 切换模型失败：${error?.message ?? error}`);
    }
  }

  /**
   * A freshly created Agent can be published a tick before its inbox
   * projection is active. Prompting in that window is rejected as
   * `session/agent-busy`, and the message is never recorded. Wait briefly for
   * the projection to answer before submitting.
   */
  async waitForAgentReady(sessionId, key = '') {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const agent = this.ctx.agents.get(sessionId);
      if (agent) {
        try {
          if (typeof agent.inbox?.current === 'function') agent.inbox.current();
          return true;
        } catch {}
      }
      await sleep(50);
    }
    this.logger?.warn?.(`[lane-bridge] ${key} 会话 ${sessionId.slice(0, 8)} 投影仍未就绪，继续尝试提交`);
    return false;
  }

  /**
   * Optional keyword-triggered knowledge retrieval.
   *
   * The unit of retrieval is a **document**, not a global keyword list: each
   * Markdown file carries its own `triggers` in frontmatter (see
   * `knowledge.js`), so "存档.md" answers "存档在哪" without "联机.md" being
   * dragged in as well. Documents that predate per-file triggers still work via
   * the domain-level fallback words plus full-text search. `lane_kb_*` stays
   * available for follow-up reading either way.
   */
  retrieveKnowledge(resolved, text) {
    if (resolved.kbAutoRetrieve !== true) return '';
    const limit = Math.max(200, Math.min(8000, Number(resolved.kbRetrieveChars) || 1500));
    const blocks = [];
    let used = 0;
    const push = (head, body) => {
      const room = limit - used;
      if (room < 120) return false;
      const clean = String(body ?? '').trim();
      const budget = Math.max(80, room - head.length - 2);
      const cut = clean.length > budget ? `${clean.slice(0, budget).trimEnd()}\n…（已截断）` : clean;
      const block = `${head}\n${cut}`;
      blocks.push(block);
      used += block.length + 2;
      return true;
    };

    let docs = [];
    try {
      docs = matchDocuments(this.knowledgeDir, resolved.knowledgeScopes, text, 4, resolved.domain?.id ?? '');
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] 知识库检索失败：${error?.message ?? error}`);
    }
    for (const doc of docs) {
      const head = `【${doc.title || doc.path}】（${doc.scope}/${doc.path}）`;
      if (!push(head, doc.body)) break;
    }
    if (blocks.length > 0) return blocks.join('\n\n');

    // Legacy path: documents that predate per-document triggers. Runs only when
    // the domain still declares fallback words, and only matches document text.
    const fallback = Array.isArray(resolved.kbTriggerKeywords) ? resolved.kbTriggerKeywords : [];
    const lower = String(text ?? '').toLowerCase();
    const matchedWords = fallback.filter((word) => word && lower.includes(String(word).toLowerCase())).slice(0, 3);
    if (matchedWords.length === 0) return '';
    const seen = new Set();
    for (const word of matchedWords) {
      let result;
      try {
        result = searchKnowledge(this.knowledgeDir, resolved.knowledgeScopes, word, 3, resolved.domain?.id ?? '');
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] 知识库检索失败：${error?.message ?? error}`);
        continue;
      }
      for (const hit of result?.hits ?? []) {
        const id = `${hit.scope}/${hit.path}#${hit.heading}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!push(`【${hit.heading || hit.path}】（${hit.scope}/${hit.path}）`, hit.snippet)) return blocks.join('\n\n');
      }
    }
    return blocks.join('\n\n');
  }

  /** Build the prompt text, injecting the role card on first turn / role change. */
  async buildPrompt(key, inbound, resolved) {
    const state = this.store.get();
    const record = state.sessions?.[key];
    const roleText = roleContent(state, resolved.role);
    const senderIsOperator = isOperator(state, key, inbound.senderId);
    // Include a short content hash: editing a role card must re-inject it even
    // when the name did not change. The identity suffix matters because a role
    // card may branch on `{{#if operator}}`: the same card renders differently
    // for an administrator, so changing speaker must re-inject it.
    const roleKey = `${resolved.role}:${crypto.createHash('sha1').update(roleText).digest('hex').slice(0, 10)}`
      + `:${senderIsOperator ? 'admin' : 'member'}`;
    const needRole = record?.roleKey !== roleKey;
    const memoryText = resolved.memoryEnabled && this.memoryStore
      ? this.memoryStore.render(resolved.domain?.id, resolved.memoryMaxChars)
      : '';
    const kbText = this.retrieveKnowledge(resolved, inbound.text);
    const prefix = buildContextPrefix({
      resolved,
      roleText: needRole ? roleText.slice(0, 8000) : '',
      memoryText,
      kbText,
      channel: inbound.channel,
      kind: inbound.kind,
      externalId: inbound.externalId,
      senderName: inbound.senderName,
      senderId: inbound.senderId,
      senderIsOperator,
    });
    return { text: `${prefix}${formatInboundText(inbound)}`, injectedRole: needRole ? resolved.role : '', roleKey };
  }

  async buildContent(text, inbound) {
    const parts = [{ type: 'text', text }];
    const media = this.store.get().config.media ?? {};
    const images = Array.isArray(inbound?.images) ? inbound.images : [];
    if (media.enabled === false || images.length === 0 || (Number(media.maxCount) || 0) === 0) return parts;
    const maxCount = Math.max(0, Math.min(8, Number(media.maxCount) || 0));
    const candidates = images.slice(0, maxCount)
      .map((image) => String(image?.url ?? '').trim())
      .filter(Boolean);
    // Fetch in parallel: four slow CDN requests must not add four timeouts to
    // the user's wait before the model even starts.
    const fetched = await Promise.allSettled(candidates.map((url) => this.fetchImageImpl(url, {
      maxBytes: Number(media.maxBytes) || 8 * 1024 * 1024,
      timeoutMs: Number(media.timeoutMs) || 15000,
    })));
    for (const result of fetched) {
      if (result.status === 'fulfilled') {
        parts.push({ type: 'image', mediaType: result.value.mediaType, data: result.value.base64 });
      } else {
        this.logger?.warn?.(`[lane-bridge] 图片下载失败：${result.reason?.message ?? result.reason}`);
      }
    }
    return parts;
  }

  isRetiring(key) {
    return this.retiring.has(key);
  }

  /** Called by the `lane_retire` tool to report what it managed to write. */
  recordRetireResult(key, result) {
    this.retireResult = { ...(result ?? {}) };
    return this.retireResult;
  }

  /** Count an answered turn; wake the retire flow if it was the last one. */
  async afterTurn(key, sessionId) {
    const record = this.store.get().sessions?.[key];
    if (!record) return 0;
    if (sessionId && record.sessionId !== sessionId) return Number(record.turns) || 0;
    const turns = (Number(record.turns) || 0) + 1;
    await this.store.setSession(key, { ...record, turns });
    if (this.retireWaiter?.key === key) {
      const waiter = this.retireWaiter;
      this.retireWaiter = null;
      waiter.resolve();
    }
    return turns;
  }

  /** Start the retire flow when the conversation has reached its turn budget. */
  maybeRetire(key) {
    if (this.retiring.has(key)) return;
    if (this.store.get().config?.enabled === false) return;
    const resolved = resolveConversation(this.store.get(), key);
    const max = Number(resolved.sessionMaxTurns) || 0;
    if (max <= 0) return;
    const turns = Number(this.store.get().sessions?.[key]?.turns) || 0;
    if (turns < max) return;
    this.logger?.info?.(`[lane-bridge] ${key} 已达 ${turns}/${max} 轮，开始归档并重置会话`);
    void this.retire(key).catch((error) => {
      this.logger?.warn?.(`[lane-bridge] ${key} 归档失败：${error?.message ?? error}`);
    });
  }

  /**
   * Sediment then reset.
   *
   * The model is asked to call `lane_retire` (memory entries + KB drafts) in one
   * extra turn; whatever it managed to write is kept, then the DSH session is
   * dropped so the next message starts from a clean context plus the freshly
   * written memory / knowledge. A model that ignores the instruction cannot pin
   * the conversation: the wait is bounded and the reset happens regardless.
   */
  async retire(key) {
    if (this.retiring.has(key)) return;
    const parsed = parseConversationKey(key);
    if (!parsed) return;
    this.retiring.add(key);
    try {
      this.retireResult = null;
      const done = new Promise((resolve) => { this.retireWaiter = { key, resolve }; });
      const inbound = {
        channel: parsed.channel,
        kind: parsed.kind,
        externalId: parsed.externalId,
        senderId: '',
        senderName: '',
        text: RETIRE_TEXT,
        internal: true,
      };
      try {
        await this.prompt(key, inbound);
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] ${key} 归档回合提交失败：${error?.message ?? error}`);
        this.retireWaiter = null;
      }
      if (this.retireWaiter) await Promise.race([done, sleep(this.retireTimeoutMs)]);
      const result = this.retireResult;
      if (!result) {
        this.logger?.warn?.(`[lane-bridge] ${key} 归档回合未沉淀任何内容（模型没有调用 lane_retire），仍会重置会话`);
      } else {
        this.logger?.info?.(`[lane-bridge] ${key} 归档完成：记忆 ${result.memory} 条，知识库草稿 ${result.kbDraft} 条`);
      }
    } finally {
      this.retireWaiter = null;
      this.retireResult = null;
      try {
        await this.reset(key);
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] ${key} 归档后重置失败：${error?.message ?? error}`);
      }
      this.retiring.delete(key);
    }
  }

  async prompt(key, inbound) {
    const resolved = resolveConversation(this.store.get(), key);
    // Remember who is speaking before the turn starts: the lane_* tools read
    // this to gate operator-only actions.
    this.turnSender.set(key, {
      senderId: String(inbound?.senderId ?? ''),
      senderName: String(inbound?.senderName ?? ''),
      isOperator: isOperator(this.store.get(), key, inbound?.senderId),
      at: Date.now(),
    });
    const sessionId = await this.ensureSession(key, resolved);
    await this.startFollow(sessionId, key);
    await this.waitForAgentReady(sessionId, key);
    await this.applyModel(sessionId, resolved);
    const { text, injectedRole, roleKey } = await this.buildPrompt(key, inbound, resolved);
    const content = await this.buildContent(text, inbound);
    // DSH's prompt(request, signal) dereferences the signal on entry; omitting
    // it throws "Cannot read properties of undefined (reading 'throwIfAborted')"
    // and the user's message is silently dropped. A never-aborted signal keeps
    // admission cancellable in shape without cancelling our own retries.
    const signal = new AbortController().signal;
    const submit = async (parts) => this.ctx.sessionController.prompt({
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: parts,
    }, signal);
    const submitWithRetry = async (parts) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await submit(parts);
        } catch (error) {
          if (attempt < 2 && isTransientProjectionError(error)) {
            this.logger?.warn?.(`[lane-bridge] ${key} 提交被会话投影拒绝，等待后重试：${promptErrorText(error)}`);
            await sleep(250 * (attempt + 1));
            continue;
          }
          throw error;
        }
      }
    };
    try {
      try {
        await submitWithRetry(content);
      } catch (error) {
        const code = String(error?.code ?? '');
        if (content.length > 1 && code.includes('attachment-invalid')) {
          this.logger?.warn?.(`[lane-bridge] ${key} 模型不接受图片，改为纯文本重试：${error?.message ?? error}`);
          await submitWithRetry([{ type: 'text', text }]);
        } else {
          throw error;
        }
      }
      if (injectedRole) {
        await this.store.update((draft) => {
          draft.sessions[key] = {
            ...(draft.sessions[key] ?? { sessionId }),
            sessionId,
            role: resolved.role,
            roleKey,
            preset: resolved.preset,
            model: resolved.model,
            updatedAt: Date.now(),
          };
        });
      }
      return sessionId;
    } catch (error) {
      const code = String(error?.code ?? '');
      if (code.includes('not-found') || code.includes('writer-held')) {
        this.logger?.warn?.(`[lane-bridge] 会话 ${sessionId.slice(0, 8)} 不可用，重建后重试一次`);
        await this.store.setSession(key, null);
        const fresh = await this.ensureSession(key, resolved);
        await this.startFollow(fresh, key);
        await this.waitForAgentReady(fresh, key);
        await this.ctx.sessionController.prompt({
          requestId: crypto.randomUUID(),
          sessionId: fresh,
          mode: 'queue',
          content,
        }, new AbortController().signal);
        return fresh;
      }
      if (isTransientProjectionError(error)) {
        this.logger?.warn?.(`[lane-bridge] ${key} 会话投影仍不可用，清理会话映射，下一条消息重建`);
        await this.store.setSession(key, null);
      }
      throw error;
    }
  }

  async startFollow(sessionId, key) {
    const existing = this.follows.get(sessionId);
    if (existing) return existing.ready;
    const ac = new AbortController();
    let readyResolve;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    const entry = { ac, key, ready, started: false };
    this.follows.set(sessionId, entry);
    let collector = createTurnCollector();
    this.collectors.set(sessionId, collector);
    const lastSeq = { value: 0 };

    const run = async () => {
      try {
        // DSH moved the durable event follower from the `sessionQuery` service
        // to `sessionController.history`. Prefer the current location and keep
        // the old one as a fallback for older hosts.
        const history = this.ctx.sessionController?.history;
        const follow = typeof history?.follow === 'function'
          ? history.follow.bind(history)
          : typeof this.ctx.sessionQuery?.follow === 'function'
            ? this.ctx.sessionQuery.follow.bind(this.ctx.sessionQuery)
            : null;
        if (!follow) throw new Error('当前 DSH 没有提供会话事件流（sessionController.history.follow 缺失）');
        const stream = follow(
          { address: { kind: 'session', sessionId }, assistantStream: false },
          ac.signal
        );
        for await (const raw of stream) {
          if (ac.signal.aborted) break;
          if (raw?.type === 'snapshot') {
            for (const record of snapshotRecords(raw)) {
              if (record.seq !== null && record.seq > lastSeq.value) lastSeq.value = record.seq;
            }
            if (!entry.started) {
              entry.started = true;
              readyResolve?.();
            }
            continue;
          }
          const record = normalizeFollowRecord(raw);
          if (!record) continue;
          if (record.seq !== null) {
            if (record.seq <= lastSeq.value) continue;
            lastSeq.value = record.seq;
          }
          if (!entry.started) {
            entry.started = true;
            readyResolve?.();
          }
          const event = record.event;
          if (event.type === 'assistant/message' && event.data?.usage && this.usageStore) {
            this.usageStore.record({
              key,
              sessionId,
              model: event.data?.message?.source?.model ?? '',
              provider: event.data?.message?.source?.provider ?? '',
              usage: event.data.usage,
              at: Date.now(),
            });
          }
          if (event.type === 'turn/start') this.consumeTurnSent(key);
          const ended = collector.push(event);
          if (ended) {
            collector = createTurnCollector();
            this.collectors.set(sessionId, collector);
            await this.afterTurn(key, sessionId);
            try {
              await this.onTurnEnd?.({ key, sessionId, ended, resolved: resolveConversation(this.store.get(), key) });
            } catch (error) {
              this.logger?.warn?.(`[lane-bridge] 回合收尾失败：${error?.message ?? error}`);
            }
            this.maybeRetire(key);
          }
        }
      } catch (error) {
        if (!ac.signal.aborted) {
          this.logger?.warn?.(`[lane-bridge] 会话 ${sessionId.slice(0, 8)} 事件流断开：${error?.message ?? error}`);
        }
      } finally {
        if (this.follows.get(sessionId) === entry) this.follows.delete(sessionId);
        if (this.collectors.get(sessionId) === collector) this.collectors.delete(sessionId);
        readyResolve?.();
      }
    };
    void run();
    // Give the snapshot a short window to land. Do not block forever: a cold
    // persistence read can be slow, and prompt admission still works.
    let timer;
    await Promise.race([ready, new Promise((resolve) => { timer = setTimeout(resolve, 4000); })]);
    clearTimeout(timer);
    return ready;
  }

  async pause(key, reason = '') {
    await this.store.update((draft) => {
      const binding = draft.bindings[key] ?? {
        domainId: draft.config.defaultDomainId,
        enabled: true,
      };
      draft.bindings[key] = {
        ...binding,
        paused: true,
        pauseReason: String(reason ?? '').slice(0, 500),
        pausedAt: Date.now(),
      };
    });
  }

  async resume(key) {
    await this.store.update((draft) => {
      const binding = draft.bindings[key];
      if (!binding) return;
      binding.paused = false;
      binding.pauseReason = '';
      binding.pausedAt = 0;
    });
  }

  /**
   * Pause auto-replies and notify a human target. Pausing always succeeds;
   * notification failure is reported to the caller instead of silently
   * pretending a human was reached.
   */
  async escalate(key, { reason = '', summary = '' } = {}) {
    const config = this.store.get().config.handoff ?? {};
    if (config.enabled === false) throw new Error('转人工未启用');
    await this.pause(key, reason);
    const targetKey = String(config.targetKey ?? '').trim();
    let notified = false;
    if (targetKey && targetKey !== key) {
      const label = conversationLabel(this.store.get(), key);
      const lines = [
        '【转人工】',
        `会话：${label}`,
        `key：${key}`,
        reason ? `原因：${String(reason).slice(0, 500)}` : '',
        summary ? `摘要：${String(summary).slice(0, 1000)}` : '',
      ].filter(Boolean);
      try {
        // Notification goes to another conversation: a push, not a reply.
        await this.channelManager.sendKey(targetKey, [lines.join(String.fromCharCode(10))], { reply: targetKey === key });
        notified = true;
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] 转人工通知失败（${targetKey}）：${error?.message ?? error}`);
      }
    }
    let ackSent = false;
    if (config.ackMessage) {
      try {
        await this.channelManager.sendKey(key, [String(config.ackMessage)], { reply: true });
        ackSent = true;
      } catch {}
    }
    return { paused: true, notified, targetKey, ackSent };
  }

  /**
   * Forget the DSH session mapped to one conversation.
   *
   * The old session stays in DSH history, but the next inbound message starts a
   * fresh one. A running turn is cancelled so it cannot deliver a stale reply
   * through the (now aborted) follow loop.
   */
  async reset(key) {
    const sessionId = this.store.get().sessions?.[key]?.sessionId ?? '';
    if (sessionId) {
      const follow = this.follows.get(sessionId);
      if (follow) {
        follow.ac.abort();
        this.follows.delete(sessionId);
      }
      this.collectors.delete(sessionId);
      this.keyBySession.delete(sessionId);
      if (this.ctx.agents.get(sessionId)) {
        try { await this.ctx.sessionController.cancel({ sessionId }); } catch {}
      }
    }
    const handle = this.handles.get(key);
    if (handle) {
      this.handles.delete(key);
      try { await handle.dispose?.(); } catch {}
    }
    this.configured.delete(key);
    this.turnSent.delete(key);
    await this.store.setSession(key, null);
  }

  async waitIdle(key) {
    const sessionId = this.store.get().sessions?.[key]?.sessionId;
    const agent = sessionId ? this.ctx.agents.get(sessionId) : null;
    if (agent?.whenIdle) await agent.whenIdle();
  }

  async stop() {
    for (const entry of this.follows.values()) entry.ac.abort();
    this.follows.clear();
    this.collectors.clear();
    for (const handle of this.handles.values()) {
      try { await handle.dispose?.(); } catch {}
    }
    this.handles.clear();
  }
}
