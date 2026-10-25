import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneStore } from '../lib/store.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRoutes } from '../lib/routes.js';
import { MemoryStore } from '../lib/memory.js';
import { UsageStore } from '../lib/usage.js';
import { defaultState } from '../lib/defaults.js';
import { writeDraft } from '../lib/knowledge.js';
import { tempDir, cleanup, mockRequest, mockResponse, fakeChannels } from './helpers.js';

async function setup({ repo = null, listPresets = null } = {}) {
  const dir = tempDir();
  const store = new LaneStore({ dataDir: dir });
  await store.load();
  const channels = fakeChannels();
  const memoryStore = new MemoryStore({ dir: path.join(dir, 'memories') });
  const usageStore = new UsageStore({ file: path.join(dir, 'usage.jsonl') });
  const pool = {
    reset: async () => {},
    resume: async () => {},
    pause: async () => {},
    escalate: async () => ({ paused: true, notified: true }),
  };
  const routes = createRoutes({ store, channels, pool, memoryStore, usageStore, repo, logger: { warn() {}, info() {}, debug() {} }, listPresets });
  return { dir, store, channels, routes, memoryStore, usageStore };
}

test('health reports the running plugin version', async () => {
  const { dir, routes } = await setup();
  try {
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const res = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/health' }), res);
    assert.equal(res.status, 200);
    assert.equal(res.json().version, pkg.version);
  } finally {
    cleanup(dir);
  }
});

test('presets route exposes host presets with descriptions', async () => {
  const { dir, routes } = await setup({
    listPresets: async () => ([
      { id: 'standard', name: '', description: '', isDefault: true },
      { id: 'lane-support', name: 'IM 聊天客服', description: '客服人格', broken: 'loader failed' },
      { id: '', name: 'ignored' },
    ]),
  });
  try {
    const res = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/presets' }), res);
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.fallback, false);
    assert.deepEqual(body.presets.map((preset) => preset.id), ['standard', 'lane-support']);
    assert.equal(body.presets[0].isDefault, true);
    assert.equal(body.presets[1].name, 'IM 聊天客服');
    assert.equal(body.presets[1].broken, 'loader failed');
  } finally {
    cleanup(dir);
  }
});

test('presets route falls back when the host has no registry', async () => {
  const { dir, routes } = await setup();
  try {
    const res = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/presets' }), res);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().presets, []);
    assert.equal(res.json().fallback, true);
  } finally {
    cleanup(dir);
  }
});

test('state requires the same-origin browser header and redacts secrets', async () => {
  const { dir, store, routes } = await setup();
  try {
    await store.setConfig({ pushToken: 'push-secret', channels: { snowluma: { accessToken: 'ws-secret' } } });
    const forbidden = mockResponse();
    await routes.handle(mockRequest({ headers: { origin: 'http://evil.example' } }), forbidden);
    assert.equal(forbidden.status, 403);

    const ok = mockResponse();
    await routes.handle(mockRequest(), ok);
    assert.equal(ok.status, 200);
    const body = ok.json();
    assert.equal(body.state.config.pushToken, '');
    assert.equal(body.secretStatus.pushToken, true);
    assert.equal(body.state.config.channels.snowluma.accessToken, '');
  } finally {
    cleanup(dir);
  }
});

test('config writes merge and resync channels', async () => {
  const { dir, store, channels, routes } = await setup();
  try {
    let syncs = 0;
    channels.sync = async () => { syncs += 1; };
    const res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/config',
      body: { config: { reply: { maxChars: 900 }, channels: { snowluma: { enabled: false } } } },
    }), res);
    assert.equal(res.status, 200);
    assert.equal(store.get().config.reply.maxChars, 900);
    assert.equal(store.get().config.channels.snowluma.enabled, false);
    assert.equal(syncs, 1);
  } finally {
    cleanup(dir);
  }
});

test('domains and roles validate before writing', async () => {
  const { dir, store, routes } = await setup();
  try {
    const badDomain = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/domains',
      body: { domains: [{ id: 'bad id' }] },
    }), badDomain);
    assert.equal(badDomain.status, 400);

    const goodDomain = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/domains',
      body: { domains: [{ id: 'vip', name: 'VIP', role: '客服', knowledgeScopes: ['default'] }] },
    }), goodDomain);
    assert.equal(goodDomain.status, 200);
    assert.equal(store.get().domains.length, 1);
    assert.equal(store.get().domains[0].id, 'vip');

    const badRole = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/roles',
      body: { roles: [{ name: 'a/b', content: 'x' }] },
    }), badRole);
    assert.equal(badRole.status, 400);
  } finally {
    cleanup(dir);
  }
});

