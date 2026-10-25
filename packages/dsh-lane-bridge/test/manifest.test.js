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

test('the bundle also mounts the lane-chat role-play preset', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dsh.bundle.patch.includes('./presets/lane-chat.patch.yml'));
  const preset = fs.readFileSync(path.join(ROOT, 'presets/lane-chat.patch.yml'), 'utf8');
  assert.match(preset, /id: preset-lane-chat/);
  assert.match(preset, /name: '@deepseek-ai\/dsh-agent-preset'/);
  assert.match(preset, /id: lane-chat/);
  assert.match(preset, /name: '@deepseek-ai\/dsh-persona'/);
  // The role card outranks the preset's generic habits.
  assert.match(preset, /角色卡是身份/);
  assert.match(preset, /优先级：角色卡 > 本段通用规则/);
  // Like lane-support, the preset mounts the persona and nothing else, so the
  // domain allow-list remains the only thing that can widen the tool surface.
  const children = [...preset.matchAll(/^ {10}- id: (.+)$/gmu)].map((match) => match[1].trim());
  assert.deepEqual(children, ['persona']);
});

test('client bundle uses the DSH lazy-module wrapper', () => {
  const client = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/);
  assert.match(client, /id: 'dsh-lane-bridge'/);
  assert.match(client, /settings\.section/);
});
