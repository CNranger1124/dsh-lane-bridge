// Minimal OneBot v11 WebSocket client.
//
// The legacy qq-bridge used @snowluma/sdk, whose published ESM bundle needs a
// postinstall patch (relative imports without .js). For a plugin that should
// install with one command we keep the transport in-tree: JSON action frames,
// echo correlation, reconnect, and the subset of events dsh-lane-bridge needs.
const OPEN = 1;

function withToken(url, token) {
  if (!token) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('access_token', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

export class OneBotWsClient {
  constructor({ url, accessToken = '', logger = null, reconnect = true }) {
    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error('当前 Node 运行时不提供 WebSocket（需要 Node 22+）');
    }
    this.url = String(url || 'ws://127.0.0.1:3001');
    this.accessToken = String(accessToken || '');
    this.logger = logger;
    this.reconnect = reconnect !== false;
    this.socket = null;
    this.opened = false;
    this.closedByUser = false;
    this.pending = new Map();
    this.echo = 0;
    this.retry = 0;
    this.retryTimer = null;
    this.connectPromise = null;
    this.handlers = { open: [], close: [], error: [], event: [] };
  }

  on(event, handler) {
    (this.handlers[event] ??= []).push(handler);
    return () => {
      this.handlers[event] = (this.handlers[event] ?? []).filter((item) => item !== handler);
    };
  }

  emit(event, payload) {
    for (const handler of this.handlers[event] ?? []) {
      try { handler(payload); } catch (error) {
        this.logger?.warn?.(`[lane-bridge] OneBot 事件处理失败：${error?.message ?? error}`);
      }
    }
  }

  connect() {
    if (this.opened) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.closedByUser = false;
    const url = withToken(this.url, this.accessToken);
    this.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = new globalThis.WebSocket(url);
      } catch (error) {
        reject(error);
        return;
      }
      this.socket = socket;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch {}
        reject(new Error('连接 OneBot WebSocket 超时'));
      }, 10000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      socket.addEventListener('open', () => {
        this.opened = true;
        this.retry = 0;
        this.emit('open');
        finish();
      });
      socket.addEventListener('error', (event) => {
        this.emit('error', event?.error ?? new Error('OneBot WebSocket error'));
        finish(new Error('OneBot WebSocket 连接失败'));
      });
      socket.addEventListener('close', (event) => {
        this.opened = false;
        this.socket = null;
        this.rejectPending(new Error('OneBot WebSocket 已关闭'));
        this.emit('close', { code: event?.code, reason: event?.reason });
        finish(new Error('OneBot WebSocket 在连接建立前关闭'));
        this.scheduleReconnect();
      });
      socket.addEventListener('message', (event) => {
        this.handleMessage(event?.data);
      });
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  scheduleReconnect() {
    if (!this.reconnect || this.closedByUser || this.retryTimer) return;
    this.retry += 1;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.retry, 6));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closedByUser) return;
      this.connect().catch((error) => {
        this.logger?.warn?.(`[lane-bridge] OneBot 重连失败：${error?.message ?? error}`);
      });
    }, delay);
  }

  handleMessage(data) {
    let frame;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    if (frame.echo !== undefined && this.pending.has(String(frame.echo))) {
      const entry = this.pending.get(String(frame.echo));
      this.pending.delete(String(frame.echo));
      clearTimeout(entry.timer);
      if (frame.status === 'failed' || (frame.retcode !== undefined && frame.retcode !== 0)) {
        entry.reject(new Error(frame.wording || frame.message || `OneBot ${frame.retcode ?? 'failed'}`));
      } else {
        entry.resolve(frame.data);
      }
      return;
    }
    if (frame.post_type) this.emit('event', frame);
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  async request(action, params = {}, { timeoutMs = 30_000 } = {}) {
    if (!this.opened) await this.connect();
    const echo = `lane-${++this.echo}`;
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) throw new Error('OneBot WebSocket 未连接');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot ${action} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(echo, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ action, params, echo }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(error);
      }
    });
  }

  close() {
    this.closedByUser = true;
    this.reconnect = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.rejectPending(new Error('OneBot 客户端已关闭'));
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.opened = false;
  }
}