test('operator ids are validated with a readable error', async () => {
  const { dir, store, routes } = await setup();
  try {
    const bad = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/domains',
      body: { domains: [{ id: 'vip', name: 'VIP', role: '客服', operators: ['有 空格'] }] },
    }), bad);
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body).error, /管理者 id 格式不对/u);

    const good = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/domains',
      body: { domains: [{ id: 'vip', name: 'VIP', role: '客服', operators: ['qqbot:8FD96C63', '123456789', '*'] }] },
    }), good);
    assert.equal(good.status, 200);
    assert.deepEqual(store.get().domains[0].operators, ['qqbot:8FD96C63', '123456789', '*']);
  } finally {
    cleanup(dir);
  }
});

test('bindings accept conversation keys and reject unknown domains', async () => {
  const { dir, store, routes } = await setup();
  try {
    const bad = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/bindings',
      body: { bindings: { 'snowluma:group:1': { domainId: 'missing' } } },
    }), bad);
    assert.equal(bad.status, 400);

    const good = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/bindings',
      body: { bindings: { 'snowluma:group:1': { domainId: 'default', enabled: true } } },
    }), good);
    assert.equal(good.status, 200);
    assert.equal(store.get().bindings['snowluma:group:1'].domainId, 'default');
  } finally {
    cleanup(dir);
  }
});

test('push requires a token or browser origin and sends through channels', async () => {
  const { dir, store, channels, routes } = await setup();
  try {
    await store.setConfig({ pushToken: 'tok' });
    const unauthorized = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/push',
      headers: { 'x-lane-bridge': '', origin: 'http://evil.example' },
      body: { target: 'snowluma:group:1', messages: 'hi' },
    }), unauthorized);
    assert.equal(unauthorized.status, 401);

    const external = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/push',
      headers: { 'x-lane-bridge': '', origin: '', authorization: 'Bearer tok' },
      body: { target: 'snowluma:group:1', messages: ['line one', 'line two'] },
    }), external);
    assert.equal(external.status, 200);
    assert.equal(channels.sent.length, 1);
    assert.deepEqual(channels.sent[0].messages, ['line one', 'line two']);

    const browser = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/push',
      body: { target: 'snowluma:group:1', messages: 'browser' },
    }), browser);
    assert.equal(browser.status, 200);
    assert.equal(channels.sent.length, 2);
  } finally {
    cleanup(dir);
  }
});

test('push accepts several targets and reports per-target results', async () => {
  const { dir, channels, routes } = await setup();
  try {
    channels.sendKey = async (key, messages) => {
      if (key === 'snowluma:group:2') throw new Error('channel offline');
      channels.sent.push({ key, messages });
      return messages.map(() => ({ ok: true }));
    };
    const res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/push',
      body: { targets: ['snowluma:group:1', 'snowluma:group:2', 'snowluma:group:1'], messages: '公告' },
    }), res);
    assert.equal(res.status, 207);
    const body = res.json();
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[1].ok, false);
    assert.match(body.results[1].error, /offline/);
    // 207 alone is useless in the UI: the response carries the reason too.
    assert.match(body.error, /1\/2 个会话发送失败/u);
    assert.match(body.error, /snowluma:group:2：channel offline/u);
    assert.equal(channels.sent.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('knowledge routes list and write documents', async () => {
  const { dir, routes } = await setup();
  try {
    const list = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/knowledge' }), list);
    assert.equal(list.status, 200);
    assert.ok(list.json().files.length >= 1);

    const write = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { scope: 'default', path: '新文档.md', content: '# hi' },
    }), write);
    assert.equal(write.status, 200);
    assert.equal(write.json().path, '新文档.md');

    const read = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/knowledge/read?scope=default&path=' + encodeURIComponent('新文档.md') }), read);
    assert.equal(read.status, 200);
    assert.match(read.json().content, /# hi/);

    // Per-document triggers travel with the document, as frontmatter.
    const withMeta = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { scope: 'default', path: '存档.md', content: '# 存档\n\n在 saves。\n', meta: { title: '存档', triggers: [' 存档 ', '存档', 'save'], always: true } },
    }), withMeta);
    assert.equal(withMeta.status, 200);
    const again = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/knowledge/read?scope=default&path=' + encodeURIComponent('存档.md') }), again);
    assert.equal(again.status, 200);
    assert.deepEqual(again.json().meta, { title: '存档', triggers: ['存档', 'save'], domains: [], always: true });
    assert.doesNotMatch(again.json().content, /^---/u);

    const listed = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/knowledge' }), listed);
    const row = listed.json().files.find((file) => file.path === '存档.md');
    assert.deepEqual(row.triggers, ['存档', 'save']);
    assert.equal(row.always, true);
  } finally {
    cleanup(dir);
  }
});

