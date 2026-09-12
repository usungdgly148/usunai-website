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

/**
 * 消息操作条的「复制」必须**真的写剪贴板**。
 *
 * 官方 `chat-actionbar` 不会自己复制：`handleCopy()` 只做
 * 「按 copyMode 取文本 → triggerEvent('actions', { name:'copy', data })」这一步
 * （见 node_modules/tdesign-miniprogram/miniprogram_dist/chat-actionbar/chat-actionbar.js）。
 * 曾经这里只弹了一句 toast 就 return → 真机上「提示已复制、粘贴是空的」。
 * 这条链路**只在真机可见**，所以必须有断言守住，别让后人再删掉那一行 API 调用。
 */
assert.match(appConfig, /'t-chat-actionbar'/, 't-chat-actionbar 必须保持注册（复制按钮就在它里面）');
const actionStart = chat.indexOf('const handleMessageAction');
assert.ok(actionStart > -1, 'chat 页必须有 handleMessageAction 处理 actionbar 动作');
const actionEnd = chat.indexOf('\n  };', actionStart);
assert.ok(actionEnd > actionStart, 'handleMessageAction 的函数体边界应能定位（缩进变了就更新这里）');
const actionBody = chat.slice(actionStart, actionEnd);
assert.match(actionBody, /name === 'copy'/, 'handleMessageAction 必须处理 copy 动作');
assert.match(actionBody, /Taro\.setClipboardData\(\{\s*data:\s*text\s*\}\)/, 'copy 分支必须真的调 Taro.setClipboardData（只弹 toast = 复制不了）');
assert.match(actionBody, /detail\?\.data/, 'copy 应优先取组件回传的 detail.data');
assert.doesNotMatch(actionBody, /name === 'copy'\)\s*\{\s*toast\(/, "copy 分支不得只剩下 toast（'已复制' 的假提示）");
assert.match(chat, /copyMode='markdown'/, "copyMode 必须显式写死为 'markdown'（复制原文，与网页端 copyToClipboard(m.content) 同口径）");

const clientSources = [api, chat, workflow, read('miniapp/src/services/runtime.ts')].join('\n');
assert.doesNotMatch(clientSources, /WECHAT_MINIAPP_APP_SECRET|api[_-]?key|private[_-]?key/i);
assert.doesNotMatch(clientSources, /\/api\/admin\//);

console.log('miniapp stage 4 runtime contracts: ok');
