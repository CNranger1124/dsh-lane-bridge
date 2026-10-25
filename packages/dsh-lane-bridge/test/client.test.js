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
