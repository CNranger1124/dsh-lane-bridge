// Discord adapter (discord.js).
//
// Loaded lazily: the plugin still boots and shows an actionable status when
// discord.js is absent (or when the operator has not enabled Discord yet).
import { ChannelAdapter } from './base.js';

const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15); // Guilds | GuildMessages | DirectMessages | MessageContent

let discordPromise = null;
function loadDiscord() {
  discordPromise ??= import('discord.js');
  return discordPromise;
}

function messageText(message) {
  const text = String(message?.content ?? '').trim();
  if (text) return text;
  const count = Number(message?.attachments?.size ?? message?.attachments?.length ?? 0);
  return count > 0 ? '[图片/附件]' : '';
}

export class DiscordAdapter extends ChannelAdapter {
  /**
   * @param {object} options
   * @param {object} options.config
   * @param {object} [options.logger]
   * @param {() => Promise<object>} [options.loadDiscordModule] test seam
   */
  constructor({ config, logger = null, loadDiscordModule = null }) {
    super({ id: 'discord', kind: 'discord', logger });
    this.config = config ?? {};
    this.loadDiscordModule = loadDiscordModule;
    this.client = null;
  }

  async start() {
    const token = String(this.config.token ?? '').trim();
    this.started = true;
    this.setStatus({ lastError: '', connected: false });
    if (!token) {
      this.setError('未配置 Discord Bot Token');
      return;
    }
    let discord;
    try {
      discord = this.loadDiscordModule ? await this.loadDiscordModule() : await loadDiscord();
    } catch (error) {
      this.setError(`缺少 discord.js：${error?.message ?? error}`);
      return;
    }
    try {
      const client = new discord.Client({ intents: INTENTS });
      this.client = client;
      client.on('ready', () => {
        this.setStatus({ connected: true, selfId: String(client.user?.id ?? ''), nickname: String(client.user?.username ?? ''), lastError: '' });
        this.logger?.info?.(`[lane-bridge] Discord 已连接：${client.user?.tag ?? client.user?.username ?? ''}`);
      });
      client.on('error', (error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] Discord 错误：${error?.message ?? error}`);
      });
      client.on('shardDisconnect', (event) => {
        this.setStatus({ connected: false, lastError: String(event?.reason ?? '连接断开') });
      });
      client.on('shardResume', () => this.setStatus({ connected: true }));
      client.on('messageCreate', async (message) => {
        try {
          if (!message || message.author?.bot || message.system) return;
          const isGroup = Boolean(message.guild);
          const mentioned = Boolean(message.mentions?.users?.has?.(client.user?.id));
          // A reply without a mention is only "to the bot" when the referenced
          // author is us. Fall back to trusting the reference when the fetch
          // fails, which is the conservative behavior for a support inbox.
          let replyToBot = Boolean(message.reference?.messageId);
          if (replyToBot && typeof message.fetchReference === 'function') {
            try {
              const referenced = await message.fetchReference();
              replyToBot = String(referenced?.author?.id ?? '') === String(client.user?.id ?? '');
            } catch {}
          }
          if (isGroup && this.config.requireMention === true && !mentioned && !replyToBot) return;
          const text = messageText(message);
          if (!text) return;
          const images = message.attachments?.size > 0
            ? [...message.attachments.values()].slice(0, 8).map((attachment) => ({
                url: String(attachment.url ?? ''),
                mediaType: String(attachment.contentType ?? ''),
                name: String(attachment.name ?? ''),
              })).filter((image) => image.url)
            : [];
          this.emitMessage({
            kind: isGroup ? 'group' : 'private',
            externalId: isGroup ? String(message.channelId) : String(message.author.id),
            senderId: String(message.author.id),
            senderName: String(message.member?.displayName || message.author.username || message.author.id),
            text,
            images,
            mentionsBot: mentioned,
            replyToBot,
            replyToId: String(message.id),
            raw: { channelId: message.channelId, guildId: message.guildId },
          });
        } catch (error) {
          this.logger?.warn?.(`[lane-bridge] Discord 入站消息处理失败：${error?.message ?? error}`);
        }
      });
      // login() resolves when the socket is established, not when READY; do not
      // block plugin activation.
      void client.login(token).catch((error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] Discord 登录失败：${error?.message ?? error}`);
      });
    } catch (error) {
      this.setError(error);
      this.logger?.warn?.(`[lane-bridge] Discord 初始化失败：${error?.message ?? error}`);
    }
  }

  async stop() {
    this.started = false;
    try { this.client?.destroy(); } catch {}
    this.client = null;
    this.setStatus({ connected: false });
  }

  async destination(conversation) {
    if (!this.client) throw new Error('Discord 未连接');
    if (conversation.kind === 'private') {
      const user = await this.client.users.fetch(String(conversation.externalId));
      return user.createDM();
    }
    return this.client.channels.fetch(String(conversation.externalId));
  }

  async send(conversation, messages) {
    const channel = await this.destination(conversation);
    if (!channel?.send) throw new Error('Discord 目标频道不可用');
    const results = [];
    for (const message of messages) {
      const text = String(message ?? '').trim();
      if (!text) continue;
      const payload = {
        content: text,
        allowedMentions: { parse: [] },
        ...(conversation.replyToId
          ? { reply: { messageReference: String(conversation.replyToId), failIfNotExists: false } }
          : {}),
      };
      results.push(await channel.send(payload));
    }
    return results;
  }
}
