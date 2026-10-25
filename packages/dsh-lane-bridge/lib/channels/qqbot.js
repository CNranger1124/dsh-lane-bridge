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

  /**
   * Send text to a c2c/group target.
   *
   * Two kinds of request hit the same endpoint:
   *   - **passive reply**: carries `msg_id` (+ auto `msg_seq`) of a message the
   *     bot received. Always allowed.
   *   - **active message**: no `msg_id`. Subject to a platform permission/额度; on
   *     a bot without it the API answers `主动消息失败, 无权限`.
   *
   * The rule here is therefore about *having a msg_id*, not about its age: if we
   * have one we always send it and let the platform decide whether it is still
   * acceptable (stripping it ourselves would silently turn a valid reply into a
   * rejected active message).
   */
  async send(conversation, messages) {
    if (!this.bot) throw new Error('QQ Bot 未连接');
    const cfg = this.config ?? {};
    const allowActive = cfg.allowActive === true;
    const replyToId = String(conversation.replyToId ?? '').trim();
    const passive = replyToId !== '';
    if (!passive && !allowActive) {
      const scope = conversation.kind === 'private' ? '私聊' : '群';
      throw new Error(
        `QQ ${scope}主动消息没有权限：这条不是「回复某条收到的消息」（没有 msg_id），属于主动消息。`
        + ' 需要主动推送时，先确认机器人具备主动消息能力，再到 Settings → IM 桥接 → 官方 QQ Bot 勾选「允许主动消息」。'
      );
    }
    const target = {
      scope: conversation.kind === 'private' ? 'c2c' : 'group',
      targetId: String(conversation.externalId),
      ...(passive ? { msgId: replyToId } : {}),
    };
    const results = [];
    // A passive reply may be used at most 5 times per received message; going
    // past that is a hard platform error, so drop (and log) the overflow instead.
    const queue = passive ? messages.slice(0, 5) : messages;
    if (passive && messages.length > 5) {
      this.logger?.warn?.(`[lane-bridge] QQ 被动回复上限 5 条，已丢弃 ${messages.length - 5} 条（${conversation.externalId}）`);
    }
    for (const message of queue) {
      const text = String(message ?? '').trim();
      if (!text) continue;
      try {
        results.push(await this.bot.sendText(target, text));
      } catch (error) {
        throw this.decorateSendError(error, { active: !passive });
      }
    }
    return results;
  }

  /**
   * Turn the platform's raw API error into something an operator can act on.
   *
   * The codes come from the official 发送群聊消息 / 发送单聊消息 pages; the SDK
   * mostly forwards the Chinese text, so match either form.
   */
  decorateSendError(error, { active }) {
    const message = String(error?.message ?? error);
    const matched = QQ_SEND_ERROR_HINTS.find(([pattern]) => pattern.test(message));
    if (!matched) {
      if (!active || !/无权限|not allowed|permission|403/iu.test(message)) return error;
      const wrapped = new Error(`${message} （这是主动消息：机器人需要具备主动消息权限）`);
      wrapped.code = error?.code;
      return wrapped;
    }
    const wrapped = new Error(`${message} （${matched[1]}）`);
    wrapped.code = error?.code;
    return wrapped;
  }
}

// [matcher, 排查建议] — order matters: the first hit wins.
const QQ_SEND_ERROR_HINTS = [
  [/40034105|主动消息发送失败[，,]\s*无权限/u,
    '主动消息无权限 40034105：机器人没有主动发送能力（常见原因：机器人尚未上线 / 沙箱环境，或未在开放平台开启主动消息）。被动回复不受影响'],
  [/40034100|主动消息发送超过频控/u,
    '主动消息超出频控 40034100：认证机器人 60 qpm、未认证 30 qpm，单关系 20 qpm，每个群每天最多 1000 条'],
  [/40034005|40034024|40034026|40034128|消息ID已过期|msg_id\s*已过期|被动回复时间或次数超限/u,
    '被动回复已失效（40034005/40034128）：msg_id 只有 5 分钟有效期，且同一条消息最多回复 5 次'],
  [/40034101|40054003|机器人非群成员|机器人不是群成员/u,
    '机器人不在这个群里（40034101/40054003），先把机器人拉进群'],
  [/40054002|机器人被禁言/u, '机器人在这个群里被禁言（40054002）'],
  [/40054005|消息被去重/u, '消息被判为重复（40054005）：同一个 msg_id 的 msg_seq 必须递增'],
  [/40054007|消息长度超限/u, '消息太长（40054007）'],
  [/40054010|不允许发送URL/u, '这条消息不允许包含 URL（40054010）'],
  [/40054016|机器人已下线/u, '机器人已下线（40054016）'],
];
