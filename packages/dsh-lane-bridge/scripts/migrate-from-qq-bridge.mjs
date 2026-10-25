#!/usr/bin/env node
// Thin CLI for lib/migrate.js.
//
//   node scripts/migrate-from-qq-bridge.mjs \
//     --from ../../qq-bridge \
//     --data-dir ~/.dsh/lane-bridge \
//     [--force] [--dry-run]
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyMigration } from '../lib/migrate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? '') : fallback;
}
const fromDir = path.resolve(option('--from', path.resolve(HERE, '..', '..', '..', 'qq-bridge')));
const dataDir = path.resolve(option('--data-dir', path.join(os.homedir(), '.dsh', 'lane-bridge')));
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

try {
  const summary = applyMigration({ fromDir, dataDir, force, dryRun });
  console.log(JSON.stringify({ fromDir, dataDir, ...summary }, null, 2));
} catch (error) {
  console.error(`迁移失败：${error?.message ?? error}`);
  process.exitCode = 1;
}
