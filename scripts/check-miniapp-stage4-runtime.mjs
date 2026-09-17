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
// 非 2xx 时运行接口回的是 JSON（如 VIP_REQUIRED），SSE 读取链路不会把它交给 onEvent ——
// 必须显式从响应缓冲里挖出 code/message，否则用户只看到「HTTP 403」，我们也无法按码引导。
assert.match(api, /parseErrorBody\(buffer\)/, '非 2xx 响应必须保留服务端给的原因与错误码');
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

/**
 * 算力充值页（pages/recharge/index）按参考图重排后的结构契约。
 * 这页同时压着「虚拟支付」这条最贵的链路，排版重构最容易顺手把它碰掉，
 * 所以除了类名，支付调用/签名失效重试也一并钉住。
 */
const recharge = read('miniapp/src/pages/recharge/index.tsx');
const appScss = read('miniapp/src/app.scss');

// 套餐名自带的 emoji（🥈 银卡 / 🥇 金卡 / 👑 至尊卡）当徽标用
assert.match(recharge, /const BADGE_EMOJI = \/\^\(\?:\[\\uD83C-\\uD83E\]\[\\uDC00-\\uDFFF\]/, '套餐名 emoji 必须用代理对区间剥离');
assert.doesNotMatch(recharge, /\\u\{1F/, '禁止用 \\u{...} 字面量匹配 emoji（需要 u 标志，端上转译不保证支持）');
assert.match(recharge, /label: label \|\| raw/, '名称整体就是 emoji 时必须回退原名，不能渲染空标题');

// 版式骨架：余额卡 → 两列网格 → 通栏支付 → 权益卡
assert.match(recharge, /className='mini-recharge-balance'/, '必须有顶部算力余额卡');
assert.match(recharge, /className='mini-recharge-grid'/, '套餐必须是网格布局');
assert.match(recharge, /mini-recharge-card--selected/, '套餐卡选中态类名必须保留');
assert.match(recharge, /className='mini-recharge-vip'/, '必须有 VIP 会员权益卡');
assert.match(recharge, /splitInfoLines\(data\?\.rechargeInfo/, '权益条目必须来自后台 rechargeInfo 逐行拆分');

// 支付链路不得被排版重构碰掉
assert.match(recharge, /await requestVirtualPayment\(order\.virtualPay\)/, '虚拟支付调用必须保留');
assert.match(recharge, /isVirtualPaySignatureError\(error\)/, '签名失效分支必须保留');
assert.match(recharge, /await refreshMiniappSession\(\)/, '签名失效后重新登录重试必须保留');

// 样式：两列等宽网格；对勾/箭头用边框旋转绘制（不依赖图标字体，各机型一致）
assert.match(appScss, /\.mini-recharge-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, '套餐网格必须是两列等宽');
assert.match(appScss, /\.mini-recharge-check::after \{[\s\S]{0,400}?transform: rotate\(-45deg\)/, '选中勾必须用两条边框旋 -45° 画');
assert.match(appScss, /\.mini-recharge-vip-arrow \{[\s\S]{0,400}?rotate\(45deg\)/, '权益卡箭头必须用边框旋 45° 画');
assert.doesNotMatch(appScss, /\.mini-recharge-radio/, '旧版单列卡片的选择圆点样式应当已删除');

/**
 * 「免费试用限购 1 次」+「VIP 专享门禁」的端上契约。
 * 服务端闸门由 scripts/check-plan-access.mjs 钉住；这里钉的是小程序侧不许退化 ——
 * 最容易发生的退化是「把弹窗改成 toast」「本地判定自己另写一套」。
 */
const vipGate = read('miniapp/src/utils/vip-gate.ts');
const types = read('miniapp/src/types.ts');

assert.match(types, /^\s*vip\?: boolean;/m, 'ContentItem 必须声明后台的 vip 字段');
assert.match(types, /vipAccess\?: boolean;/, 'UserProfile 必须声明服务端算好的 vipAccess');
assert.match(types, /trialPurchased\?: boolean;/, 'UserProfile 必须声明 trialPurchased（试用是否已用过）');
assert.match(types, /trial\?: boolean;/, 'ComputePackage 必须声明后台「试用套餐」开关');

// 前端判定口径：只读服务端结果，绝不自行拼套餐规则
assert.match(vipGate, /profile\.vipAccess !== false/, 'vip-gate 必须只读服务端算好的 vipAccess');
assert.doesNotMatch(vipGate, /TRIAL_PLAN_PATTERN|\/试用\//, 'vip-gate 不得自己按套餐名判定（口径唯一实现在 server/plan-access.mjs，文案里出现「免费试用」不算）');
assert.match(vipGate, /Taro\.showModal\(/, 'VIP 门禁必须用弹窗（toast 无法承载「去升级」这一步）');
assert.match(vipGate, /confirmText: '去升级'/, '弹窗必须给「去升级」按钮');
assert.match(vipGate, /Taro\.navigateTo\(\{ url: RECHARGE_PAGE \}\)/, '确认后必须跳充值页');
assert.match(vipGate, /item\.vip !== true/, '非 VIP 专享内容必须直接放行，不要多发一次请求');

// ⚠️ 签名带上了档案（`ensureVipAccess(item, me)`）：调用页要连过 手机号→套餐→算力 三道预检，
// 档案只该取一次，逐道各取一次会白跑两个来回。完整的三道顺序断言在 check-miniapp-points-gate.mjs。
// ⚠️ 两处的收尾关键字不同：chat 的 passGates 返回布尔值（`return false;`），
// workflow 的 submit 是 async void（`return;`）—— 别把两条正则写成同一个。
assert.match(chat, /if \(!\(await ensureVipAccess\(agent, me\)\)\) return false;/, 'chat 发送前必须过 VIP 门禁');
assert.match(workflow, /if \(!\(await ensureVipAccess\(workflow, me\)\)\) return;/, 'workflow 提交前必须过 VIP 门禁');

// 试用限购：卡片「已购买」态 + 重复购买的弹窗（不是 toast）
assert.match(recharge, /const trialUsed = data\?\.profile\?\.trialPurchased === true;/, '充值页必须读服务端 trialPurchased');
assert.match(recharge, /TRIAL_ALREADY_PURCHASED_CODE = 'TRIAL_ALREADY_PURCHASED'/, '错误码必须与服务端 plan-access.mjs 对齐');
assert.match(recharge, /if \(isTrialPackage\(pkg\) && trialUsed\)/, '已购试用再支付必须在本地先拦一道');
assert.match(recharge, /error\.code === TRIAL_ALREADY_PURCHASED_CODE/, '服务端 409 必须按码识别');
assert.match(recharge, /mini-recharge-card--used/, '试用套餐已购买态类名必须保留');
assert.match(recharge, /已购买 · 每人限购 1 次/, '已购买态必须说明限购原因');
assert.match(appScss, /\.mini-recharge-card--used \{/, '已购买态样式必须存在');

console.log('miniapp stage 4 runtime contracts: ok');
