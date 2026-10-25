import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { defaultState } from '../lib/defaults.js';
import { tempDir, cleanup } from './helpers.js';

function fakeCtx() {
  const routes = [];
  const effects = [];
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return {
    logger,
    routes,
    effects,
    webServer: {
      register(route) {
        routes.push(route);
        return () => {
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
    sessionController: {},
    sessionQuery: {},
    workspaceController: {},
    agents: { get: () => null },
    effect(fn, label) {
      effects.push(label);
      const dispose = fn();
      return () => dispose?.();
    },
  };
}

test('apply mounts routes, loads state, and starts no channels when disabled', async () => {
  const dir = tempDir();
  try {
    const state = defaultState();
    state.config.channels.snowluma.enabled = false;
    state.config.channels.qqbot.enabled = false;
    state.config.channels.discord.enabled = false;
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
    const ctx = fakeCtx();
    await apply(ctx, { dataDir: dir });
    assert.equal(ctx.routes.length, 2);
    assert.ok(ctx.routes.some((route) => route.kind === 'prefix' && route.path === '/lane-bridge'));
    assert.ok(ctx.routes.some((route) => route.kind === 'exact' && route.path === '/lane-bridge'));
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.equal(persisted.config.channels.snowluma.enabled, false);
    assert.ok(fs.existsSync(path.join(dir, 'state.json')));
    assert.ok(ctx.effects.includes('dsh-lane-bridge lifecycle'));
  } finally {
    cleanup(dir);
  }
});