test('knowledge draft routes list, approve, and discard', async () => {
  const { dir, store, routes } = await setup();
  try {
    const draft = writeDraft(store.paths.knowledgeDir, 'default', {
      title: '测试草稿',
      content: '这是一条测试草稿内容。',
      source: 'issue #1',
      triggers: ['测试草稿', '草稿'],
    });
    const list = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/kb/drafts' }), list);
    assert.equal(list.status, 200);
    const listed = list.json().drafts.find((item) => item.file === draft.file);
    assert.ok(listed);
    assert.deepEqual(listed.triggers, ['测试草稿', '草稿']);

    // Approval creates a standalone document in that knowledge base, keywords
    // included, so trigger-based retrieval can find it afterwards.
    const approve = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/kb/drafts',
      body: { action: 'approve', scope: 'default', file: draft.file, triggers: ['测试草稿', '测试用词'] },
    }), approve);
    assert.equal(approve.status, 200);
    assert.equal(approve.json().ok, true);
    assert.equal(approve.json().path, '测试草稿.md');
    assert.deepEqual(approve.json().triggers, ['测试草稿', '测试用词']);
    assert.match(fs.readFileSync(path.join(store.paths.knowledgeDir, 'default', '测试草稿.md'), 'utf8'), /triggers: 测试草稿, 测试用词/);

    const second = writeDraft(store.paths.knowledgeDir, 'default', {
      title: '要丢弃',
      content: '这条草稿只是用来测试丢弃流程的内容。',
      source: '群反馈',
      triggers: ['要丢弃'],
    });
    const discard = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/kb/drafts',
      body: { action: 'discard', scope: 'default', file: second.file },
    }), discard);
    assert.equal(discard.status, 200);
  } finally {
    cleanup(dir);
  }
});

test('github routes expose repo/branch dropdown data', async () => {
  const repo = {
    authStatus: async () => ({ authenticated: true, source: 'gh-cli', account: 'me' }),
    listRepos: async () => ({ source: 'gh-cli', repos: [{ repo: 'owner/repo', private: false, defaultBranch: 'main' }] }),
    listBranches: async ({ repo: name }) => ({ repo: name, branches: ['main', 'dev'] }),
  };
  const { dir, routes } = await setup({ repo });
  try {
    const repos = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/github/repos' }), repos);
    assert.equal(repos.status, 200);
    assert.equal(repos.json().repos[0].repo, 'owner/repo');

    const branches = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/github/branches?repo=owner/repo' }), branches);
    assert.deepEqual(branches.json().branches, ['main', 'dev']);
  } finally {
    cleanup(dir);
  }
});

test('unknown routes return 404 JSON', async () => {
  const { dir, routes } = await setup();
  try {
    const res = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/nope' }), res);
    assert.equal(res.status, 404);
    assert.equal(res.json().ok, false);
  } finally {
    cleanup(dir);
  }
});


test('memory routes read, replace, and clear a domain memory', async () => {
  const { dir, routes, store } = await setup();
  try {
    const domainId = store.get().domains[0].id;
    const empty = mockResponse();
    await routes.handle(mockRequest({ url: `/lane-bridge/api/memory?domain=${domainId}` }), empty);
    assert.equal(empty.status, 200);
    assert.equal(empty.json().count, 0);

    const save = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/memory',
      body: { domainId, text: ['- 记忆一', '- 记忆二'].join(String.fromCharCode(10)) },
    }), save);
    assert.equal(save.status, 200);
    assert.equal(save.json().count, 2);

    const read = mockResponse();
    await routes.handle(mockRequest({ url: `/lane-bridge/api/memory?domain=${domainId}` }), read);
    assert.equal(read.status, 200);
    assert.match(read.json().text, /记忆一/);

    const clear = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/memory',
      body: { domainId, action: 'clear' },
    }), clear);
    assert.equal(clear.status, 200);
    assert.equal(clear.json().count, 0);
  } finally {
    cleanup(dir);
  }
});


test('handoff routes pause, escalate, and resume a conversation', async () => {
  const { dir, routes, store } = await setup();
  try {
    await store.setBindings({ 'snowluma:group:1': { domainId: 'default', enabled: true } });
    for (const action of ['escalate', 'resume', 'pause']) {
      const res = mockResponse();
      await routes.handle(mockRequest({
        method: 'POST',
        url: '/lane-bridge/api/handoff',
        body: { key: 'snowluma:group:1', action },
      }), res);
      assert.equal(res.status, 200, action);
      assert.equal(res.json().ok, true, action);
    }
  } finally {
    cleanup(dir);
  }
});


