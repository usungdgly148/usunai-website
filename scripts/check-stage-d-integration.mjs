import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-stage-d-'));
const kvDir = path.join(tempDir, 'kv');
fs.mkdirSync(kvDir, { recursive: true });

const nonce = crypto.randomBytes(12).toString('hex');
const adminPassword = `admin-${nonce}`;
const userPassword = `user-${nonce}`;
const email = `stage-d-${nonce}@example.test`;
const cozeToken = `pat_${crypto.randomBytes(24).toString('hex')}`;

const writeSeed = (key, value) => {
  fs.writeFileSync(path.join(kvDir, `${key}.json`), JSON.stringify(value, null, 2));
};

writeSeed('adminPassword', adminPassword);
writeSeed('agents', [
  { id: 'coze-new-test', platform: 'coze-new', baseUrl: 'https://example.invalid', projectId: 'project-test', apiKey: cozeToken },
  { id: 'coze-old-test', platform: 'coze-old', baseUrl: 'https://api.coze.cn', botId: 'bot-test', authProviderId: 'coze-oauth-test' },
  { id: 'deepseek-test', platform: 'deepseek-native', model: 'deepseek-v4-flash', authProviderId: 'deepseek-provider-test', thinkingEnabled: true },
]);
writeSeed('workflows', [{ id: 'workflow-test', platform: 'coze', workflowId: 'workflow-provider-test', published: true }]);
writeSeed('computePackages', [{ id: 'package-basic', name: 'Test package', points: 120, validDays: 7, published: true, price: 0 }]);
writeSeed('authProviders', []);

const reservePort = () => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const port = await reservePort();
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    USUN_DATA_DIR: tempDir,
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    WECHAT_MODE: 'mock',
    DYPNS_MODE: 'mock',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
