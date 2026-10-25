// Channel manager: lifecycle + status + outbound dispatch.
import { parseConversationKey } from '../defaults.js';
import { SnowLumaAdapter } from './snowluma.js';
import { QqbotAdapter } from './qqbot.js';
import { DiscordAdapter } from './discord.js';

const CHANNEL_LABELS = {
  snowluma: 'SnowLuma (QQ)',
  qqbot: '官方 QQ Bot',
  discord: 'Discord',
};

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
    this.logger = logger;
    this.adapters = new Map();
    this.statuses = new Map();
    this.syncing = null;
  }

  labels() {
    return CHANNEL_LABELS;
  }

  buildAdapter(id, config) {
    const entry = config?.channels?.[id] ?? {};
    const options = { config: entry, logger: this.logger };
    if (id === 'snowluma') return new SnowLumaAdapter(options);
    if (id === 'qqbot') return new QqbotAdapter(options);
    if (id === 'discord') return new DiscordAdapter(options);
    return null;
  }

  /** Replace all running adapters from the current persisted config. */
  async sync() {
    this.syncing ??= (async () => {
      await this.stopAll();
      const config = this.getConfig();
      if (config?.enabled === false) {
        this.statuses.clear();
        return;
      }
      for (const id of ['snowluma', 'qqbot', 'discord']) {
        const entry = config?.channels?.[id];
        if (!entry?.enabled) {
          this.statuses.set(id, {
            id,
            kind: id,
            label: CHANNEL_LABELS[id],
            enabled: false,
            started: false,
            connected: false,
            lastError: '',
            lastEventAt: 0,
          });
          continue;
        }
        const adapter = this.buildAdapter(id, config);
        if (!adapter) continue;
        adapter.on('message', (message) => {
          try {
            this.onMessage(message);
          } catch (error) {
            this.logger?.warn?.(`[lane-bridge] 入站消息分发失败：${error?.message ?? error}`);
          }
        });
        adapter.on('status', (status) => {
          this.statuses.set(id, { ...status, enabled: true, label: CHANNEL_LABELS[id], lastEventAt: adapter.state.lastEventAt });
        });
        this.adapters.set(id, adapter);
        this.statuses.set(id, {
          ...adapter.status(),
          enabled: true,
          label: CHANNEL_LABELS[id],
          lastEventAt: 0,
        });
        // Never await a transport here: a missing gateway must not block the
        // DSH host from becoming ready.
        adapter.start().catch((error) => {
          adapter.setError(error);
          this.logger?.warn?.(`[lane-bridge] 通道 ${id} 启动失败：${error?.message ?? error}`);
        });
      }
    })();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  async stopAll() {
    const adapters = [...this.adapters.values()];
    this.adapters.clear();
    await Promise.allSettled(adapters.map((adapter) => adapter.stop().catch(() => {})));
  }

  status() {
    const config = this.getConfig?.() ?? {};
    const out = [];
    for (const id of ['snowluma', 'qqbot', 'discord']) {
      const entry = config?.channels?.[id] ?? {};
      const status = this.statuses.get(id) ?? {
        id,
        kind: id,
        label: CHANNEL_LABELS[id],
        enabled: entry.enabled === true,
        started: false,
        connected: false,
        lastError: '',
        lastEventAt: 0,
      };
      const enabled = config?.enabled !== false && entry.enabled === true;
      const configured = id === 'snowluma'
        ? Boolean(String(entry.wsUrl ?? '').trim() || String(entry.homeDir ?? '').trim())
        : id === 'qqbot'
          ? Boolean(String(entry.appId ?? '').trim() && String(entry.appSecret ?? '').trim())
          : Boolean(String(entry.token ?? '').trim());
      let hint = '';
      if (config?.enabled === false) hint = '插件总开关已关闭：先打开「插件启用」并保存';
      else if (!enabled) hint = '未启用：点卡片右上角「启用」，或勾选下方复选框后保存';
      else if (!configured) hint = id === 'snowluma'
        ? '填 SnowLuma 安装目录或 WS 地址后保存；默认 127.0.0.1:3001'
        : id === 'qqbot'
          ? '填 AppID 和 AppSecret 后保存'
          : '填 Bot Token 后保存';
      else if (!status.connected) hint = id === 'snowluma'
        ? 'SnowLuma 未运行或端口不对：先启动 SnowLuma；默认 WS 127.0.0.1:3001（本插件不会代启动）'
        : id === 'qqbot'
          ? '正在连接官方 QQ Bot；若一直失败，检查 AppID/AppSecret 与网络'
          : '正在连接 Discord；若一直失败，检查 Token 和 Message Content Intent';
      out.push({ ...status, enabled, configured, hint });
    }
    return out;
  }

  adapterFor(channel) {
    return this.adapters.get(channel) ?? null;
  }

  /** Send to a conversation key (`<channel>:<kind>:<id>`). */
  async sendKey(key, messages) {
    const parsed = parseConversationKey(key);
    if (!parsed) throw new Error(`非法的会话 key：${key}`);
    const adapter = this.adapterFor(parsed.channel);
    if (!adapter) throw new Error(`通道未启用或未连接：${parsed.channel}`);
    const convo = this.getConversation?.(key) ?? null;
    const recent = convo && Date.now() - (Number(convo.lastAt) || 0) < 4 * 60 * 1000;
    return adapter.send({
      channel: parsed.channel,
      kind: parsed.kind,
      externalId: parsed.externalId,
      replyToId: recent ? convo.replyToId : '',
    }, messages);
  }

  async sendToConversation(conversation, messages) {
    const adapter = this.adapterFor(conversation.channel);
    if (!adapter) throw new Error(`通道未启用或未连接：${conversation.channel}`);
    return adapter.send(conversation, messages);
  }
}
