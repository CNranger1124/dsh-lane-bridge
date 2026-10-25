import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { discoverSnowLumaEndpoint } from '../lib/channels/snowluma-discovery.js';
import { tempDir, cleanup } from './helpers.js';

test('discovers the WS token from SnowLuma per-account config', () => {
  const home = tempDir();
  try {
    fs.mkdirSync(path.join(home, 'config'), { recursive: true });
    fs.writeFileSync(path.join(home, 'config', 'onebot_12345.json'), JSON.stringify({
      networks: {
        wsServers: [{ host: '127.0.0.1', port: 3001, accessToken: 'ws-token' }],
        httpServers: [{ host: '127.0.0.1', port: 3000, accessToken: 'http-token' }],
      },
    }));
    const found = discoverSnowLumaEndpoint({ homeDir: home });
    assert.equal(found.wsUrl, 'ws://127.0.0.1:3001');
    assert.equal(found.accessToken, 'ws-token');
    assert.equal(found.uin, '12345');
    assert.match(found.source, /onebot_12345\.json/u);
  } finally {
    cleanup(home);
  }
});

test('explicit settings win over discovery, and an empty home returns null', () => {
  const home = tempDir();
  try {
    assert.equal(discoverSnowLumaEndpoint({ homeDir: home }), null);
    fs.mkdirSync(path.join(home, 'config'), { recursive: true });
    fs.writeFileSync(path.join(home, 'config', 'onebot_1.json'), JSON.stringify({
      networks: { wsServers: [{ host: '10.0.0.1', port: 3001, accessToken: 'discovered' }] },
    }));
    const found = discoverSnowLumaEndpoint({
      homeDir: home,
      wsUrl: 'ws://127.0.0.1:9999',
      accessToken: 'explicit',
    });
    assert.equal(found.wsUrl, 'ws://127.0.0.1:9999');
    assert.equal(found.accessToken, 'explicit');
  } finally {
    cleanup(home);
  }
});
