// Channel manager: lifecycle + status + outbound dispatch.
//
// A channel *instance* is one bot: an id (`qqbot`, `qqbot-2`, `support-bot`), a
// kind (`snowluma` / `qqbot` / `discord`) and its credentials. The instance id is
// what ends up in conversation keys (`<id>:group:<外部 id>`), so each bot keeps
// its own conversations, roles, domains and sessions.
//
// Lifecycle operations are per instance on purpose: saving one card or hitting
// "retry" on one bot must not drop every other connection.
import { channelConfigured, channelKindOf, CHANNEL_KIND_LABELS, parseConversationKey } from '../defaults.js';
import { SnowLumaAdapter } from './snowluma.js';
import { QqbotAdapter } from './qqbot.js';
import { DiscordAdapter } from './discord.js';

function labelOf(id, entry) {
  const kind = channelKindOf(id, entry);
  return String(entry?.label ?? '').trim() || CHANNEL_KIND_LABELS[kind] || id;
}

export class ChannelManager {
  /**
   * @param {object} options
   * @param {() => object} options.getConfig
   * @param {(message: object) => void} options.onMessage
   * @param {object} [options.logger]
   */
  constructor({ getConfig, getConversation = null, onMessage, logger = null }) {
    this.getConfig = getConfig;
    this.getConversation = getConversation;
    this.onMessage = onMessage;
    this.baseLogger = logger;
    this.logLines = [];
    this.logger = this.#wrapLogger();
    this.adapters = new Map();
    this.statuses = new Map();
    // Lifecycle calls are serialized: a "retry" must not interleave with a
    // config save that is restarting the same adapter.
    this.queue = Promise.resolve();
  }

