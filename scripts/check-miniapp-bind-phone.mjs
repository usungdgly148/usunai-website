import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleMiniappAuth, identityStorageKeys } from '../server/miniapp-auth.mjs';
import { handleMiniappApi } from '../server/miniapp-api.mjs';
import { handleMiniappRuntime } from '../server/miniapp-runtime.mjs';

/**
 * 回归：手机号绑定必须走 kvBindPhoneToAccount，**绝不能直接覆盖 `phone_` 索引**。
 *
 * 为什么单独守这一条：手机号是**登录凭据** —— `phone_<号码>` 索引直接决定
 * 「谁用这个号登录」。旧实现（server/index.mjs 的 /api/auth/bind-phone）是
 * `KV.kvPut(phoneIndexKey(phone), s.userId)` 直接覆盖，于是 A 账号可以把已属于 B 账号的
 * 号码绑到自己名下，B 此后用手机号登录会登进 A 的账号（手机号形同被偷）。
 *
 * 契约（= 主人拍板的规则「空壳自动并、有资产不自动并」）：
 *   ① 号码空闲                     → 绑到当前账号，reg_/user_ 两份都带 phone
 *   ② 号码属于可回收空壳           → 自动并（空壳标记 merged，号码改指当前账号）
 *   ③ 号码属于**有资产**的账号     → 拒绝 phone_owned_by_other，索引与对方账号一律不动
 *   ④ 号码属于**挂微信身份**的账号 → 拒绝（并完那个微信立刻变孤儿身份，永久登录失败）
 *   ⑤ 号码属于**能用邮箱登录**的账号 → 拒绝（并掉会破坏对方的邮箱登录）
 *   ⑥ 重复绑自己的号码             → 幂等成功
 *   ⑦ 小程序端点把 ② 表现为 200、把 ③ 表现为 409 + 可引导的错误码
 *   ⑧ 取号方式由 `body.method` 选择：`'sms'`（缺省，向后兼容线上 0.1.2 客户端）/
 *      `'wechat'`（P1-1 一键绑定，动态令牌换号）。**两条路取到号码后共用同一个落库出口**，
 *      且 `'wechat'` 分支绑定的号码只能来自微信换号结果 —— 取信 `body.phone` 等于绕过验证。
 *
 * 本脚本分两层跑：
 *   · 端点层 + 源码闸门层 —— 纯桩，任何环境都能跑（进 verify 链的就是这部分）。
 *   · 真库层 —— 需要 better-sqlite3（本机仓库无 node_modules，故降级跳过；
 *     服务器 /opt/usun｜/opt/usun/server 有依赖，放同级 scripts/ 下执行即可跑全量：
 *       ssh … 'cd /opt/usun && node scripts/check-miniapp-bind-phone.mjs'）。
 *     真库层验的正是「先读后写」的原子性与并发覆盖，桩测不出来，因此不能长期缺席。
 */

const kvSource = fs.readFileSync(new URL('../server/kv-local.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../server/miniapp-auth.mjs', import.meta.url), 'utf8');

// ── 1. 源码闸门：三道闸门必须在同一个判定里，且不得再出现直接覆盖索引 ─────────
assert.match(kvSource, /export async function kvBindPhoneToAccount\(\{ phone, userId, updatedAt \}\)/,
  '手机号绑定的唯一实现必须留在 kv-local.js（两端共用，不允许各自实现一份）');
assert.match(kvSource, /if \(ownerEmail \|\| hasWechatIdentityForAccount\(ownerId\) \|\| !isEmptyShellAccount\(select, ownerId\)\)/,
  '有邮箱 / 有微信身份 / 有资产 —— 三道闸门缺一不可，且必须同时判定');
assert.match(kvSource, /function hasWechatIdentityForAccount\(uid\)[\s\S]{0,220}GLOB 'wxmini_\*'/,
  '微信身份占用必须通过 GLOB wxmini_* 反查（LIKE 的 _ 是通配符，会误匹配）');
assert.match(kvSource, /reason: 'phone_owned_by_other'/, '冲突必须上报 phone_owned_by_other，而不是默默覆盖');
// 先剥掉纯注释行再查：注释里可能引用旧代码串（用来解释「为什么要改」），不能当违规命中
const indexCodeOnly = indexSource.replace(/^\s*\/\/.*$/gm, '');
assert.ok(!indexCodeOnly.includes('KV.kvPut(phoneIndexKey(phone), s.userId)'),
  'index.mjs 的 /api/auth/bind-phone 不得再直接覆盖 phone_ 索引（会抢走别人账号的号码）');
