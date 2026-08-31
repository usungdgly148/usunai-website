import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleMiniappAuth, identityStorageKeys } from '../server/miniapp-auth.mjs';

const source = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const kvSource = fs.readFileSync(new URL('../server/kv-local.js', import.meta.url), 'utf8');
const store = new Map([
  ['reg_existing', { id: 'existing', email: 'member@example.com', password: 'valid-hash', name: '现有用户', role: 'user' }],
  ['user_existing', { id: 'existing', points: 5000, balance: 12, name: '现有用户' }],
]);

const KV = {
  async kvGet(key) { return store.get(key) ?? null; },
  async kvResolveWechatIdentity({ identityKey, unionKey, userIndexKey, identity, reg, user }) {
    if (store.has(identityKey)) return { ok: true, created: false, identity: store.get(identityKey) };
    store.set(identityKey, identity);
    store.set(userIndexKey, identityKey);
    if (unionKey) store.set(unionKey, identityKey);
    store.set('reg_' + reg.id, reg);
    store.set('user_' + user.id, user);
    return { ok: true, created: true, identity };
  },
  async kvBindWechatIdentity({ identityKey, currentUserId, targetUserId, currentUserIndexKey, targetUserIndexKey, updatedAt }) {
    const identity = store.get(identityKey);
    if (!identity || identity.userId !== currentUserId) return { ok: false, reason: 'identity_mismatch' };
    const existing = store.get(targetUserIndexKey);
    if (existing && existing !== identityKey) return { ok: false, reason: 'target_already_bound' };
    const updatedIdentity = { ...identity, userId: targetUserId, bindingState: 'bound', updatedAt };
    store.set(identityKey, updatedIdentity);
    store.set(targetUserIndexKey, identityKey);
    store.delete(currentUserIndexKey);
    return { ok: true, identity: updatedIdentity, reg: store.get('reg_' + targetUserId), user: store.get('user_' + targetUserId) };
  },
};

const makeResponse = () => ({
  statusCode: 200,
  headers: {},
  setHeader(key, value) { this.headers[key] = value; },
  end(raw) { this.body = JSON.parse(raw); },
});
const config = { appId: 'wx4f071fbfd1e51130', appSecret: 'test-only-secret' };
const fetchImpl = async (url) => {
  assert.ok(!String(url).includes('undefined'));
  return { ok: true, json: async () => ({ openid: 'openid-test', unionid: 'unionid-test', session_key: 'must-not-leak' }) };
};
const deps = {
  KV,
  config,
  fetchImpl,
  readBody: async (req) => req.body || {},
  getSession: (req) => req.session || null,
  isAdminSession: (session) => session?.role === 'admin',
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
  getPlanValidity: () => ({ validTo: null, expired: false }),
  createMiniappSession: (userId, identityKey) => `miniapp-token:${userId}:${identityKey}`,
  findRegByEmail: async (email) => email === 'member@example.com' ? store.get('reg_existing') : null,
  findUserByPhone: async () => null,
  verifyPassword: (password, stored) => password === 'correct-password' && stored === 'valid-hash',
  verifyPhoneCode: async () => ({ ok: false, message: 'invalid code' }),
};

const loginReq = { method: 'POST', headers: { 'x-request-id': 'stage2-login-001' }, body: { code: 'valid_login_code' } };
const loginRes = makeResponse();
assert.equal(await handleMiniappAuth(loginReq, loginRes, new URL('http://local/api/miniapp/v1/auth/login'), deps), true);
assert.equal(loginRes.statusCode, 200);
assert.equal(loginRes.body.data.isNewUser, true);
assert.equal(loginRes.body.data.bindingRequired, true);
assert.equal(loginRes.body.data.user.points, 0);
const serializedLogin = JSON.stringify(loginRes.body);
for (const secret of ['openid-test', 'unionid-test', 'session_key', 'test-only-secret']) assert.ok(!serializedLogin.includes(secret));

const identity = [...store.values()].find((value) => value?.openid === 'openid-test');
const repeatRes = makeResponse();
await handleMiniappAuth(loginReq, repeatRes, new URL('http://local/api/miniapp/v1/auth/login'), deps);
assert.equal(repeatRes.body.data.isNewUser, false);
assert.equal(repeatRes.body.data.user.id, identity.userId);

const wrongBindRes = makeResponse();
await handleMiniappAuth(
  { method: 'POST', headers: {}, session: { userId: identity.userId, role: 'user', client: 'miniapp', identityKey: identity.id }, body: { method: 'email', email: 'member@example.com', password: 'wrong' } },
  wrongBindRes,
  new URL('http://local/api/miniapp/v1/auth/bind'),
  deps,
);
assert.equal(wrongBindRes.statusCode, 401);

const bindRes = makeResponse();
await handleMiniappAuth(
  { method: 'POST', headers: {}, session: { userId: identity.userId, role: 'user', client: 'miniapp', identityKey: identity.id }, body: { method: 'email', email: 'member@example.com', password: 'correct-password' } },
  bindRes,
  new URL('http://local/api/miniapp/v1/auth/bind'),
  deps,
);
assert.equal(bindRes.statusCode, 200);
assert.equal(bindRes.body.data.user.id, 'existing');
assert.equal(bindRes.body.data.user.points, 5000);
assert.equal(bindRes.body.data.bindingRequired, false);

const webSessionRes = makeResponse();
await handleMiniappAuth(
  { method: 'GET', headers: {}, session: { userId: 'existing', role: 'user', client: 'web' } },
  webSessionRes,
  new URL('http://local/api/miniapp/v1/auth/status'),
  deps,
);
assert.equal(webSessionRes.statusCode, 403);
assert.equal(webSessionRes.body.error.code, 'MINIAPP_SESSION_REQUIRED');

const missingConfigRes = makeResponse();
await handleMiniappAuth(loginReq, missingConfigRes, new URL('http://local/api/miniapp/v1/auth/login'), { ...deps, config: { appId: config.appId, appSecret: '' } });
assert.equal(missingConfigRes.statusCode, 503);
assert.equal(missingConfigRes.body.error.code, 'MINIAPP_NOT_CONFIGURED');

assert.match(source, /handleMiniappAuth\(req, res, u/);
assert.match(source, /client: 'miniapp'/);
assert.match(source, /WECHAT_MINIAPP_APP_SECRET/);
assert.match(kvSource, /db\.transaction\(\(\) =>/);
assert.match(kvSource, /kvResolveWechatIdentity/);
assert.match(kvSource, /kvBindWechatIdentity/);
assert.deepEqual(Object.keys(identityStorageKeys(config.appId, 'openid-test')).sort(), ['identityKey', 'unionKey', 'userIndexKey']);

console.log('miniapp stage 2 auth: ok');
