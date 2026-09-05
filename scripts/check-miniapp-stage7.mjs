import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMiniappRoute, summarizeMiniappMetrics } from '../server/miniapp-observability.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const config = read('miniapp/config/index.ts');
const api = read('miniapp/src/services/api.ts');
const app = read('miniapp/src/app.tsx');
const server = read('server/index.mjs');
const runtime = read('server/miniapp-runtime.mjs');
const observability = read('server/miniapp-observability.mjs');
const release = read('scripts/build-miniapp-release.mjs');

assert.match(config, /MINIAPP_ENV/);
assert.match(config, /experience/);
assert.match(config, /defineConstants/);
assert.match(api, /X-Miniapp-Environment/);
assert.match(api, /X-Miniapp-Version/);
assert.match(api, /\/api\/miniapp\/v1\/client-errors/);
assert.match(app, /reportClientError/);
assert.match(server, /attachMiniappRequestMetric/);
assert.match(server, /handleMiniappObservability/);
assert.match(runtime, /kind: 'workflow'/);
assert.match(runtime, /firstTokenMs/);
assert.match(observability, /MAX_METRICS = 50000/);
assert.match(release, /release-manifest\.json/);

assert.equal(normalizeMiniappRoute('/api/miniapp/v1/agents/a-secret/chat'), '/api/miniapp/v1/agents/:id/chat');
assert.equal(normalizeMiniappRoute('/api/miniapp/v1/workflows/w1/tasks'), '/api/miniapp/v1/workflows/:id/tasks');

const now = new Date().toISOString();
const summary = summarizeMiniappMetrics([
  { kind: 'login', ok: true, durationMs: 40, createdAt: now },
  { kind: 'login', ok: false, durationMs: 100, createdAt: now },
  { kind: 'api', ok: true, durationMs: 20, createdAt: now },
  { kind: 'workflow', ok: true, durationMs: 800, createdAt: now },
  { kind: 'chat', ok: true, durationMs: 900, firstTokenMs: 120, createdAt: now },
  { kind: 'client-error', ok: false, createdAt: now },
], 60);
assert.equal(summary.loginFailureRate, 0.5);
assert.equal(summary.workflowSuccessRate, 1);
assert.equal(summary.chatFirstTokenMs.p50, 120);
assert.equal(summary.totals.clientErrors, 1);

console.log('miniapp stage 7 release and observability contracts: ok');
