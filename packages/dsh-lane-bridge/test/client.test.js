import test from 'node:test';
import assert from 'node:assert/strict';

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
        knowledgeScopes: ['default'], allowedHostTools: [], autoReply: true, trigger: 'all',
        keywords: [], memoryEnabled: false, memoryMaxChars: 2000, kbDraftEnabled: true,
        repoEnabled: true, repo: '', branch: '', systemPrompt: '', maxReplyChars: 0,
      }],
      roles: [{ name: '客服', content: '' }],
    },
  };
  const tree = Domains({ data, refresh: async () => {} });
  const text = [];
  traverse(tree, (node) => { if (typeof node?.children === 'string') text.push(node.children); });
  assert.ok(text.filter((line) => line === '保存领域').length >= 2, text.join(' '));
  // The group trigger is a multi-select: all four policies render as checkboxes.
  const triggerLabels = ['所有消息', '@ 或回复机器人', '命中关键词', '关闭（只记录）'];
  assert.deepEqual(triggerLabels.filter((label) => text.includes(label)), triggerLabels);
  assert.ok(text.some((line) => line.includes('可多选')), text.join(' '));
  // The operator whitelist lives on the same card and documents the id format.
  assert.ok(text.includes('管理者（白名单）'), text.join(' '));
  assert.ok(text.some((line) => line.includes('qqbot:') && line.includes('snowluma:')), text.join(' '));
  assert.ok(text.some((line) => line.includes('* ＝所有人')), text.join(' '));
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
      roles: [{ name: '客服', content: '' }],
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
  traverse(tree, (node) => { if (typeof node?.children === 'string') text.push(node.children); });
  assert.ok(text.some((line) => line.includes('最近发言者')), text.join(' '));
  assert.ok(text.some((line) => line.includes('RANGER') && line.includes('qqbot:8FD96C63')), text.join(' '));
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
