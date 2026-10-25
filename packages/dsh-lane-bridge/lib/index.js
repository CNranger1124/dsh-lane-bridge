// dsh-lane-bridge host plugin.
//
// Responsibilities:
//   - own the durable store (channels/domains/bindings/conversations/sessions)
//   - run channel adapters and normalize inbound messages
//   - map one conversation to one DSH session
//   - attach per-conversation tools and restrictions
//   - deliver assistant turns back to the channel, and expose push routes
import path from 'node:path';
import { LaneStore, defaultDataDir } from './store.js';
import { ChannelManager } from './channels/manager.js';
import { SessionPool } from './session-pool.js';
import { createRoutes, ROUTE_PREFIX } from './routes.js';
import { canReply, resolveConversation, shouldTrigger } from './router.js';
import { createReplyDispatcher } from './reply-dispatcher.js';
import { InboundQueue } from './inbound-queue.js';
import { MemoryStore } from './memory.js';
import { UsageStore } from './usage.js';
import { GitHubRepo } from './repo.js';
import { conversationKey } from './defaults.js';
import { publicError } from './text.js';

export const name = 'dsh-lane-bridge';

// These are DSH host services. The plugin row in cordis.patch.yml is mounted
// after them; Cordis keeps the fiber inactive until all are available.
export const inject = [
  'webServer',
  'sessionController',
  'sessionQuery',
  'workspaceController',
  'agents',
  'tools',
];

function makeLogger(ctx) {
  const logger = ctx.logger ?? console;
  return {
    debug: (...args) => logger.debug?.(...args),
    info: (...args) => logger.info?.(...args),
    warn: (...args) => logger.warn?.(...args),
    error: (...args) => logger.error?.(...args),
  };
}

function displayNameFor(message) {
  if (message.kind === 'private') return message.senderName || `私聊 ${message.externalId}`;
  return message.senderName ? `群 ${message.externalId}（${message.senderName}）` : `群 ${message.externalId}`;
}

