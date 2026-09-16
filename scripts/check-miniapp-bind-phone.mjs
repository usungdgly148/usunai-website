import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleMiniappAuth } from '../server/miniapp-auth.mjs';

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

// 验证码不对 → 401，且绝不能已经动了号码
const badCodeRes = await callBindPhone({ phone: '13800000007', code: '0000' },
  { ok: true, userId: 'u_keeper', phone: '13800000007' },
  { verifyPhoneCode: async () => ({ ok: false, message: '验证码错误或已过期' }) });
assert.equal(badCodeRes.statusCode, 401, '验证码不对必须 401');
assert.equal(badCodeRes.body.error.code, 'PHONE_CODE_INVALID');

// 手机号格式非法 → 400
const badPhoneRes = await callBindPhone({ phone: '12345', code: '1234' }, { ok: true });
assert.equal(badPhoneRes.statusCode, 400);
assert.equal(badPhoneRes.body.error.code, 'INVALID_PHONE');

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

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 下 WAL 可能仍被占用 */ }
}

console.log('miniapp bind phone check passed: 端点映射正确；真库段=' + realDb
  + '（真库缺失时只验端点与源码闸门，请在服务器上补跑一次全量）');
