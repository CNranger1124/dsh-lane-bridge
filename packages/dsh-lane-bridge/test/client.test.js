import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOperators } from '../lib/defaults.js';

function traverse(node, visit) {
  if (node == null || node === false) return;
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ children: node });
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) traverse(child, visit);
    return;
  }
  if (typeof node === 'object') {
    visit(node);
    if (node.children) traverse(node.children, visit);
  }
}

test('client bundle registers settings section and sidebar tab, then cleans up', async () => {
  const injected = [];
  const sections = [];
  const tabs = [];
  let disposed = 0;
  const react = {
    createElement() { return {}; },
    useState() { return [undefined, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class {},
  };
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'dsh-lane-bridge');
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?registration');
  const bundle = globalThis.__laneBundle;
  assert.equal(bundle.name, 'dsh-lane-bridge-client');
  assert.deepEqual(bundle.inject, ['slots', 'sidebarRightTabs']);
  let cleanup = null;
  const ctx = {
    slots: {
      inject(name, register) {
        injected.push(name);
        sections.push(register());
        return () => { disposed += 1; };
      },
      register(options) {
        assert.ok(['settings.section', 'sidebar.right.pane.tab'].includes(options.name));
        return () => { disposed += 1; };
      },
    },
    sidebarRightTabs: {
      register(options) {
        tabs.push(options);
        return () => { disposed += 1; };
      },
    },
    effect(fn) {
      cleanup = fn();
    },
  };
  bundle.apply(ctx);
  assert.deepEqual(injected, ['settings.section', 'sidebar.right.pane.tab']);
  assert.equal(sections.length, 2);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].id, 'lane-bridge/sidebar');
  assert.equal(tabs[0].kind, 'lane-bridge-panel');
  assert.equal(tabs[0].title(), 'IM 桥接');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.ok(disposed >= 3);
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
});

