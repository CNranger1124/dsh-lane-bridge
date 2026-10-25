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
  resolveConversation,
  roleContent,
} from './router.js';
import { publicError, splitText, stripMarkdown } from './text.js';
import { fetchImage } from './media.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function normalizeFollowRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw.event && typeof raw.event === 'object' ? raw.event : raw;
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
  constructor({ ctx, store, channelManager, workspaceDir, knowledgeDir, memoryStore = null, usageStore = null, repo = null, logger = null, onTurnEnd, fetchImageImpl = fetchImage }) {
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
    this.keyBySession = new Map(); // sessionId -> key
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

  /** Build the prompt text, injecting the role card on first turn / role change. */
  async buildPrompt(key, inbound, resolved) {
    const state = this.store.get();
    const record = state.sessions?.[key];
    const roleText = roleContent(state, resolved.role);
    // Include a short content hash: editing a role card must re-inject it even
    // when the name did not change.
    const roleKey = `${resolved.role}:${crypto.createHash('sha1').update(roleText).digest('hex').slice(0, 10)}`;
    const needRole = record?.roleKey !== roleKey;
    const memoryText = resolved.memoryEnabled && this.memoryStore
      ? this.memoryStore.render(resolved.domain?.id, resolved.memoryMaxChars)
      : '';
    const prefix = buildContextPrefix({
      resolved,
      roleText: needRole ? roleText.slice(0, 8000) : '',
      memoryText,
      channel: inbound.channel,
      kind: inbound.kind,
      externalId: inbound.externalId,
      senderName: inbound.senderName,
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

  async prompt(key, inbound) {
    const resolved = resolveConversation(this.store.get(), key);
    const sessionId = await this.ensureSession(key, resolved);
    await this.startFollow(sessionId, key);
    await this.waitForAgentReady(sessionId, key);
    await this.applyModel(sessionId, resolved);
    const { text, injectedRole, roleKey } = await this.buildPrompt(key, inbound, resolved);
    const content = await this.buildContent(text, inbound);
    const submit = async (parts) => this.ctx.sessionController.prompt({
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: parts,
    });
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
        });
        return fresh;
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
        const stream = this.ctx.sessionQuery.follow(
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
            try {
              await this.onTurnEnd?.({ key, sessionId, ended, resolved: resolveConversation(this.store.get(), key) });
            } catch (error) {
              this.logger?.warn?.(`[lane-bridge] 回合收尾失败：${error?.message ?? error}`);
            }
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
        await this.channelManager.sendKey(targetKey, [lines.join(String.fromCharCode(10))]);
        notified = true;
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] 转人工通知失败（${targetKey}）：${error?.message ?? error}`);
      }
    }
    let ackSent = false;
    if (config.ackMessage) {
      try {
        await this.channelManager.sendKey(key, [String(config.ackMessage)]);
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