assert.match(indexSource, /await KV\.kvBindPhoneToAccount\(\{/,
  'index.mjs 的 /api/auth/bind-phone 必须改走共用实现');
assert.match(authSource, /const BIND_PHONE_PATH = '\/api\/miniapp\/v1\/auth\/bind-phone'/);
assert.match(authSource, /path === BIND_PHONE_PATH && req\.method === 'POST'/);

// ── 1b. 源码闸门（P1-1）：一键取号只是「另一种取号方式」，不得长出第二条落库旁路 ──
const wechatPhoneSource = fs.readFileSync(new URL('../server/wechat-phone.mjs', import.meta.url), 'utf8');
assert.match(wechatPhoneSource, /getuserphonenumber/, '换号必须走微信官方接口');
assert.ok(!/\bkvPut\b/.test(wechatPhoneSource),
  'wechat-phone.mjs 只负责换号，不得自己写库 —— 写库只能有一个出口（kvBindPhoneToAccount）');
assert.match(authSource, /const method = String\(body\.method \|\| 'sms'\)/,
  "缺省必须是 'sms'：线上 0.1.2 客户端不带 method，默认值变了就是线上全量回归");
assert.ok(authSource.indexOf('const method = String(body.method') < authSource.indexOf('deps.KV.kvBindPhoneToAccount'),
  '取号分支必须全部收敛在落库之前 —— 不允许 wechat 分支另走一条写库路径');

// ── 2. 端点层：错误码 → HTTP 状态的映射（桩 KV 精确控制 kvBindPhoneToAccount 的返回）──
const store = new Map([
  ['reg_u_keeper', { id: 'u_keeper', name: '微信用户', points: 0, role: 'user' }],
  ['user_u_keeper', { id: 'u_keeper', name: '微信用户', points: 0, role: 'user' }],
]);
const makeResponse = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  end(raw) { this.body = JSON.parse(raw); },
});
const baseDeps = {
  config: { appId: 'wx4f071fbfd1e51130', appSecret: 'test-only-secret' },
  readBody: async (req) => req.body || {},
  getSession: (req) => req.session || null,
  isAdminSession: (session) => session?.role === 'admin',
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
  getPlanValidity: () => ({ validTo: null, expired: false }),
  createMiniappSession: (userId, identityKey) => `miniapp-token:${userId}:${identityKey}`,
  findRegByEmail: async () => null,
  findUserByPhone: async () => null,
  verifyPassword: () => false,
  verifyPhoneCode: async () => ({ ok: true }),
};
const session = { userId: 'u_keeper', role: 'user', client: 'miniapp', identityKey: 'wxmini_identity_testwx' };
const callBindPhone = async (body, kvResult, extraDeps = {}) => {
  const KV = {
    async kvGet(key) { return store.get(key) ?? null; },
    async kvPut(key, value) { store.set(key, value); return true; },
    ...(kvResult === 'missing' ? {} : { async kvBindPhoneToAccount() { return kvResult; } }),
  };
  const res = makeResponse();
  await handleMiniappAuth(
    { method: 'POST', headers: { 'x-request-id': 'bind-phone-001' }, session, body },
    res,
    new URL('http://local/api/miniapp/v1/auth/bind-phone'),
    { ...baseDeps, KV, ...extraDeps },
  );
  return res;
};

// ② 空壳自动并 → 200，且必须告诉客户端 bindingRequired=false（门禁解除）
const okRes = await callBindPhone({ phone: '13800000001', code: '1234' },
  { ok: true, userId: 'u_keeper', phone: '13800000001', merged: true, previousOwnerId: 'u_shell' });
assert.equal(okRes.statusCode, 200, '绑定成功必须 200');
assert.equal(okRes.body.data.bindingRequired, false, '绑定成功后门禁标记必须解除');
assert.equal(okRes.body.data.merged, true, '自动并掉空壳时要如实上报 merged，便于排查');

// ③ 号码属于有资产的账号 → 409 + 客户端可据以引导「绑定已有账号」的错误码
const conflictRes = await callBindPhone({ phone: '13800000003', code: '1234' },
  { ok: false, reason: 'phone_owned_by_other', ownerUserId: 'u_rich' });
assert.equal(conflictRes.statusCode, 409, '号码被有资产账号占用必须 409');
assert.equal(conflictRes.body.error.code, 'PHONE_OWNED_BY_OTHER_ACCOUNT');
assert.ok(!String(conflictRes.body.error.code).startsWith('SESSION_'), '不得用会让客户端触发静默重登的错误码');

