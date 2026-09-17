import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleMiniappApi } from '../server/miniapp-api.mjs';
import { handleMiniappRuntime } from '../server/miniapp-runtime.mjs';
import { PHONE_BIND_REQUIRED_CODE, hasPhoneBound, phoneBindRequiredMessage } from '../server/plan-access.mjs';

/**
 * 回归：小程序「付费功能门禁」—— 充值 / 对话 / 工作流三处都必须在未绑手机号时拦下。
 *
 * 为什么需要这个门禁：小程序是**静默登录即注册**，新用户拿到一个零资产占位账号，
 * 连手机号都没有。主人定的规则（2026-09-17）是：进门静默，**充值或使用付费功能之前**
 * 必须先把账号补完整（手机号），再由微信虚拟支付完成付款。
 *
 * 契约：
 *   ① 判据只有一个 —— reg_.phone（server/plan-access.mjs 的 hasPhoneBound）。
 *      ⚠️ 绝不能用微信身份的 bindingState：它的语义是「这个微信有没有被绑到某个**已有**网站账号」，
 *      和「有没有手机号」毫无关系。写错这一行会让所有静默登录用户被永久挡在门外。
 *   ② 拦截出口统一：403 + PHONE_BIND_REQUIRED（不能是 401，否则客户端会静默重登后重试，
 *      用户永远等不到引导；也不能是 409，那是「限购」的语义）。
 *   ③ 三处挂载点都要在，且顺序为「手机号门禁 → VIP 门禁 → 幂等键校验」。
 *   ④ 依赖缺失（老调用方没传 sanitizeId）时放行 —— 宁可漏拦，也不要把所有人挡在门外。
 */

const rtSource = fs.readFileSync(new URL('../server/miniapp-runtime.mjs', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../server/miniapp-api.mjs', import.meta.url), 'utf8');
const planSource = fs.readFileSync(new URL('../server/plan-access.mjs', import.meta.url), 'utf8');

// ── ① 判据：只看 reg_.phone ──────────────────────────────────────────────────
assert.equal(hasPhoneBound({ phone: '13900000000' }), true);
assert.equal(hasPhoneBound({ phone: '  ' }), false, '只有空白的 phone 不算已绑定');
assert.equal(hasPhoneBound({}), false);
assert.equal(hasPhoneBound(null), false);
assert.equal(hasPhoneBound(undefined), false);
assert.equal(hasPhoneBound({ bindingState: 'bound' }), false,
  'bindingState 是「有没有绑到已有网站账号」，绝不能拿它当手机号判据');
assert.equal(hasPhoneBound({ bindingState: 'unbound', phone: '13900000000' }), true,
  '已绑手机号但没绑网站账号 → 必须放行（静默登录用户的常态）');

// ── ④ 依赖缺失时放行，而不是把所有人挡在门外 ────────────────────────────────
const store = new Map([
  ['reg_u_nophone', { id: 'u_nophone', name: '新用户', points: 0, role: 'user' }],
  ['reg_u_phone', { id: 'u_phone', name: '已绑号用户', phone: '13900000000', points: 0, role: 'user' }],
  ['workflows', [{ id: 'wf1', published: true, name: '测试工作流' }]],
]);
const KV = {
  async kvGet(key) { return store.get(key) ?? null; },
  async kvPut(key, value) { store.set(key, value); return true; },
};
const makeResponse = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  end(raw) { this.body = raw ? JSON.parse(raw) : null; },
});
const runtimeDeps = (userId) => ({
  KV,
  readBody: async (req) => req.body || {},
  getSession: () => ({ userId, role: 'user', client: 'miniapp', identityKey: 'wxmini_identity_' + userId }),
  isAdminSession: (session) => session?.role === 'admin',
  getPlanValidity: () => ({ validTo: null, expired: false }),
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
  getAgents: () => [{ id: 'a1', published: true, name: '测试智能体' }],
  port: 1, // 门禁命中时根本不会走到代理；未命中即等价于放行（连接失败也不是 403 该码）
});
const apiDeps = (userId) => ({
  KV,
  getSession: () => ({ userId, role: 'user', client: 'miniapp', identityKey: 'wxmini_identity_' + userId }),
  isAdminSession: (session) => session?.role === 'admin',
  getPlanValidity: () => ({ validTo: null, expired: false }),
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
  readBody: async (req) => req.body || {},
  hashPassword: (value) => 'hash:' + value,
  verifyPassword: () => false,
});

