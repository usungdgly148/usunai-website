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

console.log('miniapp phone gate check passed: 充值 / 对话 / 工作流三处未绑手机号一律 403 PHONE_BIND_REQUIRED');
