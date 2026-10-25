import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImage, isPrivateAddress } from '../lib/media.js';

test('isPrivateAddress blocks loopback/private/mapped ranges', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.1.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('fetchImage returns base64 for a public image', async () => {
  const result = await fetchImage('https://cdn.example.com/a.png', {
    lookupImpl: async () => [{ address: '8.8.8.8' }],
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: (name) => name === 'content-type' ? 'image/png' : '3' },
      arrayBuffer: async () => Buffer.from('png-bytes'),
    }),
  });
  assert.equal(result.mediaType, 'image/png');
  assert.equal(result.bytes, 9);
  assert.equal(result.base64, Buffer.from('png-bytes').toString('base64'));
});

test('fetchImage rejects private destinations and non-image content', async () => {
  await assert.rejects(() => fetchImage('http://127.0.0.1/a.png'), /本机|局域网/u);
  await assert.rejects(() => fetchImage('https://cdn.example.com/a', {
    lookupImpl: async () => [{ address: '10.0.0.2' }],
    fetchImpl: async () => { throw new Error('should not fetch'); },
  }), /局域网/u);
  await assert.rejects(() => fetchImage('https://cdn.example.com/a', {
    lookupImpl: async () => [{ address: '8.8.8.8' }],
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: (name) => name === 'content-type' ? 'text/html' : '3' },
      arrayBuffer: async () => Buffer.from('html'),
    }),
  }), /不是图片/u);
});

test('fetchImage rejects oversized bodies and redirects to private hosts', async () => {
  await assert.rejects(() => fetchImage('https://cdn.example.com/a.png', {
    maxBytes: 3,
    lookupImpl: async () => [{ address: '8.8.8.8' }],
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: (name) => name === 'content-type' ? 'image/png' : name === 'content-length' ? '10' : null },
      arrayBuffer: async () => Buffer.from('1234567890'),
    }),
  }), /过大/u);

  await assert.rejects(() => fetchImage('https://cdn.example.com/a.png', {
    lookupImpl: async () => [{ address: '8.8.8.8' }],
    fetchImpl: async () => ({
      status: 302,
      headers: { get: (name) => name === 'location' ? 'http://127.0.0.1/evil.png' : null },
      arrayBuffer: async () => Buffer.from(''),
    }),
  }), /本机|局域网/u);
});
