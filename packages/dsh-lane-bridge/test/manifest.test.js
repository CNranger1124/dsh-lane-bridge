import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package manifest exposes the host, client, and bundle patch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-lane-bridge');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(Array.isArray(pkg.dsh.bundle.patch));
  for (const file of pkg.dsh.bundle.patch) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing patch ${file}`);
  }
  for (const file of pkg.files) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing published file ${file}`);
  }
});

test('bundle patches mount the host row and the lane-support preset', () => {
  const host = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(host, /id: dsh-lane-bridge/);
  assert.match(host, /name: 'dsh-lane-bridge'/);
  const preset = fs.readFileSync(path.join(ROOT, 'presets/lane-support.patch.yml'), 'utf8');
  assert.match(preset, /id: preset-lane-support/);
  assert.match(preset, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(preset, /id: lane-support/);
});

test('client bundle uses the DSH lazy-module wrapper', () => {
  const client = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(client, /id: 'dsh-lane-bridge'/);
  assert.match(client, /settings\.section/);
});