test('cards render a collapsible header with an explicit toggle', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) { return { type, props, children }; },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class {},
  };
  globalThis.document = { getElementById: () => ({ remove() {} }), createElement: () => ({}), head: { appendChild() {} } };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?card');
  const { Card } = globalThis.__laneBundle.__components;
  const tree = Card({ title: '官方 QQ Bot', extra: { type: 'button' } });
  const nodes = [];
  traverse(tree, (node) => nodes.push(node));
  const head = nodes.find((node) => node?.props?.role === 'button');
  assert.equal(head.props['aria-expanded'], true);
  const text = [];
  traverse(tree, (node) => { if (typeof node?.children === 'string') text.push(node.children); });
  assert.ok(text.includes('官方 QQ Bot'));
  assert.ok(text.includes('▾'));
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('domain cards expose a save button in the header and footer', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class { constructor(props) { this.props = props; this.state = {}; } setState() {} },
  };
  globalThis.document = { getElementById: () => ({ remove() {} }), createElement: () => ({}), head: { appendChild() {} } };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?domains');
  const { Domains } = globalThis.__laneBundle.__components;
  const data = {
    state: {
      config: { defaultDomainId: 'default', github: { repo: 'owner/repo' } },
      domains: [{
        id: 'default', name: '默认客服', role: '客服', preset: 'lane-support', model: '',
        knowledgeScopes: ['default', 'game'], allowedHostTools: ['web_search'], autoReply: true, trigger: 'all',
        keywords: ['存档', '闪退'],
        operators: ['qqbot:8FD96C63', 'discord:99001'],
        memoryEnabled: false, memoryMaxChars: 2000, kbDraftEnabled: true,
        repoEnabled: true, repo: '', branch: '', systemPrompt: '', maxReplyChars: 0,
      }],
      roles: [{ name: '客服', content: '' }],
    },
  };
  const tree = Domains({ data, refresh: async () => {} });
  const text = [];
  const inputs = [];
  const selects = [];
  traverse(tree, (node) => {
    if (typeof node?.children === 'string') text.push(node.children);
    if (node?.type === 'input') inputs.push(node.props ?? {});
    if (node?.type === 'select') selects.push(node.props ?? {});
  });
  assert.ok(text.filter((line) => line === '保存领域').length >= 2, text.join(' '));
  // The group trigger is a multi-select: all four policies render as checkboxes.
  const triggerLabels = ['所有消息', '@ 或回复机器人', '命中关键词', '关闭（只记录）'];
  assert.deepEqual(triggerLabels.filter((label) => text.includes(label)), triggerLabels);
  assert.ok(text.some((line) => line.includes('可多选')), text.join(' '));
  // The operator whitelist lives on the same card and documents the id format.
  assert.ok(text.includes('管理者（白名单）'), text.join(' '));
  assert.ok(text.some((line) => line.includes('openid') && line.includes('QQ 号')), text.join(' '));
  assert.ok(text.some((line) => line.includes('所有人都是管理员')), text.join(' '));
  // The domain prompt field documents the identity template syntax.
  assert.ok(text.some((line) => line.includes('{{#if operator}}')), text.join(' '));
  // Context budget + retrieval controls live on the same card.
  for (const label of ['会话归档轮数', '知识库自动检索', '检索片段上限', '记忆注入上限']) {
    assert.ok(text.includes(label), `missing ${label}`);
  }

  // Multi-value fields are chip lists, not comma-joined text boxes: every stored
  // value appears as its own chip and no input carries a "a, b" string.
  for (const value of ['存档', '闪退', 'web_search', 'default', 'game']) {
    assert.ok(text.includes(value), `missing chip for ${value}: ${text.join(' ')}`);
  }
  assert.ok(!inputs.some((props) => String(props.value ?? '').includes(', ')), 'a comma-joined field is still rendered');

  // The operator whitelist is a channel dropdown + id input per row, so the
  // "channel:id" prefix is never typed by hand.
  assert.ok(text.includes('官方 QQ Bot') && text.includes('SnowLuma（OneBot）') && text.includes('Discord'), text.join(' '));
  assert.ok(selects.some((props) => props.value === 'qqbot'), 'operator channel select missing');
  assert.ok(selects.some((props) => props.value === 'discord'), 'operator channel select missing for discord row');
  assert.ok(inputs.some((props) => props.value === '8FD96C63'), 'operator id input missing');
  assert.ok(!inputs.some((props) => String(props.value ?? '').startsWith('qqbot:')), 'operator id must not include the channel prefix');
  // Remove buttons exist per chip / per operator row.
  assert.ok(text.filter((line) => line === '×').length >= 5, 'chip remove buttons missing');
  assert.ok(text.filter((line) => line === '−').length >= 2, 'operator remove buttons missing');
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('empty conversation list renders a placeholder instead of throwing', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState() {}
    },
  };
  globalThis.document = {
    getElementById: () => ({ remove() {} }),
    createElement: () => ({}),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?render');
  const { Conversations } = globalThis.__laneBundle.__components;
  const data = {
    state: {
      config: { defaultDomainId: 'default' },
      domains: [{ id: 'default', name: '默认客服' }],
      roles: [{ name: '客服', content: '' }],
      conversations: {},
      bindings: {},
    },
    paths: { dataDir: '/tmp/lane-bridge' },
  };
  let tree;
  assert.doesNotThrow(() => { tree = Conversations({ data, refresh: async () => {} }); });
  const text = [];
  traverse(tree, (node) => {
    if (typeof node?.children === 'string') text.push(node.children);
    if (typeof node?.children === 'number') text.push(String(node.children));
  });
  assert.ok(text.some((line) => line.includes('还没有收到过消息')), text.join(' '));
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('conversations surface sender ids that can be pasted into the whitelist', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState() {}
    },
  };
  globalThis.document = {
    getElementById: () => ({ remove() {} }),
    createElement: () => ({}),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?senders');
  const { Conversations } = globalThis.__laneBundle.__components;
  const data = {
    state: {
      config: { defaultDomainId: 'default' },
      domains: [{ id: 'default', name: '默认客服' }],
      roles: [{ name: '客服', content: '', domainId: 'default' }],
      conversations: {
        'qqbot:group:F84F': {
          key: 'qqbot:group:F84F', channel: 'qqbot', kind: 'group', externalId: 'F84F',
          name: '群 F84F（RANGER）', lastAt: 1, lastText: '宝具机制', seenCount: 2,
          senders: { 'qqbot:8FD96C63': { name: 'RANGER', at: 2 } },
        },
      },
      bindings: { 'qqbot:group:F84F': { domainId: 'default', enabled: true } },
      sessions: {},
    },
    paths: { dataDir: '/tmp/lane-bridge' },
  };
  const tree = Conversations({ data, refresh: async () => {} });
  const text = [];
  const headers = [];
  traverse(tree, (node) => {
    if (typeof node?.children === 'string') text.push(node.children);
    if (node?.type === 'th' && typeof node.children?.[0] === 'string') headers.push(node.children[0]);
  });
  assert.ok(text.some((line) => line.includes('最近发言者')), text.join(' '));
  assert.ok(text.some((line) => line.includes('RANGER') && line.includes('qqbot:8FD96C63')), text.join(' '));
  // Conversation → role → domain: the table offers a role, not a domain.
  assert.ok(headers.includes('角色卡'), headers.join(' '));
  assert.ok(!headers.includes('领域'), 'the conversation table must not ask for a domain');
  assert.ok(text.some((line) => line.includes('客服 · 默认客服')), 'role options should show the domain they pull in');
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('the roles card binds a role to a domain', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class {
      constructor(props) { this.props = props; this.state = {}; }
      setState() {}
    },
  };
  globalThis.document = {
    getElementById: () => ({ remove() {} }),
    createElement: () => ({}),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?roles');
  const { RolesAndKnowledge } = globalThis.__laneBundle.__components;
  const data = {
    state: {
      config: { defaultDomainId: 'default' },
      domains: [{ id: 'default', name: '默认客服' }, { id: 'game', name: '游戏客服' }],
      roles: [{ name: '客服', content: '# A', domainId: 'game' }],
      conversations: {},
      bindings: {},
      sessions: {},
    },
    paths: { dataDir: '/tmp/lane-bridge' },
  };
  const tree = RolesAndKnowledge({ data, refresh: async () => {} });
  const text = [];
  const selects = [];
  traverse(tree, (node) => {
    if (typeof node?.children === 'string') text.push(node.children);
    if (node?.type === 'select') selects.push(node.props ?? {});
  });
  assert.ok(text.includes('所属领域'), text.join(' '));
  assert.ok(selects.some((props) => props.value === 'game'), 'the role must show its domain');
  // The role card no longer picks a domain on the domain side.
  assert.ok(!text.some((line) => line === '角色卡'), 'the domain card must not name a role');
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('operator rows round-trip through the channel dropdown without losing the id', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class { constructor(props) { this.props = props; this.state = {}; } setState() {} },
  };
  globalThis.document = { getElementById: () => ({ remove() {} }), createElement: () => ({}), head: { appendChild() {} } };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?operators');
  const { splitOperatorEntry, joinOperatorEntry, normalizeOperatorInput } = globalThis.__laneBundle.__internals;

  assert.deepEqual(splitOperatorEntry('qqbot:8FD96C63'), { channel: 'qqbot', id: '8FD96C63' });
  assert.deepEqual(splitOperatorEntry('123456789'), { channel: '', id: '123456789' });
  assert.deepEqual(splitOperatorEntry('*'), { channel: '', id: '' });
  // A value with a channel keeps it across an edit of just the id.
  assert.equal(joinOperatorEntry('discord', '99001'), 'discord:99001');
  assert.equal(joinOperatorEntry('', '99001'), '99001');
  // Hand-typed noise (spaces, a stray colon) cannot produce an invalid entry.
  assert.equal(joinOperatorEntry('qqbot', ' 8FD9 6C63 '), 'qqbot:8FD96C63');
  assert.equal(joinOperatorEntry('qqbot', '8FD9:6C63'), 'qqbot:8FD96C63');
  assert.equal(joinOperatorEntry('qqbot', ''), '');
  // Pasting what the "recent senders" column copies must not double the prefix.
  assert.deepEqual(normalizeOperatorInput('qqbot', 'snowluma:123456789'), { channel: 'snowluma', id: '123456789' });
  assert.deepEqual(normalizeOperatorInput('discord', ' 8FD96C63 '), { channel: 'discord', id: '8FD96C63' });
  assert.equal(joinOperatorEntry(...Object.values(normalizeOperatorInput('qqbot', 'qqbot:8FD96C63'))), 'qqbot:8FD96C63');
  // Everything the editor can produce is accepted by the server-side whitelist.
  for (const value of ['qqbot:8FD96C63', 'snowluma:123456789', 'discord:99001', '99001']) {
    assert.equal(normalizeOperators([value]).length, 1, value);
  }
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});

