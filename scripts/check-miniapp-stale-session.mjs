import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleMiniappApi } from '../server/miniapp-api.mjs';

/**
 * 回归：小程序「孤儿身份」不得把用户永久卡在「用户不存在」页。
 *
 * 2026-09-16 线上事故：`/api/miniapp/v1/me` 在 reg_/user_ 记录缺失时返回
 * **404 USER_NOT_FOUND**，但小程序客户端只把「401 / SESSION_REFRESH_CODES 里的 403」
 * 判为可静默重登恢复（miniapp/src/services/api.ts 的 needsSessionRefresh），404 不在其中，
 * 而 ensureMiniappSession 默认复用本地缓存 token、不会主动重登
 * ⇒ 「重新加载」永远拿同一个旧 token 复现同一个 404，用户永久卡死。
 *
 * 修法：服务端改返回 401（复用登录侧已有的「孤儿身份自愈」，不重复造第二份自愈逻辑）。
 * 本脚本守住这个契约，防止有人「好心」把它改回 404。
 */

const apiSource = fs.readFileSync(new URL('../server/miniapp-api.mjs', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../miniapp/src/services/api.ts', import.meta.url), 'utf8');

const store = new Map([
  // 正常账号
  ['reg_u_ok', { id: 'u_ok', name: '正常用户', role: 'user' }],
  ['user_u_ok', { id: 'u_ok', points: 5000, balance: 0, name: '正常用户' }],
]);
const KV = {
  async kvGet(key) { return store.get(key) ?? null; },
  async kvPut(key, value) { store.set(key, value); return true; },
};

const makeResponse = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  end(raw) { this.body = JSON.parse(raw); },
});
const deps = {
  KV,
  getSession: (req) => req.session || null,
  isAdminSession: (session) => session?.role === 'admin',
  getPlanValidity: () => ({ validTo: null, expired: false }),
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
  readBody: async (req) => req.body || {},
  hashPassword: (value) => 'hash:' + value,
  verifyPassword: () => false,
};

const miniappSession = (userId) => ({
  userId, role: 'user', client: 'miniapp', identityKey: 'wxmini_identity_' + userId,
});
const callMe = async (session) => {
  const res = makeResponse();
  await handleMiniappApi(
    { method: 'GET', headers: { 'x-request-id': 'stale-session-me' }, session },
    res,
    new URL('http://local/api/miniapp/v1/me'),
    deps,
  );
  return res;
};

// ── 1. 账号记录缺失（孤儿身份）→ 必须 401，绝不能 404 ───────────────────────
const stale = await callMe(miniappSession('u_deleted'));
assert.equal(stale.statusCode, 401, '孤儿身份必须返回 401（404 会让客户端无法触发静默重登）');
assert.equal(stale.body.ok, false);
assert.equal(stale.body.error.code, 'USER_AUTH_REQUIRED', '错误码必须是客户端 SESSION_REFRESH_CODES 认识的码');
// 401 是客户端 needsSessionRefresh 的**无条件**恢复条件；再确认一次它没被改成条件判断
assert.match(clientSource, /statusCode === 401\)\s*return true/,
  '客户端必须对任意 401 判为可静默重登恢复');
assert.match(clientSource, /error\.statusCode === 404 && String\(error\.code \|\| ''\) === 'USER_NOT_FOUND'/,
  '客户端还要兜住「回滚到旧服务端仍返回 404」的情况');

// ── 2. 账号记录存在 → 正常 200 ───────────────────────────────────────────────
const ok = await callMe(miniappSession('u_ok'));
assert.equal(ok.statusCode, 200, '账号记录存在时 /me 必须正常返回');
assert.equal(ok.body.ok, true);
assert.equal(ok.body.data.points, 5000);

// ── 3. /profile 同样不得返回 404 ────────────────────────────────────────────
const profileRes = makeResponse();
await handleMiniappApi(
  { method: 'POST', headers: { 'x-request-id': 'stale-session-profile' }, session: miniappSession('u_deleted'), body: { name: '新名字' } },
  profileRes,
  new URL('http://local/api/miniapp/v1/profile'),
  deps,
);
assert.equal(profileRes.statusCode, 401, '/profile 在账号记录缺失时也必须返回 401');

// ── 4. 源码级守卫：不得再出现 404 USER_NOT_FOUND ───────────────────────────
assert.ok(!/'USER_NOT_FOUND'/.test(apiSource),
  'miniapp-api.mjs 不得再返回 USER_NOT_FOUND（会把用户永久卡在「用户不存在」页）');
assert.match(apiSource, /function sendStaleSession\(/, '「登录态失效」必须走共用的 sendStaleSession，保持唯一实现');
assert.match(apiSource, /sendJson\(res, 401, errorEnvelope\('USER_AUTH_REQUIRED', '登录态已失效，请重新进入'/,
  'sendStaleSession 必须返回 401 + USER_AUTH_REQUIRED');
assert.match(apiSource, /sendStaleSession\(res, requestId\);/, '两个调用点必须已切到 sendStaleSession');

// ── 5. 客户端重登链路仍然是「丢 token → 强制重登」 ──────────────────────────
assert.match(clientSource, /Taro\.removeStorageSync\(TOKEN_KEY\);\s*\n\s*return ensureMiniappSession\(true\)/,
  'refreshMiniappSession 必须先丢 token 再强制重登（否则旧 token 会被继续复用）');
assert.match(clientSource, /await refreshMiniappSession\(\);\s*\n\s*return rawRequest<T>\(path, options\)/,
  'apiRequest 必须在重登后原样重试一次');

console.log('miniapp stale session check passed: 孤儿身份返回 401 且客户端可静默自愈，不再卡「用户不存在」');