const collect = (chunk) => {
  serverLog = (serverLog + chunk.toString()).slice(-12000);
};
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const baseUrl = `http://127.0.0.1:${port}`;
const request = async (url, { token, method = 'GET', body } = {}) => {
  const response = await fetch(baseUrl + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
};

const waitForHealth = async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early (${child.exitCode})`);
    try {
      const result = await request('/api/health');
      if (result.status === 200) return;
    } catch { /* server not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('test server did not become healthy');
};

const idsFrom = (keys, prefix) => (keys || []).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));

try {
  await waitForHealth();

  const anonymousKeys = await request('/api/data/list-keys');
  assert.equal(anonymousKeys.status, 200);
  assert.deepEqual(Object.values(anonymousKeys.data.keys).flat(), [], 'anonymous users must not see record keys');

  const registered = await request('/api/auth/email-register', { method: 'POST', body: { email, password: userPassword } });
  assert.equal(registered.status, 200);
  assert.equal(registered.data.ok, true);
  assert.ok(registered.data.token);
  const userId = registered.data.user.id;
  const tokenA = registered.data.token;

  const loggedIn = await request('/api/auth/email-login', { method: 'POST', body: { email, password: userPassword } });
  assert.equal(loggedIn.data.ok, true);
  const tokenB = loggedIn.data.token;

  const history = {
    id: `history-${nonce}`,
    userId,
    type: 'agent',
    agentId: 'coze-new-test',
    title: 'Stage D cross-device history',
    createdAt: new Date().toISOString(),
  };
  const savedHistory = await request('/api/single-key/history/put', { token: tokenA, method: 'POST', body: { record: history } });
  assert.equal(savedHistory.data.ok, true);

  const keysOnSecondSession = await request('/api/data/list-keys', { token: tokenB });
  assert.ok(keysOnSecondSession.data.keys.history.includes(savedHistory.data.key), 'second session must see newly saved history');
  const loadedHistory = await request('/api/data/get-records', {
    token: tokenB,
    method: 'POST',
    body: { type: 'history', ids: [history.id] },
  });
  assert.equal(loadedHistory.data.items[0].id, history.id);

  const asset = { id: `asset-${nonce}`, type: 'text', title: 'Stage D asset', content: 'safe local test payload', createdAt: new Date().toISOString() };
  const savedAsset = await request('/api/data/assets', { token: tokenA, method: 'POST', body: { item: asset } });
  assert.equal(savedAsset.status, 200);
  assert.equal(savedAsset.data.ok, true);
  const loadedAssets = await request('/api/data/assets', { token: tokenB });
  assert.equal(loadedAssets.data.items.find((item) => item.id === asset.id)?.userId, userId, 'asset must persist for the same user across sessions');

  const deniedForeignWrite = await request('/api/single-key/history/put', {
    token: tokenA,
    method: 'POST',
    body: { record: { ...history, id: `foreign-${nonce}`, userId: 'another-user' } },
  });
  assert.equal(deniedForeignWrite.status, 403);

  const adminLogin = await request('/api/auth/admin-login', { method: 'POST', body: { password: adminPassword } });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.data.ok, true);
  const adminToken = adminLogin.data.token;

  const metadata = await request('/api/admin/agents/coze-new-test', { token: adminToken });
  assert.equal(metadata.status, 200);
  assert.equal(metadata.data.hasToken, true);
  assert.equal(metadata.data.apiKey, '', 'metadata endpoint must never expose the real API token');
  assert.ok(!JSON.stringify(metadata.data).includes(cozeToken));

  const revealed = await request('/api/admin/agents/coze-new-test/reveal-token', { token: adminToken });
  assert.equal(revealed.data.apiKey, cozeToken, 'explicit admin reveal endpoint remains available');

  const requestId = `adjust-${nonce}`;
  const adjusted = await request('/api/admin/users/adjust-points', {
    token: adminToken,
    method: 'POST',
    body: { userId, amount: 1, requestId, packageInfo: { id: 'package-basic' }, adminName: 'Stage D' },
  });
  assert.equal(adjusted.status, 200);
  assert.equal(adjusted.data.ok, true);
  assert.equal(adjusted.data.points, 120, 'server package points must be authoritative');
  assert.equal(adjusted.data.user.planValidDays, 7);

  const duplicateAdjustment = await request('/api/admin/users/adjust-points', {
    token: adminToken,
    method: 'POST',
    body: { userId, amount: 999, requestId, packageInfo: { id: 'package-basic' }, adminName: 'Stage D' },
  });
  assert.equal(duplicateAdjustment.data.duplicate, true);
  assert.equal(duplicateAdjustment.data.points, 120, 'idempotent retry must not add points twice');

  const refreshedUser = await request('/api/auth/me', { token: tokenB });
  assert.equal(refreshedUser.data.user.points, 120);
  assert.equal(refreshedUser.data.user.planValidDays, 7);

  const recordKeys = await request('/api/data/list-keys', { token: tokenB });
  const computeIds = idsFrom(recordKeys.data.keys.computes, 'compute_');
  const orderIds = idsFrom(recordKeys.data.keys.orders, 'order_');
  assert.equal(computeIds.length, 1, 'adjustment must create one compute record');
  assert.equal(orderIds.length, 1, 'adjustment must create one order record');

  const loggedOut = await request('/api/auth/logout', { token: tokenA, method: 'POST', body: {} });
  assert.equal(loggedOut.data.ok, true);
  const revokedSession = await request('/api/auth/me', { token: tokenA });
  assert.equal(revokedSession.status, 401, 'logout must revoke the session');
  const otherSessionStillWorks = await request('/api/auth/me', { token: tokenB });
  assert.equal(otherSessionStillWorks.status, 200, 'logging out one device must not revoke another session');

  console.log('Stage D isolated integration check passed: auth, cross-device history, assets, admin token isolation, points, validity, compute/order records, and logout.');
} catch (error) {
  console.error(error.stack || error.message || error);
  if (serverLog) console.error('\nTest server output (secrets omitted by server):\n' + serverLog);
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 3000).unref();
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
}