// 会话有效但账号记录已不在 → 401（复用客户端重登 + 登录侧孤儿自愈）
const staleRes = await callBindPhone({ phone: '13800000004', code: '1234' },
  { ok: false, reason: 'user_not_found' });
assert.equal(staleRes.statusCode, 401, '账号记录缺失必须 401，客户端才能静默重登自愈');
assert.equal(staleRes.body.error.code, 'USER_AUTH_REQUIRED');

// 其它失败 → 400，不得泄漏内部原因
const failedRes = await callBindPhone({ phone: '13800000005', code: '1234' }, { ok: false, reason: 'invalid_phone' });
assert.equal(failedRes.statusCode, 400);
assert.equal(failedRes.body.error.code, 'PHONE_BIND_FAILED');

// KV 层缺方法（老服务端副本）→ 500，而不是静默返回 200
const missingRes = await callBindPhone({ phone: '13800000006', code: '1234' }, 'missing');
assert.equal(missingRes.statusCode, 500);
assert.equal(missingRes.body.error.code, 'PHONE_BIND_UNAVAILABLE');

// 验证码不对 → 400（不是 401：客户端把任意 401 判为「登录态失效」会静默重登再重试一次）
const badCodeRes = await callBindPhone({ phone: '13800000007', code: '0000' },
  { ok: true, userId: 'u_keeper', phone: '13800000007' },
  { verifyPhoneCode: async () => ({ ok: false, message: '验证码错误或已过期' }) });
assert.equal(badCodeRes.statusCode, 400, '验证码不对必须 400：用 401 会触发客户端无谓的静默重登');
assert.equal(badCodeRes.body.error.code, 'PHONE_CODE_INVALID');

// 手机号格式非法 → 400
const badPhoneRes = await callBindPhone({ phone: '12345', code: '1234' }, { ok: true });
assert.equal(badPhoneRes.statusCode, 400);
assert.equal(badPhoneRes.body.error.code, 'INVALID_PHONE');

// ── 2b. P1-1 微信一键绑定：method='wechat' 的三条分支 ────────────────────────
//
// 这个能力把「证明这个号码是我的」从短信码换成了**微信侧验证过的号码**，
// 所以有两条红线必须钉住：
//   ① 号码只能来自微信换号结果，**绝不能取 body.phone** —— 否则客户端传
//      `{method:'wechat', phone:'别人的号'}` 就把短信那道「人证」整个绕过去了。
//   ② 任何失败都要能**退化到短信**（能力未开通 / 次数用尽 / 微信抖动），不能让用户卡死。
// 动态令牌来自 `<button open-type="getPhoneNumber">`，5 分钟有效、只能消费一次。
const callBindPhoneWechat = async ({ body, exchange, kvResult = { ok: true, userId: 'u_keeper' }, extraDeps = {} }) => {
  let bindArgs = null;
  const KV = {
    async kvGet(key) { return store.get(key) ?? null; },
    async kvPut(key, value) { store.set(key, value); return true; },
    async kvBindPhoneToAccount(args) { bindArgs = args; return kvResult; },
  };
  const deps = { ...baseDeps, KV, ...extraDeps };
  if (exchange) deps.exchangeWechatPhoneCode = exchange;
  const res = makeResponse();
  await handleMiniappAuth(
    { method: 'POST', headers: { 'x-request-id': 'bind-phone-wx' }, session, body },
    res,
    new URL('http://local/api/miniapp/v1/auth/bind-phone'),
    deps,
  );
  return { res, bindArgs };
};

// ① 成功：号码由微信换回 → 直接放行，无需短信码
let seenDynamicCode = null;
const wxOk = await callBindPhoneWechat({
  body: { method: 'wechat', code: 'DYN-OK' },
  exchange: async (code) => { seenDynamicCode = code; return { phone: '13800001234', countryCode: '86' }; },
  kvResult: { ok: true, userId: 'u_keeper', phone: '13800001234', merged: false },
});
assert.equal(seenDynamicCode, 'DYN-OK', '必须把 body.code（动态令牌）原样交给换号函数');
assert.equal(wxOk.res.statusCode, 200, '一键绑定成功必须 200');
assert.equal(wxOk.res.body.data.bindingRequired, false, '一键绑定成功后门禁必须解除');
assert.equal(wxOk.bindArgs.phone, '13800001234', '落库号码必须来自微信换号结果');