const callRuntime = async (userId, path, body = {}) => {
  const res = makeResponse();
  await handleMiniappRuntime(
    { method: 'POST', headers: { 'x-request-id': 'phone-gate-rt' }, body },
    res,
    new URL('http://local' + path),
    runtimeDeps(userId),
  );
  return res;
};
const callApi = async (userId, path, body = {}) => {
  const res = makeResponse();
  await handleMiniappApi(
    { method: 'POST', headers: { 'x-request-id': 'phone-gate-api' }, body },
    res,
    new URL('http://local' + path),
    apiDeps(userId),
  );
  return res;
};

// ── ③ 三处挂载点的实际行为 ──────────────────────────────────────────────────
const chatBlocked = await callRuntime('u_nophone', '/api/miniapp/v1/agents/a1/chat');
assert.equal(chatBlocked.statusCode, 403, '未绑手机号时对话必须被拦');
assert.equal(chatBlocked.body.error.code, PHONE_BIND_REQUIRED_CODE);
assert.equal(chatBlocked.body.error.message, phoneBindRequiredMessage());

const wfBlocked = await callRuntime('u_nophone', '/api/miniapp/v1/workflows/wf1/tasks', { parameters: {} });
assert.equal(wfBlocked.statusCode, 403, '未绑手机号时提交工作流任务必须被拦');
assert.equal(wfBlocked.body.error.code, PHONE_BIND_REQUIRED_CODE);

const rechargeBlocked = await callApi('u_nophone', '/api/miniapp/v1/recharge/order', { packageId: 'pkg1' });
assert.equal(rechargeBlocked.statusCode, 403, '未绑手机号时充值下单必须被拦');
assert.equal(rechargeBlocked.body.error.code, PHONE_BIND_REQUIRED_CODE);

// 已绑手机号 → 不得再被这道门禁拦（后续可能因别的校验失败，但绝不能还是这个码）
for (const [label, res] of [
  ['chat', await callRuntime('u_phone', '/api/miniapp/v1/agents/a1/chat')],
  ['workflow', await callRuntime('u_phone', '/api/miniapp/v1/workflows/wf1/tasks', { parameters: {} })],
  ['recharge', await callApi('u_phone', '/api/miniapp/v1/recharge/order', { packageId: 'pkg1' })],
]) {
  assert.notEqual(res.body?.error?.code, PHONE_BIND_REQUIRED_CODE,
    `已绑手机号时 ${label} 不得再被判为未绑定`);
}

// 未登录 → 仍是 401（门禁不该抢在鉴权前面）
const anonRes = makeResponse();
await handleMiniappApi(
  { method: 'POST', headers: {}, body: { packageId: 'pkg1' } },
  anonRes,
  new URL('http://local/api/miniapp/v1/recharge/order'),
  { ...apiDeps('u_nophone'), getSession: () => null },
);
assert.equal(anonRes.statusCode, 401, '未登录必须 401 —— 鉴权要排在门禁之前');

// ── ② 源码级：错误码/文案唯一实现在 plan-access.mjs，且三处都引用它 ─────────
assert.match(planSource, /export const PHONE_BIND_REQUIRED_CODE = 'PHONE_BIND_REQUIRED'/);
assert.match(planSource, /export function phoneBindRequiredMessage\(\)/);
assert.match(planSource, /export function hasPhoneBound\(regRecord\)/);
assert.match(apiSource, /import \{\n[\s\S]{0,400}PHONE_BIND_REQUIRED_CODE,[\s\S]{0,400}\} from '\.\/plan-access\.mjs'/,
  'miniapp-api.mjs 必须从 plan-access.mjs 引入门禁的错误码与文案（不得自己写一份）');
assert.match(rtSource, /import \{ PHONE_BIND_REQUIRED_CODE,[^}]*\} from '\.\/plan-access\.mjs'/);
assert.equal((rtSource.match(/PHONE_BIND_REQUIRED_CODE, phoneBindRequiredMessage\(\)/g) || []).length, 2,
  'miniapp-runtime.mjs 的 chat 与 workflow 两个出口都必须走同一对错误码 + 文案');

// ── ③ 顺序：手机号门禁 → VIP 门禁 → 幂等键校验 ──────────────────────────────
const chatGate = rtSource.indexOf('hasPhoneBoundForUser(deps, userId)');
const chatVip = rtSource.indexOf('agent.vip === true && !(await hasVipContentAccess');
assert.ok(chatGate > 0 && chatGate < chatVip, '对话：手机号门禁必须排在 VIP 门禁之前');
const wfGate = rtSource.indexOf('hasPhoneBoundForUser(deps, userId)', chatGate + 1);
const wfVip = rtSource.indexOf('workflow.vip === true && !(await hasVipContentAccess');
const idempotency = rtSource.indexOf('IDEMPOTENCY_KEY_REQUIRED');
assert.ok(wfGate > chatGate && wfGate < wfVip, '工作流：手机号门禁必须排在 VIP 门禁之前');
assert.ok(wfVip < idempotency, '工作流：两道门禁都要排在幂等键校验之前 —— 没资格就不该建任务');

