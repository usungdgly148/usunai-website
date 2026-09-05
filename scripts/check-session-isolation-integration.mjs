import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-session-isolation-'));
const kvDir = path.join(dataDir, 'kv');
fs.mkdirSync(kvDir, { recursive: true });

const testUserId = 'session_test_user';
const testEmail = 'session-test@example.invalid';
const testUserPassword = 'user-test-password';
const testAdminPassword = 'admin-test-password';
const testSessionSecret = ['session', 'isolation', 'test', 'secret'].join('-');
const testConfigEncryptionKey = ['session', 'isolation', 'config', 'test', 'secret'].join('-');
const testProviderToken = ['test', 'only', 'provider', 'token'].join('-');
const legacyHash = (password) => {
  let hash = 0;
  for (const char of password) { hash = (hash << 5) - hash + char.charCodeAt(0); hash |= 0; }
  return `p${hash}`;
};
const writeKv = (key, value) => fs.writeFileSync(path.join(kvDir, `${key}.json`), JSON.stringify(value));

writeKv('adminPassword', testAdminPassword);
writeKv(`reg_${testUserId}`, {
  id: testUserId,
  email: testEmail,
  name: 'Session Test User',
  password: legacyHash(testUserPassword),
  role: 'user',
  status: 'active',
});
writeKv(`user_${testUserId}`, {
  id: testUserId,
  email: testEmail,
  name: 'Session Test User',
  role: 'user',
  status: 'active',
  points: 100,
});
writeKv('authProviders', [{
  id: 'oauth-test',
  type: 'oauth',
  name: 'OAuth Test',
  clientId: 'public-client-id',
  keyId: 'public-key-id',
  privateKey: 'test-only-private-key',
  clientSecret: 'test-only-client-secret',
  accessToken: 'test-only-access-token',
  refreshToken: 'test-only-refresh-token',
  token: testProviderToken,
}]);

const port = 19000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    USUN_DATA_DIR: dataDir,
    SESSION_SECRET: testSessionSecret,
    CONFIG_ENCRYPTION_KEY: testConfigEncryptionKey,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput += String(chunk); });
child.stderr.on('data', chunk => { serverOutput += String(chunk); });

const request = async (pathname, { token, method = 'GET', body } = {}) => {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* response body is not JSON */ }
  return { response, text, data };
};

const waitForServer = async () => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early\n${serverOutput}`);
    try {
      await fetch(baseUrl + '/api/data/get-config');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`test server did not start\n${serverOutput}`);
};

try {
  await waitForServer();
  const adminLogin = await request('/api/auth/admin-login', {
    method: 'POST', body: { password: testAdminPassword },
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.data.ok, true);
  assert.ok(adminLogin.data.token);

  const userLogin = await request('/api/auth/email-login', {
    method: 'POST', body: { email: testEmail, password: testUserPassword },
  });
  assert.equal(userLogin.response.status, 200);
  assert.equal(userLogin.data.ok, true);
  assert.ok(userLogin.data.token);

  const adminToken = adminLogin.data.token;
  const userToken = userLogin.data.token;

  for (const [pathname, method, body] of [
    ['/api/data/list-keys', 'GET'],
    ['/api/blob/upload-url', 'POST', { name: 'test.png', contentType: 'image/png' }],
    ['/api/single-key/users/put', 'POST', { record: { id: testUserId } }],
    ['/api/auth/change-password', 'POST', { oldPassword: 'x', newPassword: 'new-password' }],
    ['/api/coze/chat', 'POST', { agentId: 'missing' }],
  ]) {
    const result = await request(pathname, { token: adminToken, method, body });
    assert.equal(result.response.status, 403, `admin session must be rejected by ${pathname}`);
  }

  for (const [pathname, method, body] of [
    ['/api/admin/data/list-keys', 'GET'],
    ['/api/admin/blob/upload-url', 'POST', { name: 'test.png', contentType: 'image/png' }],
    ['/api/admin/single-key/users/put', 'POST', { record: { id: testUserId } }],
  ]) {
    const result = await request(pathname, { token: userToken, method, body });
    assert.ok(result.response.status === 401 || result.response.status === 403, `user session must be rejected by ${pathname}`);
  }

  assert.equal((await request('/api/admin/data/list-keys', { token: adminToken })).response.status, 200);
  assert.equal((await request('/api/data/list-keys', { token: userToken })).response.status, 200);
  assert.equal((await request('/api/data/get-config', { token: adminToken })).response.status, 403);

  const adminConfig = await request('/api/admin/data/get-config', { token: adminToken });
  assert.equal(adminConfig.response.status, 200);
  for (const secret of ['test-only-private-key', 'test-only-client-secret', 'test-only-access-token', 'test-only-refresh-token', testProviderToken]) {
    assert.ok(!adminConfig.text.includes(secret), `admin config leaked ${secret}`);
  }
  assert.equal(adminConfig.data.data.authProviders[0].hasPrivateKey, true);

  const publicConfig = await request('/api/data/get-config');
  assert.equal(publicConfig.response.status, 200);
  assert.ok(!publicConfig.text.includes('test-only-private-key'));

  console.log('session isolation integration: ok');
} finally {
  child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 3000).unref();
  });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