// 红线①：body 里塞的号码一律无效（否则等于让客户端自带号码绕过验证）
const wxSpoof = await callBindPhoneWechat({
  body: { method: 'wechat', code: 'DYN-OK', phone: '13900009999' },
  exchange: async () => ({ phone: '13800001235', countryCode: '86' }),
  kvResult: { ok: true, userId: 'u_keeper', phone: '13800001235' },
});
assert.equal(wxSpoof.bindArgs.phone, '13800001235',
  "method='wechat' 时必须忽略 body.phone —— 取信它等于绕过微信验证，把任意号码绑到自己名下");

// ② 令牌失效 / 已被消费 / 号码格式异常 → 400 + 原样错误码（客户端据此引导「重新点一次」）
for (const errorCode of ['WECHAT_PHONE_CODE_REQUIRED', 'WECHAT_PHONE_CODE_INVALID', 'WECHAT_PHONE_INVALID_NUMBER']) {
  const thrown = new Error('令牌不好使');
  thrown.code = errorCode;
  const badToken = await callBindPhoneWechat({
    body: { method: 'wechat', code: 'DYN-BAD' },
    exchange: async () => { throw thrown; },
  });
  assert.equal(badToken.res.statusCode, 400, `${errorCode} 必须 400（回 401 会被客户端判成登录态失效而静默重登）`);
  assert.equal(badToken.res.body.error.code, errorCode, '400 必须原样回传语义错误码，客户端才能分辨原因');
  assert.equal(badToken.bindArgs, null, '取号失败时绝不能落库');
}

// ③ 能力未开通 / 微信侧不可用 → 503（客户端据此退化到短信，绝不让用户卡死）
const downThrown = new Error('微信侧繁忙');
downThrown.code = 'WECHAT_PHONE_UNAVAILABLE';
const wxDown = await callBindPhoneWechat({
  body: { method: 'wechat', code: 'DYN-X' },
  exchange: async () => { throw downThrown; },
});
assert.equal(wxDown.res.statusCode, 503, '一键绑定不可用必须 503，客户端才能退回短信');
assert.equal(wxDown.res.body.error.code, 'WECHAT_PHONE_UNAVAILABLE');
assert.equal(wxDown.bindArgs, null);

// 服务端版本差：老调用方没注入换号函数 → 同样 503（不能崩、也不能误判成「号码错误」）
const notWired = await callBindPhoneWechat({ body: { method: 'wechat', code: 'DYN-X' } });
assert.equal(notWired.res.statusCode, 503, 'deps 缺 exchangeWechatPhoneCode 时必须 503');
assert.equal(notWired.res.body.error.code, 'WECHAT_PHONE_UNAVAILABLE');

// 认不出的 method → 400。绝不能静默当成短信：那样会拿着空 phone 去发码/建号
const badMethod = await callBindPhoneWechat({ body: { method: 'face', phone: '13800000001', code: '1234' } });
assert.equal(badMethod.res.statusCode, 400, '未知 method 必须明确拒绝，不能静默退化');
assert.equal(badMethod.res.body.error.code, 'INVALID_BIND_METHOD');
assert.equal(badMethod.bindArgs, null);

// 缺省 method（线上 0.1.2 客户端）→ 仍走短信路径，行为与上线前逐字节一致
const legacy = await callBindPhoneWechat({
  body: { phone: '13800000088', code: '1234' },
  kvResult: { ok: true, userId: 'u_keeper', phone: '13800000088' },
});
assert.equal(legacy.res.statusCode, 200, '不带 method 的老客户端必须仍走短信路径');
assert.equal(legacy.bindArgs.phone, '13800000088');

// 缺省 method + 验证码不对 → 仍是原错误码（不得因为新增分支而改变老路径语义）
const legacyBad = await callBindPhoneWechat({
  body: { phone: '13800000089', code: '0000' },
  kvResult: { ok: true },
  extraDeps: { verifyPhoneCode: async () => ({ ok: false, message: '验证码错误或已过期' }) },
});
assert.notEqual(legacyBad.res.statusCode, 200, '缺省路径的验证码校验不得被新分支削弱');
assert.equal(legacyBad.res.body.error.code, 'PHONE_CODE_INVALID');

// 未登录 / 网页会话 → 不得走小程序补手机号端点
const anonRes = makeResponse();
await handleMiniappAuth(
  { method: 'POST', headers: {}, body: { phone: '13800000008', code: '1234' } },
  anonRes,
  new URL('http://local/api/miniapp/v1/auth/bind-phone'),
  { ...baseDeps, KV: { async kvGet() { return null; } } },
);
assert.equal(anonRes.statusCode, 401, '未登录必须 401');
const webRes = makeResponse();
await handleMiniappAuth(
  { method: 'POST', headers: {}, session: { userId: 'u_keeper', role: 'user', client: 'web' }, body: { phone: '13800000008', code: '1234' } },
  webRes,
  new URL('http://local/api/miniapp/v1/auth/bind-phone'),
  { ...baseDeps, KV: { async kvGet() { return null; } } },
);
assert.equal(webRes.statusCode, 403, '网页会话不能走小程序端点');
assert.equal(webRes.body.error.code, 'MINIAPP_SESSION_REQUIRED');