export async function apply(ctx, config = {}) {
  const logger = makeLogger(ctx);
  const dataDir = path.resolve(String(config.dataDir ?? '').trim() || defaultDataDir());
  const store = new LaneStore({ dataDir, logger });
  await store.load();
  const memoryStore = new MemoryStore({ dir: path.join(dataDir, 'memories'), logger });
  const usageStore = new UsageStore({ file: path.join(dataDir, 'usage.jsonl'), logger });
  const repo = new GitHubRepo({ getConfig: () => store.get().config, dataDir, logger });
  logger.info(`[lane-bridge] 数据目录：${store.paths.dataDir}`);

  let stopped = false;

  const channelManager = new ChannelManager({
    getConfig: () => store.get().config,
    getConversation: (key) => store.get().conversations?.[key] ?? null,
    logger,
    onMessage: (message) => {
      void handleInbound(message).catch((error) => {
        logger.warn?.(`[lane-bridge] 入站处理失败：${error?.message ?? error}`);
      });
    },
  });

  let pool = null;
  const runtimeLogger = channelManager.logger ?? logger;
  const dispatchReply = createReplyDispatcher({
    store,
    channels: channelManager,
    consumeSent: (key) => pool?.consumeTurnSent(key) ?? 0,
    logger: runtimeLogger,
  });
  pool = new SessionPool({
    ctx,
    store,
    channelManager,
    workspaceDir: `${store.paths.dataDir}/workspace`,
    knowledgeDir: store.paths.knowledgeDir,
    memoryStore,
    usageStore,
    repo,
    logger: runtimeLogger,
    // The retire turn is an internal instruction ("sediment this conversation");
    // its text must never reach the chat.
    onTurnEnd: async (payload) => {
      if (pool?.isRetiring?.(payload.key)) return;
      await dispatchReply(payload);
    },
  });

  async function sendApology(key) {
    try {
      await channelManager.sendKey(key, ['抱歉，我这边处理这条消息时出错了，请稍后再试。']);
    } catch (error) {
      runtimeLogger.warn?.(`[lane-bridge] ${key} 错误提示发送失败：${error?.message ?? error}`);
    }
  }

  const inboundQueue = new InboundQueue({
    delayMs: () => store.get().config.reply?.debounceMs ?? 0,
    onFlush: async (key, message) => {
      if (stopped) return;
      try {
        await pool.prompt(key, message);
        runtimeLogger.debug?.(`[lane-bridge] ${key} -> 会话已接受`);
      } catch (error) {
        const reason = error?.details?.reason ? `（${String(error.details.reason).slice(0, 300)}）` : '';
        runtimeLogger.warn?.(`[lane-bridge] ${key} 提交回合失败 [${error?.code ?? 'error'}]：${publicError(error)}${reason}`);
        await sendApology(key);
      }
    },
    logger: runtimeLogger,
  });

  async function handleInbound(message) {
    if (stopped) return;
    const configNow = store.get().config;
    if (configNow.enabled === false) return;
    if (!message?.externalId || !message.channel) return;
    const key = conversationKey(message.channel, message.kind, message.externalId);
    // Record discovery before the binding decision: unbound chats must show up
    // in the Settings card so the operator can bind them.
    await store.touchConversation({
      key,
      channel: message.channel,
      kind: message.kind,
      externalId: message.externalId,
      name: displayNameFor(message),
      lastAt: Date.now(),
      lastText: String(message.text ?? '').slice(0, 500),
      replyToId: String(message.replyToId ?? ''),
      // Remembered so the operator whitelist can be filled by copying an id
      // instead of guessing an openid from the logs.
      senderId: String(message.senderId ?? ''),
      senderName: String(message.senderName ?? ''),
    });
    const state = store.get();
    const resolved = resolveConversation(state, key);
    if (!canReply(state, key)) {
      logger.info?.(`[lane-bridge] 未绑定/未开启自动回复，已记录会话 ${key}`);
      return;
    }
    const text = String(message.text ?? '').trim();
    if (!text && (!message.images || message.images.length === 0)) return;
    logger.debug?.(
      `[lane-bridge] 入站 ${key}（${message.kind}，mentionsBot=${message.mentionsBot === true}`
      + `，replyToBot=${message.replyToBot === true}，sender=${message.senderId || '?'}`
      + `，event=${message.raw?.rawEventType || '-'}）：${text.slice(0, 40)}`
    );
    if (!shouldTrigger(state, key, message)) {
      logger.debug?.(
        `[lane-bridge] ${key} 未命中触发策略（${resolved.triggers.join('+')}`
        + `；mentionsBot=${message.mentionsBot === true}，replyToBot=${message.replyToBot === true}`
        + `，kind=${message.kind}），只记录不回复`
      );
      return;
    }
    inboundQueue.push(key, message);
  }

  // Read the host's declared presets on demand. `agentPresets` is optional so a
  // deployment without the registry still loads the bridge (the Settings card
  // then keeps the free-text fallback).
  const listPresets = async () => {
    const registry = ctx.get?.('agentPresets');
    if (!registry) return [];
    if (typeof registry.remoteExportList === 'function') {
      const exported = await registry.remoteExportList();
      return Array.isArray(exported?.presets) ? exported.presets : [];
    }
    if (typeof registry.list === 'function') return await registry.list();
    return [];
  };

  const routes = createRoutes({ store, channels: channelManager, pool, memoryStore, usageStore, repo, logger, listPresets });
  const disposers = [];
  disposers.push(ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: routes.handle }));
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX,
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`dsh-lane-bridge is running.\nSettings → IM 桥接\nAPI: ${ROUTE_PREFIX}/api/state\n`);
    },
  }));

  ctx.effect(() => () => {
    stopped = true;
    inboundQueue.stop();
    for (const dispose of disposers.reverse()) {
      try { dispose(); } catch {}
    }
    void pool.stop();
    void channelManager.stopAll();
  }, 'dsh-lane-bridge lifecycle');

  await channelManager.sync();
  const enabled = store.get().config.channels;
  logger.info(`[lane-bridge] 已启动；通道：${Object.entries(enabled).filter(([, value]) => value?.enabled).map(([key]) => key).join(', ') || '无'}`);
  logger.info(`[lane-bridge] 在 DSH 设置 → IM 桥接 中配置；数据在 ${store.paths.dataDir}`);
}

export default { name, inject, apply };
