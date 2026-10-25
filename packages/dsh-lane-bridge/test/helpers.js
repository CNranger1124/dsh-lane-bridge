import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

export function tempDir(prefix = 'lane-bridge-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

export function mockResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    end(chunk = '') {
      this.body += String(chunk);
    },
    json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

export function mockRequest({ method = 'GET', url = '/lane-bridge/api/state', body, headers = {} } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1:61158',
    origin: 'http://127.0.0.1:61158',
    'x-lane-bridge': '1',
    ...headers,
  };
  return req;
}

export function fakeChannels() {
  const sent = [];
  return {
    sent,
    status: () => [
      { id: 'snowluma', kind: 'snowluma', label: 'SnowLuma', enabled: true, started: true, connected: false },
    ],
    sync: async () => {},
    sendKey: async (key, messages) => {
      sent.push({ key, messages });
      return messages.map(() => ({ ok: true }));
    },
    adapterFor: () => null,
    stopAll: async () => {},
  };
}