// ── 3. 真库层：事务内的冲突收敛（需要 better-sqlite3） ───────────────────────
let realDb = 'skipped';
try {
  await import('better-sqlite3');
  realDb = 'ran';
} catch {
  realDb = 'skipped';
}
if (realDb === 'ran') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-bind-phone-'));
  process.env.USUN_DATA_DIR = tmpDir; // kv-local.js 在模块加载时读它建库，必须早于 import
  const KV = await import('../server/kv-local.js');
  const account = async (id, patch = {}, userPatch = {}) => {
    await KV.kvPut('reg_' + id, { id, name: id, points: 0, balance: 0, role: 'user', status: 'active', ...patch });
    await KV.kvPut('user_' + id, { id, name: id, points: 0, balance: 0, role: 'user', status: 'active', ...userPatch });
  };

  await account('u_keeper');
  await account('u_keeper2');

  // ① 空闲号码
  const free = await KV.kvBindPhoneToAccount({ phone: '13800000001', userId: 'u_keeper' });
  assert.equal(free.ok, true);
  assert.equal(free.merged, false);
  assert.equal((await KV.kvGet('reg_u_keeper')).phone, '13800000001', 'reg_ 是登录权威源，必须带 phone');
  assert.equal((await KV.kvGet('user_u_keeper')).phone, '13800000001', 'user_ 是展示源，也要带 phone');
  assert.equal(await KV.kvGet('phone_13800000001'), 'u_keeper');

  // ⑥ 重复绑自己的号码 → 幂等
  const again = await KV.kvBindPhoneToAccount({ phone: '13800000001', userId: 'u_keeper' });
  assert.equal(again.ok, true, '重复绑定必须幂等成功');
  assert.equal(again.merged, false);

  // ② 可回收空壳 → 自动并
  await account('u_shell', { phone: '13800000002', provider: 'phone' });
  await KV.kvPut('phone_13800000002', 'u_shell');
  const adopted = await KV.kvBindPhoneToAccount({ phone: '13800000002', userId: 'u_keeper2' });
  assert.equal(adopted.ok, true, '空壳占用的号码应当可以自动并');
  assert.equal(adopted.merged, true);
  assert.equal(adopted.previousOwnerId, 'u_shell');
  assert.equal(await KV.kvGet('phone_13800000002'), 'u_keeper2', '并完之后号码必须改指 keeper');
  assert.equal((await KV.kvGet('reg_u_shell')).status, 'merged', '空壳要标记 merged 而非物理删除（便于回溯）');
  assert.equal((await KV.kvGet('reg_u_shell')).mergedInto, 'u_keeper2');
  assert.equal((await KV.kvGet('user_u_shell')).status, 'merged');

  // ③ 有资产 → 拒绝，对方一动不动
  await account('u_rich', { phone: '13800000003' }, { points: 8888 });
  await KV.kvPut('phone_13800000003', 'u_rich');
  const rich = await KV.kvBindPhoneToAccount({ phone: '13800000003', userId: 'u_keeper' });
  assert.equal(rich.ok, false, '有资产账号的号码绝不允许被抢');
  assert.equal(rich.reason, 'phone_owned_by_other');
  assert.equal(await KV.kvGet('phone_13800000003'), 'u_rich', '失败时 phone_ 索引必须原样不动');
  assert.equal((await KV.kvGet('user_u_rich')).points, 8888, '对方资产不得被动');
  assert.equal((await KV.kvGet('user_u_rich')).status, 'active', '对方账号不得被标记 merged');
  assert.equal((await KV.kvGet('reg_u_keeper')).phone, '13800000001', '失败时 keeper 的号码不得被改写');

  // ④ 挂微信身份 → 拒绝（否则并完就是孤儿身份）
  await account('u_wx', { phone: '13800000004', provider: 'wechat-miniapp' });
  await KV.kvPut('phone_13800000004', 'u_wx');
  await KV.kvPut('wxmini_identity_testwx', {
    id: 'wxmini_identity_testwx', appId: 'wx4f071fbfd1e51130', openid: 'o_test',
    userId: 'u_wx', bindingState: 'unbound',
  });
  const wxOwned = await KV.kvBindPhoneToAccount({ phone: '13800000004', userId: 'u_keeper' });
  assert.equal(wxOwned.ok, false, '挂着微信身份的账号不能自动并：并完那个微信会永久登录失败');
  assert.equal(wxOwned.reason, 'phone_owned_by_other');
  assert.equal(await KV.kvGet('phone_13800000004'), 'u_wx');

  // ⑤ 能用邮箱登录 → 拒绝
  await account('u_mail', { phone: '13800000005', email: 'member@example.com', provider: 'email' });
  await KV.kvPut('phone_13800000005', 'u_mail');
  const mailOwned = await KV.kvBindPhoneToAccount({ phone: '13800000005', userId: 'u_keeper' });
  assert.equal(mailOwned.ok, false, '有邮箱的账号不能自动并：邮箱是另一条独立登录通道');
  assert.equal(mailOwned.reason, 'phone_owned_by_other');

  // 入参守卫
  assert.equal((await KV.kvBindPhoneToAccount({ phone: '123', userId: 'u_keeper' })).reason, 'invalid_phone');
  assert.equal((await KV.kvBindPhoneToAccount({ phone: '13800000009', userId: 'u_missing' })).reason, 'user_not_found');
  assert.equal(await KV.kvGet('phone_13800000009'), null, '账号不存在时不得留下半截索引');

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 三身份端到端验收 —— 本轮改造的验收本体
  //
  // 上面 1~3 段验的是「零件对不对」；这一段验「整条链路在三种真实的人身上跑通没有」：
  //   ① 全新微信用户        登录 → 三处门禁全拦 → 补手机号 → 三处全放行
  //   ② 已绑手机号的老微信  登录 → 三处一处都不拦（门禁不能误伤老用户）
  //   ③ 号码属有资产的别人  补号 409 → 改走「绑定已有账号」→ 换到原账号、资产原封不动
  //
  // ⚠️ 这一段必须在**真库**里跑：它验的恰恰是「登录写下的东西，门禁读得对不对」，
  // 桩 KV 各写各的，读不出这类错位（bindingState vs reg_.phone 就是这个坑）。
  // ═══════════════════════════════════════════════════════════════════════════
  const APP_ID = baseDeps.config.appId;
  const realDeps = {
    ...baseDeps,
    KV,
    // 与 index.mjs 的 findUserByPhone 同语义：先查 phone_ 索引，再取 reg_（登录权威源）。
    findUserByPhone: async (phone) => {
      const uid = await KV.kvGet('phone_' + String(phone || '').trim());
      if (!uid) return null;
      return KV.kvGet('reg_' + String(uid).replace(/[^a-zA-Z0-9_]/g, '_'));
    },
  };
  const agents = [{ id: 'a_free', name: '免费智能体', published: true, vip: false }];
  await KV.kvPut('workflows', [{ id: 'w_free', name: '免费工作流', published: true, vip: false }]);

  const hit = async (kind, path, session, opts = {}) => {
    const res = makeResponse();
    const req = {
      method: opts.method || 'POST',
      headers: { 'x-request-id': 'e2e', ...(opts.headers || {}) },
      session: session || null,
      body: opts.body || {},
    };
    const url = new URL('http://local' + path);
    // port 指向 1（必然拒连）：只为让「越过门禁」的那次请求就地失败，不会真的打到上游。
    const deps = { ...realDeps, port: 1, getAgents: () => agents };
    if (kind === 'runtime') await handleMiniappRuntime(req, res, url, deps);
    else if (kind === 'api') await handleMiniappApi(req, res, url, deps);
    else await handleMiniappAuth(req, res, url, deps);
    return res;
  };
  const loginAs = async (openid) => {
    const res = makeResponse();
    await handleMiniappAuth(
      { method: 'POST', headers: { 'x-request-id': 'e2e-login' }, body: { code: 'code_' + openid } },
      res,
      new URL('http://local/api/miniapp/v1/auth/login'),
      {
        ...realDeps,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ openid, unionid: '', session_key: 'sk_' + openid }),
        }),
      },
    );
    assert.equal(res.statusCode, 200, '微信静默登录必须成功：' + openid);
    return {
      res,
      session: {
        userId: res.body.data.user.id,
        role: 'user',
        client: 'miniapp',
        identityKey: identityStorageKeys(APP_ID, openid, '').identityKey,
      },
    };
  };
  const expectPhoneGated = (res, label) => {
    assert.equal(res.statusCode, 403,
      label + '：未绑手机号必须回 403（回 401 会被客户端判成「登录态失效」并静默重登，白跑一趟还掩盖真因）');
    assert.equal(res.body.error.code, 'PHONE_BIND_REQUIRED',
      label + '：必须回专属错误码，客户端才能弹「去绑定手机号」');
  };

  // ── 身份①：全新微信用户 ───────────────────────────────────────────────────
  const fresh = await loginAs('o_brand_new');
  assert.equal(fresh.res.body.data.bindingRequired, true, '全新用户身份未绑定');
  assert.equal(fresh.res.body.data.user.phoneBound, false,
    'phoneBound 是客户端门禁预判的依据，全新用户必须下发 false');
  assert.equal(fresh.res.body.data.user.points, 0, '新用户积分必须为 0（不赠送算力，铁律）');
  assert.ok(!fresh.res.body.data.user.phone, '全新用户的 reg_ 里不该凭空多出手机号');

  expectPhoneGated(
    await hit('runtime', '/api/miniapp/v1/agents/a_free/chat', fresh.session, { body: { messages: [] } }),
    'chat 门禁');
  // 带上合法幂等键：若门禁排在幂等键校验之后，这里会变成 202 而不是 403 —— 顺带把顺序也钉住。
  expectPhoneGated(
    await hit('runtime', '/api/miniapp/v1/workflows/w_free/tasks', fresh.session,
      { headers: { 'idempotency-key': 'e2e-fresh-1' }, body: { parameters: {} } }),
    'workflow 门禁');
  expectPhoneGated(
    await hit('api', '/api/miniapp/v1/recharge/order', fresh.session, { body: { packageId: 'pkg_e2e' } }),
    'recharge 门禁');

  // 补手机号（号码空闲，不是并任何人的账号）
  const freshBound = await hit('auth', '/api/miniapp/v1/auth/bind-phone', fresh.session,
    { body: { phone: '13911110001', code: '1234' } });
  assert.equal(freshBound.statusCode, 200, '号码空闲时必须绑定成功');
  assert.equal(freshBound.body.data.bindingRequired, false);
  assert.equal(freshBound.body.data.merged, false, '号码空闲时不该并任何账号');
  assert.equal(freshBound.body.data.user.phoneBound, true, '补号成功后必须立刻下发 phoneBound=true');
  assert.equal(await KV.kvGet('phone_13911110001'), fresh.session.userId, '号码索引必须指向本账号');

  const chatAfter = await hit('runtime', '/api/miniapp/v1/agents/a_free/chat', fresh.session, { body: { messages: [] } });
  assert.notEqual(chatAfter.body.error?.code, 'PHONE_BIND_REQUIRED', '补号后 chat 不得再被手机号门禁拦下');
  assert.notEqual(chatAfter.statusCode, 403, '补号后 chat 不得再回 403');
  const wfAfter = await hit('runtime', '/api/miniapp/v1/workflows/w_free/tasks', fresh.session, { body: { parameters: {} } });
  assert.equal(wfAfter.body.error?.code, 'IDEMPOTENCY_KEY_REQUIRED',
    '补号后 workflow 应当越过门禁走到幂等键校验 —— 同时证明门禁确实排在幂等键之前');
  const rcAfter = await hit('api', '/api/miniapp/v1/recharge/order', fresh.session,
    { body: { packageId: 'pkg_e2e_absent' } });
  assert.equal(rcAfter.body.error?.code, 'PACKAGE_NOT_FOUND',
    '补号后充值应当越过门禁走到套餐校验（不再被 403 拦下）');

  // ── 身份②：已绑手机号的老微信用户（门禁绝不能误伤） ────────────────────────
  // 手工造一个「老身份 + 老账号（带手机号）」的既成事实，等价于线上已跑过一轮的用户。
  const oldOpenid = 'o_old_bird';
  const oldIdentityKey = identityStorageKeys(APP_ID, oldOpenid, '').identityKey;
  await KV.kvPut(oldIdentityKey, {
    id: oldIdentityKey, appId: APP_ID, openid: oldOpenid, unionid: null,
    userId: 'u_wx', bindingState: 'bound',
  });
  await KV.kvPut(identityStorageKeys(APP_ID, '', '', 'u_wx').userIndexKey, oldIdentityKey);

  const oldBird = await loginAs(oldOpenid);
  assert.equal(oldBird.session.userId, 'u_wx', '老身份必须归到原账号，不得另建新账号');
  assert.equal(oldBird.res.body.data.isNewUser, false, '老身份不能再被当成新用户');
  assert.equal(oldBird.res.body.data.user.phoneBound, true, '已有手机号的老用户必须下发 phoneBound=true');

  const oldChat = await hit('runtime', '/api/miniapp/v1/agents/a_free/chat', oldBird.session, { body: { messages: [] } });
  assert.notEqual(oldChat.statusCode, 403, '已绑手机号的老用户不得被手机号门禁误伤（chat）');
  const oldWf = await hit('runtime', '/api/miniapp/v1/workflows/w_free/tasks', oldBird.session, { body: { parameters: {} } });
  assert.equal(oldWf.body.error?.code, 'IDEMPOTENCY_KEY_REQUIRED', '已绑手机号的老用户不得被门禁误伤（workflow）');
  const oldRc = await hit('api', '/api/miniapp/v1/recharge/order', oldBird.session,
    { body: { packageId: 'pkg_e2e_absent' } });
  assert.equal(oldRc.body.error?.code, 'PACKAGE_NOT_FOUND', '已绑手机号的老用户不得被门禁误伤（recharge）');

  // ── 身份③：号码属于另一个**有资产**的账号 ─────────────────────────────────
  await account('u_owner', { phone: '13911110003' }, { points: 500, balance: 12 });
  await KV.kvPut('phone_13911110003', 'u_owner');

  const stranger = await loginAs('o_stranger');
  const conflict = await hit('auth', '/api/miniapp/v1/auth/bind-phone', stranger.session,
    { body: { phone: '13911110003', code: '1234' } });
  assert.equal(conflict.statusCode, 409, '号码属于有资产的别人账号必须 409，绝不抢占');
  assert.equal(conflict.body.error.code, 'PHONE_OWNED_BY_OTHER_ACCOUNT',
    '必须是客户端能据以引导「绑定已有账号」的错误码');
  assert.ok(!String(conflict.body.error.code).startsWith('SESSION_'),
    '不得用会让客户端静默重登的错误码（重登也解决不了号码归属）');
  assert.equal(await KV.kvGet('phone_13911110003'), 'u_owner', '被拒时号码索引必须原样不动');
  assert.equal((await KV.kvGet('user_u_owner')).points, 500, '被拒时对方资产不得被动');
  assert.equal((await KV.kvGet('reg_u_owner')).status, 'active', '被拒时对方账号不得被标记 merged');
  assert.equal((await KV.kvGet('reg_' + stranger.session.userId)).status, 'active',
    '被拒时本账号也必须保持原样');

  // 正确出路：走 auth/bind 的「绑定已有账号」（会换 token、换 userId，回到原账号）
  const adoptedAccount = await hit('auth', '/api/miniapp/v1/auth/bind', stranger.session,
    { body: { method: 'phone', phone: '13911110003', code: '4321' } });
  assert.equal(adoptedAccount.statusCode, 200, '号码属于有资产账号时，正确出路是「绑定已有账号」并登录回原账号');
  assert.equal(adoptedAccount.body.data.token, 'miniapp-token:u_owner:' + stranger.session.identityKey,
    '换绑后 token 必须指向原账号');
  assert.equal(adoptedAccount.body.data.user.id, 'u_owner');
  assert.equal(adoptedAccount.body.data.user.points, 500, '并入后原账号资产必须原封不动');
  assert.equal(adoptedAccount.body.data.user.phoneBound, true, '原账号本来就绑了手机号，并入后仍是 true');
  assert.equal((await KV.kvGet('reg_u_owner')).status, 'active', '目标账号不得被标记 merged');
  assert.equal((await KV.kvGet('reg_' + stranger.session.userId)).status, 'merged',
    '临时空壳账号要标记 merged（留痕不删，便于回溯）');

  // 换绑之后，同一个微信再登录必须落在原账号上 —— 这才是「这个微信从此属于老账号」的证明
  const strangerAgain = await loginAs('o_stranger');
  assert.equal(strangerAgain.session.userId, 'u_owner', '换绑后同一微信再登录必须回到原账号');
  assert.equal(strangerAgain.res.body.data.isNewUser, false);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 下 WAL 可能仍被占用 */ }
}

console.log('miniapp bind phone check passed: 端点映射正确（含 method=wechat 三分支：成功 / 400 令牌 / 503 退化）；真库段=' + realDb
  + (realDb === 'ran'
    ? '（含三身份端到端：全新用户补号放行 / 老用户不误伤 / 号码被占改走绑定已有账号）'
    : '（真库缺失时只验端点与源码闸门，三身份端到端未跑，请在服务器上补跑一次全量）'));