// 充值：门禁必须在读套餐 / 建订单之前（不建单、不扣款、不碰虚拟支付配置）
const rechargeFnAt = apiSource.indexOf('async function createRechargeOrder');
const rechargeGate = apiSource.indexOf('hasPhoneBound(gateReg)', rechargeFnAt);
const rechargeConfig = apiSource.indexOf('await loadVirtualPayConfig(KV)', rechargeFnAt);
const rechargePackages = apiSource.indexOf("KV.kvGet('computePackages')", rechargeFnAt);
assert.ok(rechargeGate > rechargeFnAt && rechargeGate < rechargeConfig,
  '充值：手机号门禁必须在加载虚拟支付配置之前');
assert.ok(rechargeGate < rechargePackages, '充值：手机号门禁必须在读套餐、建订单之前');

// ── 客户端侧：三处调用点 + 补手机号页双模式 + 「版本差必须放行」的兜底 ────────
const gateSource = fs.readFileSync(new URL('../miniapp/src/utils/phone-gate.ts', import.meta.url), 'utf8');
const chatSource = fs.readFileSync(new URL('../miniapp/src/pages/chat/index.tsx', import.meta.url), 'utf8');
const workflowSource = fs.readFileSync(new URL('../miniapp/src/pages/workflow/index.tsx', import.meta.url), 'utf8');
const rechargeSource = fs.readFileSync(new URL('../miniapp/src/pages/recharge/index.tsx', import.meta.url), 'utf8');
const bindSource = fs.readFileSync(new URL('../miniapp/src/pages/bind/index.tsx', import.meta.url), 'utf8');
const clientApi = fs.readFileSync(new URL('../miniapp/src/services/api.ts', import.meta.url), 'utf8');

// 预判口径不得在前端重写：只读服务端算好的 phoneBound，且只有明确 false 才拦
assert.match(gateSource, /if \(current\.phoneBound !== false\) return true;/,
  '客户端只有明确拿到 phoneBound=false 才拦；老服务端不下发该字段时必须放行（版本差不能误拦）');
const gateCodeOnly = gateSource.replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
assert.ok(!gateCodeOnly.includes('bindingState'),
  '客户端不得读 bindingState 重写判定口径（那是「绑没绑已有网站账号」，与手机号无关）');

assert.match(clientApi, /export async function bindPhoneNumber\(/);
assert.match(clientApi, /'\/api\/miniapp\/v1\/auth\/bind-phone'/);

// ── 死代码不得回归（2026-09-17 清理）──────────────────────────────────────────
// bindingRequired 是「有没有绑到已有网站账号」的旧字段，与手机号门禁无关；
// 客户端曾把它落进 storage 并导出 isBindingRequired()，实际无任何调用点。
// 留着它会诱使后人拿它当手机号判据 —— 直接把整条链路钉死在源码里。
const miniappSrcFiles = [];
const collectSrc = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) collectSrc(full);
    else if (/\.tsx?$/.test(entry.name)) miniappSrcFiles.push(full);
  }
};
collectSrc(new URL('../miniapp/src/', import.meta.url));
for (const needle of ['isBindingRequired', 'BINDING_KEY', 'markPhoneBound']) {
  const hits = miniappSrcFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(needle));
  assert.equal(hits.length, 0,
    `死代码 ${needle} 不得回归（命中：${hits.map((f) => f.pathname).join(', ')}）`);
}

