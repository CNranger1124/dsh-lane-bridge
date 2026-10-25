// Channel adapter contract.
//
// Adapters own transport only. They normalize inbound messages into the shape
// below and never touch DSH sessions, domains, or the store.
import { EventEmitter } from 'node:events';

/**
 * @typedef {object} InboundMessage
 * @property {string} channel
 * @property {'group'|'private'} kind
 * @property {string} externalId
 * @property {string} [senderId]
 * @property {string} [senderName]
 * @property {string} text
 * @property {Array<{url?: string, path?: string, mediaType?: string}>} [images]
 * @property {string} [replyToId]
 * @property {any} [raw]
 */

export class ChannelAdapter extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id
   * @param {string} options.kind
   * @param {object} [options.logger]
   */
  constructor({ id, kind, logger = null }) {
    super();
    this.id = id;
    this.kind = kind;
    this.logger = logger;
    this.started = false;
    this.state = {
      connected: false,
      selfId: '',
      nickname: '',
      lastError: '',
      lastEventAt: 0,
    };
  }

  status() {
    return { id: this.id, kind: this.kind, started: this.started, ...this.state };
  }

  setStatus(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.status());
  }

  setError(error) {
    this.setStatus({ lastError: String(error?.message ?? error ?? '').slice(0, 300), connected: false });
  }

  emitMessage(message) {
    this.state.lastEventAt = Date.now();
    this.emit('message', {
      channel: this.id,
      kind: message.kind === 'private' ? 'private' : 'group',
      externalId: String(message.externalId ?? ''),
      senderId: String(message.senderId ?? ''),
      senderName: String(message.senderName ?? ''),
      text: String(message.text ?? '').trim(),
      images: Array.isArray(message.images) ? message.images : [],
      replyToId: message.replyToId ? String(message.replyToId) : undefined,
      mentionsBot: message.mentionsBot === true,
      replyToBot: message.replyToBot === true,
      raw: message.raw,
    });
  }

  async start() {
    throw new Error(`${this.kind} adapter does not implement start()`);
  }

  async stop() {
    this.started = false;
    this.setStatus({ connected: false });
  }

  async send(_conversation, _messages) {
    throw new Error(`${this.kind} adapter does not implement send()`);
  }
}