test('push renders a checkbox per discovered conversation instead of one select', async () => {
  globalThis.__LANE_TEST__ = true;
  const react = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') {
        if (type.prototype?.render) return new type(props).render();
        return type({ ...(props ?? {}), children });
      }
      return { type, props, children };
    },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    Component: class { constructor(props) { this.props = props; this.state = {}; } setState() {} },
  };
  globalThis.document = {
    getElementById: () => ({ remove() {} }),
    createElement: () => ({}),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ factory }) {
        globalThis.__laneBundle = factory((name) => {
          if (name === 'react') return react;
          throw new Error(`unexpected require: ${name}`);
        });
      },
    },
  };
  await import('../lib/client.js?push');
  const { Push } = globalThis.__laneBundle.__components;
  const data = {
    state: {
      config: { defaultDomainId: 'default' },
      domains: [{ id: 'default', name: '默认客服' }],
      roles: [{ name: '客服', content: '' }],
      bindings: { 'snowluma:group:1': { domainId: 'default', enabled: true } },
      conversations: {
        'snowluma:group:1': { name: '一群' },
        'qqbot:private:9': { name: '私聊 9' },
      },
    },
  };
  const tree = Push({ data, refresh: async () => {} });
  const boxes = [];
  traverse(tree, (node) => { if (node?.type === 'input' && node?.props?.type === 'checkbox') boxes.push(node); });
  assert.equal(boxes.length, 2);
  const text = [];
  traverse(tree, (node) => {
    if (typeof node?.children === 'string') text.push(node.children);
    if (typeof node?.children === 'number') text.push(String(node.children));
  });
  assert.ok(text.some((line) => line.includes('已选 0 个')), text.join(' '));
  assert.ok(text.some((line) => line.includes('全选（2）')), text.join(' '));
  assert.ok(text.some((line) => line.includes('发送到 0 个会话')), text.join(' '));
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
  delete globalThis.__LANE_TEST__;
});
