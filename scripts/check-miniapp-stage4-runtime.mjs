import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSseResult, taskKeysFor } from '../server/miniapp-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const server = read('server/index.mjs');
const runtime = read('server/miniapp-runtime.mjs');
const api = read('miniapp/src/services/api.ts');
const chat = read('miniapp/src/pages/chat/index.tsx');
const workflow = read('miniapp/src/pages/workflow/index.tsx');
const appConfig = read('miniapp/src/app.config.ts');

assert.ok(server.indexOf('handleMiniappRuntime(req, res, u') < server.indexOf('handleMiniappApi(req, res, u'), 'runtime routes must be handled before read-only routes');
const runtimeCallStart = server.indexOf('handleMiniappRuntime(req, res, u');
const apiCallStart = server.indexOf('handleMiniappApi(req, res, u', runtimeCallStart);
const runtimeWiring = server.slice(runtimeCallStart, apiCallStart);
assert.match(runtimeWiring, /sanitizeId:\s*sanitizeIdSafe/, 'runtime routes must use the initialized ID sanitizer');
assert.doesNotMatch(runtimeWiring, /\n\s*sanitizeId,\s*\n/, 'runtime routes must not reference the later request-local sanitizer');
assert.match(runtime, /proxyRequest\(deps\.port, '\/api\/coze\/chat'/);
assert.match(runtime, /proxyRequest\(port, '\/api\/coze\/workflow-run'/);
assert.match(runtime, /requestJson\(deps\.port, '\/api\/coze\/file-upload'/);
assert.match(runtime, /requestJson\(deps\.port, '\/api\/data\/assets'/);
assert.match(runtime, /Idempotency-Key|idempotency-key/);
assert.match(runtime, /session\.client !== 'miniapp'/);

const parsed = parseSseResult('event: message\ndata: {"kind":"image","url":"https://example.invalid/a.png"}\n\n');
assert.equal(parsed.result.url, 'https://example.invalid/a.png');
assert.equal(parsed.error, '');
const failed = parseSseResult('event: error\ndata: {"error":"upstream failed"}\n\n');
assert.equal(failed.error, 'upstream failed');

const first = taskKeysFor('user-a', 'same-request');
assert.deepEqual(first, taskKeysFor('user-a', 'same-request'));
assert.notEqual(first.taskId, taskKeysFor('user-b', 'same-request').taskId);

for (const page of ['chat', 'workflow']) {
  assert.match(appConfig, new RegExp(`pages/${page}/index`));
  assert.ok(fs.existsSync(path.join(root, `miniapp/src/pages/${page}/index.tsx`)));
}
assert.match(api, /enableChunked: true/);
assert.match(api, /onChunkReceived/);
assert.match(chat, /streamAgentChat/);
assert.match(chat, /attachments:/);
assert.match(workflow, /Idempotency|submitWorkflowTask/);
assert.match(workflow, /ACTIVE_TASK_PREFIX/);
assert.match(workflow, /getRuntimeTask/);
assert.match(workflow, /previewImage/);
assert.match(workflow, /<Video/);
assert.match(workflow, /saveRuntimeAsset/);

const clientSources = [api, chat, workflow, read('miniapp/src/services/runtime.ts')].join('\n');
assert.doesNotMatch(clientSources, /WECHAT_MINIAPP_APP_SECRET|api[_-]?key|private[_-]?key/i);
assert.doesNotMatch(clientSources, /\/api\/admin\//);

console.log('miniapp stage 4 runtime contracts: ok');