// ── P1-1 微信一键绑定：链路两端都在，且失败必须能退化到短信 ────────────────────
const wechatPhoneSource = fs.readFileSync(new URL('../server/wechat-phone.mjs', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../server/miniapp-auth.mjs', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');

// 服务端换号：走微信官方接口，且复用虚拟支付的 access_token 缓存（同一 AppId 另建一份会互相作废）
assert.match(wechatPhoneSource, /export async function exchangeWechatPhoneCode\(/);
assert.match(wechatPhoneSource, /\/wxa\/business\/getuserphonenumber\?access_token=/);
assert.match(wechatPhoneSource, /import \{ getAccessToken \} from '\.\/wechat-virtual-pay\.mjs'/,
  'access_token 必须复用虚拟支付那套进程内缓存，不另建第二份凭证');
assert.ok(wechatPhoneSource.includes('不能混用'),
  '必须留下「动态令牌与 wx.login 的 code 不是一回事」的注释，否则后人必然混用');

// 服务端取值：method 双路，缺省 sms（线上 0.1.2 客户端不带该字段，改错会让所有补号请求 400）
assert.match(authSource, /const method = String\(body\.method \|\| 'sms'\)/,
  "method 缺省必须是 'sms' —— 老客户端不带它，默认值变了就是线上回归");
assert.match(authSource, /if \(method === 'wechat'\) \{/);
assert.match(authSource, /else if \(method !== 'sms'\)[\s\S]{0,140}INVALID_BIND_METHOD/);
assert.equal((authSource.match(/deps\.KV\.kvBindPhoneToAccount\(/g) || []).length, 1,
  '两条取号路径必须共用同一个落库出口 —— 闸门（kvBindPhoneToAccount）不能被复制成两份');
assert.match(indexSource, /import \{ exchangeWechatPhoneCode \} from '\.\/wechat-phone\.mjs'/);
assert.match(indexSource, /exchangeWechatPhoneCode,/, 'index.mjs 必须把它注入 handleMiniappAuth 的 deps');

// 客户端请求体
assert.match(clientApi, /export async function bindPhoneByWechat\(dynamicCode: string\)/);
assert.match(clientApi, /method: 'wechat', code: dynamicCode/);

// 客户端页面：真的挂上组件，且每条失败路径都能回落到短信
assert.match(bindSource, /openType='getPhoneNumber'/,
  '必须用官方 open-type 组件取号 —— 只有它拿到的动态令牌能换手机号');
assert.match(bindSource, /onGetPhoneNumber=\{onWechatPhone\}/);
assert.match(bindSource, /bindPhoneByWechat\(dynamicCode\)/);
assert.match(bindSource, /1400001/, '额度用尽（errno 1400001）要单独提示，否则用户只看到「未授权」无从判断');
const oneClickBody = bindSource.slice(bindSource.indexOf('const onWechatPhone'), bindSource.indexOf('const submit'));
assert.ok(oneClickBody.length > 200, 'onWechatPhone 处理器必须存在（源码被改动？）');
assert.match(oneClickBody, /PHONE_OWNED_BY_OTHER_ACCOUNT[\s\S]{0,220}setMode\('adopt'\)[\s\S]{0,140}setCode\(''\)/,
  '一键路径撞上「号码属于有资产的别人」也必须交回 adopt 并重发短信 —— 一键拿到的号不足以证明账号归属');
assert.ok(!oneClickBody.includes('storeBoundSession'),
  '一键路径不换账号、token 不变；调 storeBoundSession 会覆盖 token（对 adopt 才是对的）');

for (const [label, source] of [['对话', chatSource], ['工作流', workflowSource], ['充值', rechargeSource]]) {
  assert.match(source, /ensurePhoneBound\(/, `${label}页必须挂上手机号门禁的本地预检`);
}
// 顺序必须与服务端一致：先手机号，再套餐，最后算力。
// ⚠️ 门禁的调用签名带上了档案（三道门禁只取一次 getMe）—— 传的是 `me`，不再是空参。
// 完整的三道顺序断言在 check-miniapp-points-gate.mjs，这里只钉住「手机号永远排第一」。
for (const [label, source] of [['对话', chatSource], ['工作流', workflowSource]]) {
  const phoneAt = source.indexOf('ensurePhoneBound(me)');
  const vipAt = source.indexOf('ensureVipAccess(');
  const pointsAt = source.indexOf('ensureEnoughPoints(');
  assert.ok(phoneAt > 0, `${label}页必须把档案传给手机号门禁（ensurePhoneBound(me)）`);
  assert.ok(phoneAt < vipAt, `${label}页：手机号门禁必须排在 VIP 门禁之前（与服务端同序）`);
  assert.ok(vipAt < pointsAt, `${label}页：套餐门禁必须排在算力门禁之前 —— 0 算力 + 非 VIP 的新用户，服务端先回的是 VIP_REQUIRED`);
}
assert.match(rechargeSource, /error\.code === PHONE_BIND_REQUIRED_CODE/,
  '充值页必须兜住服务端 403 PHONE_BIND_REQUIRED，不能退化成一句「支付失败」');

// 补手机号页：bind / adopt 双模式，adopt 必须让用户重新获取验证码
assert.match(bindSource, /'PHONE_OWNED_BY_OTHER_ACCOUNT'/);
assert.match(bindSource, /setMode\('adopt'\)[\s\S]{0,160}setCode\(''\)/,
  '切到 adopt 必须清空验证码：短信码是一次性的，bind 那一次已经把它用掉了');
assert.match(bindSource, /bindWebsiteAccount/, 'adopt 分支必须改走「绑定已有账号」');
assert.ok(!bindSource.includes('请输入网站注册手机号'),
  '旧的误导文案必须去掉：全新用户没有「网站注册手机号」，只会有困惑');

console.log('miniapp phone gate check passed: 充值 / 对话 / 工作流三处未绑手机号一律 403 PHONE_BIND_REQUIRED（含客户端预检）');
