import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMigration, applyMigration } from '../lib/migrate.js';
import { tempDir, cleanup } from './helpers.js';

function seedLegacy(dir) {
  fs.mkdirSync(path.join(dir, 'roles'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'knowledge', '客服'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    snowluma: { wsUrl: 'ws://127.0.0.1:3001', accessToken: 'legacy-token', homeDir: 'C:/SnowLuma', launcherPath: 'C:/SnowLuma/launcher.bat' },
    allow: { private: [111], groups: [222] },
    support: { enabled: true, preset: 'qq-support', conversations: ['group:222'] },
    socialV2: { send: { maxMessageChars: 900 } },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'roles', '客服.md'), '# 角色卡：客服\n\n旧仓库的客服。\n');
  fs.writeFileSync(path.join(dir, 'knowledge', '客服', '常见问题.md'), '# FAQ\n\n存档在哪？\n');
  fs.writeFileSync(path.join(dir, 'state', 'role-bindings.json'), JSON.stringify({
    default: '客服',
    groups: { 222: '客服' },
    private: { 111: '客服' },
  }));
  fs.writeFileSync(path.join(dir, 'state', 'sessions.json'), JSON.stringify({
    sessions: { 'private:111': 'sess-1', 'group:222': 'sess-2' },
  }));
}

test('migration builds domains, bindings, roles, knowledge, and sessions', () => {
  const legacy = tempDir();
  try {
    seedLegacy(legacy);
    const plan = buildMigration({ fromDir: legacy });
    assert.equal(plan.roles[0].name, '客服');
    assert.match(plan.roles[0].content, /旧仓库/);
    assert.equal(plan.knowledge.length, 1);
    assert.equal(plan.summary.domains, 2);
    assert.equal(plan.summary.bindings, 2);
    assert.equal(plan.state.config.channels.snowluma.accessToken, 'legacy-token');
    assert.equal(plan.state.config.reply.maxChars, 900);
    assert.equal(plan.state.bindings['snowluma:private:111'].domainId, 'default');
    assert.equal(plan.state.bindings['snowluma:group:222'].domainId, 'support');
    assert.equal(plan.state.sessions['snowluma:group:222'].sessionId, 'sess-2');
    // The session caches the role it was created with; roles now carry the domain.
    assert.equal(
      plan.state.sessions['snowluma:group:222'].role,
      plan.state.bindings['snowluma:group:222'].role
    );
    assert.ok(plan.state.roles.some((role) => role.domainId === 'support'));
    assert.equal(plan.state.config.channels.snowluma.homeDir, 'C:/SnowLuma');
    assert.ok(plan.warnings.some((warning) => warning.includes('launcherPath')));
  } finally {
    cleanup(legacy);
  }
});

test('applyMigration writes state, roles, and knowledge and refuses overwrite by default', () => {
  const legacy = tempDir();
  const target = tempDir();
  try {
    seedLegacy(legacy);
    const summary = applyMigration({ fromDir: legacy, dataDir: target });
    assert.equal(summary.bindings, 2);
    assert.ok(fs.existsSync(path.join(target, 'state.json')));
    assert.ok(fs.existsSync(path.join(target, 'roles', '客服.md')));
    assert.ok(fs.existsSync(path.join(target, 'knowledge', '客服', '常见问题.md')));
    assert.throws(() => applyMigration({ fromDir: legacy, dataDir: target }), /目标已存在/);
    const forced = applyMigration({ fromDir: legacy, dataDir: target, force: true });
    assert.equal(forced.dryRun, false);
  } finally {
    cleanup(legacy);
    cleanup(target);
  }
});
