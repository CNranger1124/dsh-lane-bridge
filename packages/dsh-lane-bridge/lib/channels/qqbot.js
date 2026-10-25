// Official QQ Bot adapter (QQ Open Platform).
//
// Experimental: it uses `@tencent-connect/qqbot-nodejs` directly so that this
// plugin, not a separate DSH plugin, owns the conversation→session mapping.
import { ChannelAdapter } from './base.js';

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= import('@tencent-connect/qqbot-nodejs');
  return sdkPromise;
}

function loggerFacade(logger) {
  return {
    debug: (...args) => logger?.debug?.(...args),
    info: (...args) => logger?.info?.(...args),
    warn: (...args) => logger?.warn?.(...args),
    error: (...args) => logger?.error?.(...args),
  };
}

export class QqbotAdapter extends ChannelAdapter {
  constructor({ config, logger = null, loadQqbotModule = null }) {
    super({ id: 'qqbot', kind: 'qqbot', logger });
    this.config = config ?? {};
    this.loadQqbotModule = loadQqbotModule;
    this.bot = null;
  }

  async start() {
    const appId = String(this.config.appId ?? '').trim();
    const appSecret = String(this.config.appSecret ?? '').trim();
    this.started = true;
    this.setStatus({ lastError: '', connected: false });
    if (!appId || !appSecret) {
      this.setError('未配置 appId / appSecret');
      return;
    }
    let sdk;
    try {
      sdk = this.loadQqbotModule ? await this.loadQqbotModule() : await loadSdk();
    } catch (error) {
      this.setError(`缺少 @tencent-connect/qqbot-nodejs：${error?.message ?? error}`);
      return;
    }
    try {
      const bot = new sdk.QQBot({
        appId,
        appSecret,
        logger: loggerFacade(this.logger),
      });
      this.bot = bot;
      bot.on('ready', (data) => {
        this.setStatus({ connected: true, selfId: String(data?.user?.id ?? data?.user?.username ?? ''), lastError: '' });
      });
      bot.on('resumed', () => this.setStatus({ connected: true }));
      bot.on('disconnected', (event) => {
        this.setStatus({ connected: false, lastError: String(event?.reason ?? '连接断开') });
      });
      bot.on('error', (error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] QQ Bot 错误：${error?.message ?? error}`);
      });
      bot.on('message', async (_ctx, msg) => {
        try {
          if (!msg || msg.senderIsBot) return;
          // GROUP_AT_MESSAGE_CREATE is only delivered when the bot is @-ed, and
          // the payload has no `mentions` array. Without this, a mention-only
          // trigger policy would treat every group @ as "not mentioning me".
          const rawEventType = String(msg.rawEventType ?? '');
          const kind = msg.kind === 'c2c' || msg.kind === 'dm' ? 'private' : 'group';
          const externalId = String(msg.replyTarget?.targetId ?? msg.groupOpenid ?? msg.channelId ?? msg.senderId ?? '');
          if (!externalId) return;
          const text = String(msg.content ?? '').trim() ||
            (Array.isArray(msg.attachments) && msg.attachments.length > 0 ? '[图片]' : '');
          const images = Array.isArray(msg.attachments)
            ? msg.attachments.slice(0, 8).map((attachment) => ({
                url: String(attachment.url ?? attachment.file_url ?? ''),
                mediaType: String(attachment.content_type ?? attachment.contentType ?? ''),
                name: String(attachment.filename ?? attachment.name ?? ''),
              })).filter((image) => image.url)
            : [];
          this.emitMessage({
            kind,
            externalId,
            senderId: String(msg.senderId ?? ''),
            senderName: String(msg.senderName ?? ''),
            text,
            images,
            mentionsBot: (Array.isArray(msg.mentions) && msg.mentions.length > 0)
              || rawEventType === 'GROUP_AT_MESSAGE_CREATE',
            replyToBot: Boolean(msg.refMsgIdx),
            replyToId: String(msg.messageId ?? ''),
            raw: { kind: msg.kind, rawEventType, messageId: msg.messageId, timestamp: msg.timestamp },
          });
        } catch (error) {
          this.logger?.warn?.(`[lane-bridge] QQ Bot 入站消息处理失败：${error?.message ?? error}`);
        }
      });
      // start() runs until stop(); never await it here.
      void bot.start().catch((error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] QQ Bot 启动失败：${error?.message ?? error}`);
      });
    } catch (error) {
      this.setError(error);
      this.logger?.warn?.(`[lane-bridge] QQ Bot 初始化失败：${error?.message ?? error}`);
    }
  }

  async stop() {
    this.started = false;
    try {
      this.bot?.stop();
    } catch {}
    this.bot = null;
    this.setStatus({ connected: false });
  }

  async send(conversation, messages) {
    if (!this.bot) throw new Error('QQ Bot 未连接');
    const target = {
      scope: conversation.kind === 'private' ? 'c2c' : 'group',
      targetId: String(conversation.externalId),
      ...(conversation.replyToId ? { msgId: String(conversation.replyToId) } : {}),
    };
    const results = [];
    for (const message of messages) {
      const text = String(message ?? '').trim();
      if (!text) continue;
      results.push(await this.bot.sendText(target, text));
    }
    return results;
  }
}
