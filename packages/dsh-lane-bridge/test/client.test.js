import test from 'node:test';
import assert from 'node:assert/strict';

test('client bundle registers the settings section and cleans up', async () => {
  const sections = [];
  let disposed = 0;
  const react = {
    createElement() { return {}; },
    useState() { return [undefined, () => {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
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
  await import('../lib/client.js');
  const bundle = globalThis.__laneBundle;
  assert.equal(bundle.name, 'dsh-lane-bridge-client');
  assert.deepEqual(bundle.inject, ['slots']);
  let cleanup = null;
  const ctx = {
    slots: {
      inject(name, register) {
        assert.equal(name, 'settings.section');
        sections.push(register());
        return () => { disposed += 1; };
      },
      register(options) {
        assert.equal(options.name, 'settings.section');
        assert.equal(options.id, 'lane-bridge');
        return () => { disposed += 1; };
      },
    },
    effect(fn) {
      cleanup = fn();
    },
  };
  bundle.apply(ctx);
  assert.equal(sections.length, 1);
  assert.equal(typeof cleanup, 'function');
  cleanup();
  assert.ok(disposed >= 1);
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__laneBundle;
});