  #record(level, args) {
    const text = args.map((value) => typeof value === 'string' ? value : String(value?.message ?? value)).join(' ');
    this.logLines.push({ at: Date.now(), level, text: text.slice(0, 2000) });
    if (this.logLines.length > 300) this.logLines.splice(0, this.logLines.length - 300);
  }

  #wrapLogger() {
    const base = this.baseLogger;
    return {
      debug: (...args) => { this.#record('debug', args); base?.debug?.(...args); },
      info: (...args) => { this.#record('info', args); base?.info?.(...args); },
      warn: (...args) => { this.#record('warn', args); base?.warn?.(...args); },
      error: (...args) => { this.#record('error', args); base?.error?.(...args); },
    };
  }

  logs() {
    return [...this.logLines].reverse();
  }

  labels() {
    return CHANNEL_KIND_LABELS;
  }

  buildAdapter(id, entry) {
    const kind = channelKindOf(id, entry);
    const options = { id, config: { ...entry, id, kind }, logger: this.logger };
    if (kind === 'snowluma') return new SnowLumaAdapter(options);
    if (kind === 'qqbot') return new QqbotAdapter(options);
    if (kind === 'discord') return new DiscordAdapter(options);
    return null;
  }

  #disabledStatus(id, entry) {
    return {
      id,
      kind: channelKindOf(id, entry),
      label: labelOf(id, entry),
      enabled: false,
      started: false,
      connected: false,
      lastError: '',
      lastEventAt: 0,
    };
  }

  #wire(id, entry, adapter) {
    const kind = channelKindOf(id, entry);
    const label = labelOf(id, entry);
    adapter.on('message', (message) => {
      try {
        this.onMessage(message);
      } catch (error) {
        this.logger?.warn?.(`[lane-bridge] 入站消息分发失败：${error?.message ?? error}`);
      }
    });
    adapter.on('status', (status) => {
      // A stopped adapter can emit a late disconnect after its replacement has
      // already connected. Ignore events from anything but the current adapter,
      // otherwise a stale "disconnected" overwrites the live status and the UI
      // looks offline while the bot is actually online.
      if (this.adapters.get(id) !== adapter) return;
      this.statuses.set(id, {
        ...status,
        enabled: true,
        kind,
        label,
        lastEventAt: adapter.state.lastEventAt,
      });
      if (status?.lastError) this.logger.warn(`[${id}] ${status.lastError}`);
      else if (status?.connected) this.logger.info(`[${id}] 已连接`);
    });
    this.adapters.set(id, adapter);
    this.statuses.set(id, {
      ...adapter.status(),
      enabled: true,
      kind,
      label,
      lastEventAt: 0,
    });
    // Never await a transport here: a missing gateway must not block the DSH
    // host from becoming ready, and one broken bot must not block the others.
    const target = kind === 'snowluma' ? entry.wsUrl : kind === 'qqbot' ? entry.appId : '';
    this.logger.info(`[${id}] 启动通道（${target || (channelConfigured(entry) ? '凭据已配置' : '无凭据')}）`);
    adapter.start().catch((error) => {
      adapter.setError(error);
      this.logger.warn(`[${id}] 启动失败：${error?.message ?? error}`);
    });
  }

  /** Start (or restart) exactly one instance, leaving every other one alone. */
  async startOne(id) {
    const key = String(id ?? '').trim();
    if (!key) return false;
    const config = this.getConfig?.() ?? {};
    const entry = config?.channels?.[key];
    if (!entry) return false;
    await this.stopOne(key);
    if (config?.enabled === false || entry.enabled !== true) {
      this.statuses.set(key, this.#disabledStatus(key, entry));
      return false;
    }
    const adapter = this.buildAdapter(key, entry);
    if (!adapter) return false;
    this.#wire(key, entry, adapter);
    return true;
  }

  /** Stop exactly one instance. Returns whether there was one to stop. */
  async stopOne(id) {
    const key = String(id ?? '').trim();
    const adapter = this.adapters.get(key);
    if (!adapter) return false;
    // Remove first: a late `status` from this adapter then fails the identity
    // check in #wire and cannot overwrite the replacement's state.
    this.adapters.delete(key);
    await adapter.stop().catch(() => {});
    return true;
  }

  /**
   * Restart one instance (connect + retry). Returns false when the instance is
   * unknown or not enabled — the route turns that into a 404/400.
   */
  async restart(id) {
    const key = String(id ?? '').trim();
    const config = this.getConfig?.() ?? {};
    if (!config?.channels?.[key]) return false;
    return this.sync([key]);
  }

  /**
   * Reconcile adapters with the persisted config.
   *
   * `sync()` — full reconcile (startup, plugin switch, delete).
   * `sync([id, …])` — only those instances: a per-card save or "retry" must not
   * disconnect the other bots.
   */
  async sync(ids = null) {
    const only = Array.isArray(ids)
      ? [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : null;
    const task = async () => {
      if (only) {
        for (const id of only) await this.startOne(id);
        return;
      }
      await this.stopAll();
      this.statuses.clear();
      const config = this.getConfig?.() ?? {};
      if (config?.enabled === false) return;
      for (const id of Object.keys(config?.channels ?? {})) await this.startOne(id);
    };
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async stopAll() {
    const adapters = [...this.adapters.entries()];
    this.adapters.clear();
    await Promise.allSettled(adapters.map(([, adapter]) => adapter.stop().catch(() => {})));
  }

  status() {
    const config = this.getConfig?.() ?? {};
    const out = [];
    for (const [id, entry] of Object.entries(config?.channels ?? {})) {
      const kind = channelKindOf(id, entry);
      const label = labelOf(id, entry);
      const status = this.statuses.get(id) ?? {
        ...this.#disabledStatus(id, entry),
        enabled: entry?.enabled === true,
      };
      const enabled = config?.enabled !== false && entry?.enabled === true;
      const configured = channelConfigured(entry);
      let hint = '';
      if (config?.enabled === false) hint = '插件总开关已关闭：先打开「插件启用」并保存';
      else if (!enabled) hint = '未启动：点卡片右上角的「启动」';
      else if (!configured) hint = kind === 'snowluma'
        ? '填 SnowLuma 安装目录或 WS 地址后保存；默认 127.0.0.1:3001'
        : kind === 'qqbot'
          ? '填 AppID 和 AppSecret 后保存'
          : '填 Bot Token 后保存';
      else if (!status.connected) hint = kind === 'snowluma'
        ? 'SnowLuma 未运行或端口不对：先启动 SnowLuma；默认 WS 127.0.0.1:3001（本插件不会代启动）'
        : kind === 'qqbot'
          ? '正在连接官方 QQ Bot；若一直失败，检查 AppID/AppSecret 与网络'
          : '正在连接 Discord；若一直失败，检查 Token 和 Message Content Intent';
      out.push({ ...status, id, kind, label, enabled, configured, hint });
    }
    return out;
  }

  adapterFor(channel) {
    return this.adapters.get(channel) ?? null;
  }

  /**
   * Send to a conversation key (`<channel>:<kind>:<id>`).
   *
   * `options.reply` states the **intent**: true when this is the answer to the
   * message that just arrived (turn reply, ack), false for a push. Only replies
   * may carry `replyToId` — attaching a stale id to a push is what produced
   * `40034005 回复消息msg_id已过期` on QQ.
   */
  async sendKey(key, messages, options = {}) {
    const parsed = parseConversationKey(key);
    if (!parsed) throw new Error(`非法的会话 key：${key}`);
    const adapter = this.adapterFor(parsed.channel);
    if (!adapter) throw new Error(`通道未启用或未连接：${parsed.channel}`);
    const convo = this.getConversation?.(key) ?? null;
    const reply = options.reply === true;
    return adapter.send({
      channel: parsed.channel,
      kind: parsed.kind,
      externalId: parsed.externalId,
      reply,
      replyToId: reply ? String(convo?.replyToId ?? '') : '',
      replyToAt: reply ? Number(convo?.lastAt) || 0 : 0,
    }, messages);
  }

  async sendToConversation(conversation, messages) {
    const adapter = this.adapterFor(conversation.channel);
    if (!adapter) throw new Error(`通道未启用或未连接：${conversation.channel}`);
    return adapter.send(conversation, messages);
  }
}
