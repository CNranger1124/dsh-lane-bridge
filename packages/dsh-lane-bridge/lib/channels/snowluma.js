// SnowLuma (OneBot v11) adapter.
//
// Transport lives in onebot-ws.js so installation does not depend on a
// third-party SDK whose published ESM build needs a postinstall patch.
import { ChannelAdapter } from './base.js';
import { OneBotWsClient } from './onebot-ws.js';
import { discoverSnowLumaEndpoint } from './snowluma-discovery.js';

function segmentText(segment) {
  if (!segment || typeof segment !== 'object') return '';
  const type = String(segment.type ?? '');
  const data = segment.data ?? {};
  switch (type) {
    case 'text':
      return String(data.text ?? '');
    case 'at':
      return data.qq === 'all' ? '@全体成员 ' : `@${data.name || data.qq || '某人'} `;
    case 'image':
      return '[图片]';
    case 'face':
      return '[表情]';
    case 'record':
      return '[语音]';
    case 'video':
      return '[视频]';
    case 'file':
      return '[文件]';
    case 'forward':
      return '[转发消息]';
    case 'json':
    case 'xml':
      return '[卡片消息]';
    case 'reply':
      return '';
    default:
      return type ? `[${type}]` : '';
  }
}

export function segmentsToText(segments, rawMessage = '') {
  if (Array.isArray(segments) && segments.length > 0) {
    return segments.map(segmentText).join('').trim();
  }
  return String(rawMessage ?? '').trim();
}

function mentionsOf(segments, selfId) {
  if (!Array.isArray(segments)) return { mentionsBot: false, replyToBot: false };
  return {
    mentionsBot: Boolean(selfId) && segments.some((segment) => segment?.type === 'at' && String(segment.data?.qq ?? '') === String(selfId)),
    replyToBot: segments.some((segment) => segment?.type === 'reply'),
  };
}

function imagesOf(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .filter((segment) => segment?.type === 'image')
    .map((segment) => {
      const raw = String(segment.data?.url ?? '');
      const file = String(segment.data?.file ?? '');
      return { url: raw || (/^https?:\/\//iu.test(file) ? file : ''), mediaType: '' };
    })
    .filter((image) => image.url);
}

export class SnowLumaAdapter extends ChannelAdapter {
  constructor({ config, logger = null }) {
    super({ id: 'snowluma', kind: 'snowluma', logger });
    this.config = config ?? {};
    this.client = null;
  }

  async start() {
    let url = String(this.config.wsUrl ?? '');
    let accessToken = String(this.config.accessToken ?? '');
    const discovered = (!url || !accessToken)
      ? discoverSnowLumaEndpoint({ homeDir: String(this.config.homeDir ?? ''), accessToken, wsUrl: url })
      : null;
    if (discovered) {
      url = discovered.wsUrl;
      accessToken = discovered.accessToken;
      this.logger?.info?.(`[lane-bridge] SnowLuma 端点来自 ${discovered.source}（uin ${discovered.uin}）`);
    }
    url ||= 'ws://127.0.0.1:3001';
    this.started = true;
    this.setStatus({ lastError: '', connected: false });
    try {
      const client = new OneBotWsClient({ url, accessToken, logger: this.logger });
      this.client = client;
      client.on('open', () => {
        this.setStatus({ connected: true, lastError: '' });
        this.logger?.info?.('[lane-bridge] SnowLuma 已连接');
        void client.request('get_login_info', {}, { timeoutMs: 8000 })
          .then((info) => {
            this.setStatus({ selfId: String(info?.user_id ?? ''), nickname: String(info?.nickname ?? '') });
          })
          .catch(() => {});
      });
      client.on('close', (info) => {
        this.setStatus({ connected: false, lastError: info?.reason ? String(info.reason) : '连接已关闭' });
      });
      client.on('error', (error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] SnowLuma 连接错误：${error?.message ?? error}`);
      });
      client.on('event', (event) => {
        if (event?.post_type !== 'message') return;
        const selfId = String(event?.self_id ?? '');
        const senderId = String(event?.sender?.user_id ?? event?.user_id ?? '');
        if (senderId && senderId === selfId) return;
        if (event.message_type === 'private') {
          this.emitMessage({
            kind: 'private',
            externalId: String(event?.user_id ?? ''),
            senderId,
            senderName: String(event?.sender?.card || event?.sender?.nickname || event?.user_id || ''),
            text: segmentsToText(event?.message, event?.raw_message),
            images: imagesOf(event?.message),
            ...mentionsOf(event?.message, event?.self_id || this.state.selfId),
            replyToId: event?.message_id,
            raw: { messageId: event?.message_id, time: event?.time },
          });
        } else if (event.message_type === 'group') {
          this.emitMessage({
            kind: 'group',
            externalId: String(event?.group_id ?? ''),
            senderId,
            senderName: String(event?.sender?.card || event?.sender?.nickname || event?.user_id || ''),
            text: segmentsToText(event?.message, event?.raw_message),
            images: imagesOf(event?.message),
            ...mentionsOf(event?.message, event?.self_id || this.state.selfId),
            replyToId: event?.message_id,
            raw: { messageId: event?.message_id, time: event?.time },
          });
        }
      });
      // Do not await forever: connect() resolves on open or rejects; the client
      // keeps reconnecting in the background after a close.
      void client.connect().catch((error) => {
        this.setError(error);
        this.logger?.warn?.(`[lane-bridge] SnowLuma 连接失败：${error?.message ?? error}`);
      });
    } catch (error) {
      this.setError(error);
      this.logger?.warn?.(`[lane-bridge] SnowLuma 初始化失败：${error?.message ?? error}`);
    }
  }

  async stop() {
    this.started = false;
    try { this.client?.close(); } catch {}
    this.client = null;
    this.setStatus({ connected: false });
  }

  async send(conversation, messages) {
    if (!this.client) throw new Error('SnowLuma 未连接');
    const numericId = Number(conversation.externalId);
    if (!Number.isFinite(numericId)) throw new Error(`非法的 QQ 会话 id：${conversation.externalId}`);
    const results = [];
    for (const message of messages) {
      const text = String(message ?? '').trim();
      if (!text) continue;
      const result = conversation.kind === 'private'
        ? await this.client.request('send_private_msg', { user_id: numericId, message: text, auto_escape: true })
        : await this.client.request('send_group_msg', { group_id: numericId, message: text, auto_escape: true });
      results.push(result);
    }
    return results;
  }
}
