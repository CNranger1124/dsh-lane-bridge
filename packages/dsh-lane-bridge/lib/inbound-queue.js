// Debounce/merge inbound chat messages per conversation.
//
// People type in bursts: "在吗" / "问个问题" / "存档在哪". Prompting the model
// once with the burst is cheaper and produces a much better reply than three
// independent turns. The queue is intentionally tiny and dependency-free so the
// behavior is testable without DSH.
export function mergeInboundMessages(messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (list.length === 0) return null;
  const last = list[list.length - 1];
  const text = list.map((message) => String(message.text ?? '').trim()).filter(Boolean).join('\n');
  return {
    ...last,
    text,
    images: list.flatMap((message) => Array.isArray(message.images) ? message.images : []),
    mentionsBot: list.some((message) => message.mentionsBot === true),
    replyToBot: list.some((message) => message.replyToBot === true),
    replyToId: last.replyToId,
    raw: last.raw,
  };
}

export class InboundQueue {
  /**
   * @param {object} options
   * @param {number} options.delayMs
   * @param {number} [options.maxWaitMs]
   * @param {(key: string, message: object) => Promise<void>} options.onFlush
   * @param {object} [options.logger]
   */
  constructor({ delayMs = 800, maxWaitMs = 5000, onFlush, logger = null }) {
    this.delayOf = typeof delayMs === 'function' ? delayMs : () => delayMs;
    this.delayMs = Math.max(0, Number(typeof delayMs === 'function' ? delayMs() : delayMs) || 0);
    this.maxWaitMs = Math.max(this.delayMs, Number(maxWaitMs) || 5000);
    this.onFlush = onFlush;
    this.logger = logger;
    this.entries = new Map(); // key -> { messages, firstAt, timer }
    this.stopped = false;
  }

  get size() {
    return this.entries.size;
  }

  push(key, message) {
    if (this.stopped || !message) return;
    const configured = Math.max(0, Number(this.delayOf()) || 0);
    if (configured === 0) {
      void this.#flush(key, [message]);
      return;
    }
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { messages: [], firstAt: now, timer: null };
      this.entries.set(key, entry);
    }
    entry.messages.push(message);
    if (entry.timer) clearTimeout(entry.timer);
    const elapsed = now - entry.firstAt;
    const delay = Math.min(configured, Math.max(0, this.maxWaitMs - elapsed));
    entry.timer = setTimeout(() => {
      const current = this.entries.get(key);
      if (!current) return;
      this.entries.delete(key);
      void this.#flush(key, current.messages);
    }, delay);
    entry.timer.unref?.();
  }

  async #flush(key, messages) {
    const merged = mergeInboundMessages(messages);
    if (!merged) return;
    try {
      await this.onFlush(key, merged);
    } catch (error) {
      this.logger?.warn?.(`[lane-bridge] ${key} 合并消息处理失败：${error?.message ?? error}`);
    }
  }

  /** Flush one key immediately (used by tests and by shutdown/shutdown-like paths). */
  async flush(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    await this.#flush(key, entry.messages);
  }

  stop() {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}
