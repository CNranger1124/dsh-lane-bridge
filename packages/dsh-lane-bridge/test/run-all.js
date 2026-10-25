// Run every test file in one process.
//
// The DSH sandbox forbids the Node test runner's per-file child processes
// (`spawn EPERM`), so `npm test` imports the files directly. `node:test` still
// reports pass/fail and exits non-zero on failure.
import './manifest.test.js';
import './router.test.js';
import './store.test.js';
import './knowledge.test.js';
import './memory.test.js';
import './usage.test.js';
import './media.test.js';
import './onebot.test.js';
import './discord.test.js';
import './qqbot.test.js';
import './snowluma-discovery.test.js';
import './routes.test.js';
import './migrate.test.js';
import './session-pool.test.js';
import './inbound-queue.test.js';
import './client.test.js';
import './plugin.test.js';
import './reply-dispatcher.test.js';
import './text.test.js';