test('usage route reads and clears the local ledger', async () => {
  const { dir, routes, usageStore } = await setup();
  try {
    usageStore.record({ key: 'snowluma:group:1', usage: { inputTokens: 10, outputTokens: 2 } });
    const read = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/usage' }), read);
    assert.equal(read.status, 200);
    assert.equal(read.json().total.turns, 1);
    const clear = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/usage', body: {} }), clear);
    assert.equal(clear.status, 200);
    assert.equal(clear.json().total.turns, 0);
  } finally {
    cleanup(dir);
  }
});

test('knowledge bases are created, renamed, and unbound from domains', async () => {
  const { dir, store, routes } = await setup();
  const fs = await import('node:fs');
  try {
    let res = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/kb', body: { action: 'create', name: '宝具' } }), res);
    assert.equal(res.status, 200, res.body);
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', '宝具')));
    assert.ok(store.get().knowledgeBases.some((kb) => kb.id === '宝具'));

    // Bind the new base to the default domain.
    res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/domains',
      body: { domains: [{ ...store.get().domains[0], knowledgeScopes: ['宝具'] }] },
    }), res);
    assert.equal(res.status, 200, res.body);

    // Renaming moves the directory and repoints every domain that bound it.
    fs.writeFileSync(path.join(dir, 'knowledge', '宝具', '机制.md'), '# 宝具\n', 'utf8');
    res = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/kb', body: { action: 'rename', id: '宝具', name: '宝具资料' } }), res);
    assert.equal(res.status, 200, res.body);
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', '宝具资料', '机制.md')));
    assert.deepEqual(store.get().domains[0].knowledgeScopes, ['宝具资料']);

    // A non-empty base is not deleted by accident.
    res = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/kb', body: { action: 'delete', id: '宝具资料' } }), res);
    assert.equal(res.status, 400);
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', '宝具资料')));

    res = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/kb', body: { action: 'delete', id: '宝具资料', force: true } }), res);
    assert.equal(res.status, 200, res.body);
    assert.ok(!fs.existsSync(path.join(dir, 'knowledge', '宝具资料')));
    assert.deepEqual(store.get().domains[0].knowledgeScopes, [], 'deleting a base unbinds it');
    assert.ok(!store.get().knowledgeBases.some((kb) => kb.id === '宝具资料'));

    // The state payload carries the registry so the UI can offer a dropdown.
    res = mockResponse();
    await routes.handle(mockRequest({ url: '/lane-bridge/api/state' }), res);
    assert.ok(Array.isArray(res.json().state.knowledgeBases));
  } finally {
    cleanup(dir);
  }
});

test('the knowledge route renames and transfers documents', async () => {
  const { dir, routes } = await setup();
  const fs = await import('node:fs');
  try {
    // Create a second knowledge base to move into.
    let res = mockResponse();
    await routes.handle(mockRequest({ method: 'POST', url: '/lane-bridge/api/kb', body: { action: 'create', name: '存档' } }), res);
    assert.equal(res.status, 200, res.body);

    res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { scope: 'default', path: '知识库.md', content: '# 知识库\n\n正文\n', meta: { title: '知识库', triggers: ['存档'], always: false } },
    }), res);
    assert.equal(res.status, 200, res.body);

    // Rename in place, then transfer to the other base.
    res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { action: 'move', scope: 'default', path: '知识库.md', targetScope: 'default', targetPath: '客服知识.md' },
    }), res);
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json().path, '客服知识.md');
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', 'default', '客服知识.md')));

    res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { action: 'move', scope: 'default', path: '客服知识.md', targetScope: '存档', targetPath: '存档位置.md' },
    }), res);
    assert.equal(res.status, 200, res.body);
    assert.deepEqual(res.json().scope, '存档');
    assert.ok(fs.existsSync(path.join(dir, 'knowledge', '存档', '存档位置.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'knowledge', 'default', '客服知识.md')));

    // Moving onto an existing document is refused with a readable reason.
    fs.writeFileSync(path.join(dir, 'knowledge', '存档', '占位.md'), '# 占位\n', 'utf8');
    res = mockResponse();
    await routes.handle(mockRequest({
      method: 'POST',
      url: '/lane-bridge/api/knowledge',
      body: { action: 'move', scope: '存档', path: '存档位置.md', targetScope: '存档', targetPath: '占位.md' },
    }), res);
    assert.equal(res.status, 400);
    assert.match(res.json().error, /目标已存在/u);
  } finally {
    cleanup(dir);
  }
});
