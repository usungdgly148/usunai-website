import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  errorEnvelope,
  handleMiniappApi,
  paginate,
  parsePagination,
  sanitizePublicContent,
  successEnvelope,
} from '../server/miniapp-api.mjs';

const source = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const contract = fs.readFileSync(new URL('../.planning/2026-08-30-wechat-mini-program-planning/stage1_api_contract.md', import.meta.url), 'utf8');

const content = sanitizePublicContent({
  agents: [
    {
      id: 'a1', name: '公开智能体', published: true, opening: '你好', suggestedQuestions: ['怎么用'],
      systemPrompt: 'secret prompt', apiKey: 'secret', authProviderId: 'provider-1', baseUrl: 'https://secret.invalid',
    },
    { id: 'a2', name: '已下架智能体', published: false },
  ],
  workflows: [{
    id: 'w1', name: '公开工作流', published: true,
    formFields: [{ key: 'prompt', label: '提示词', default: '', apiKey: 'nested-secret' }],
    outputFields: [{ key: 'output', name: '结果' }],
    privateKey: 'secret', workflowId: 'secret-workflow-id', workspaceId: 'secret-space-id',
  }],
  categories: [{ id: 'c1', name: '分类', published: true, internalNote: 'not public' }],
  recommended: ['a1', 'a2', 'missing', 'w1'],
});

assert.deepEqual(content.agents.map((item) => item.id), ['a1']);
assert.deepEqual(content.workflows.map((item) => item.id), ['w1']);
assert.deepEqual(content.recommended, ['a1', 'w1']);
assert.equal(content.categories[0].internalNote, undefined);
for (const serialized of [JSON.stringify(content.agents), JSON.stringify(content.workflows)]) {
  for (const forbidden of ['secret prompt', 'secret-workflow-id', 'secret-space-id', 'nested-secret', 'provider-1', 'secret.invalid']) {
    assert.ok(!serialized.includes(forbidden), `public content leaked ${forbidden}`);
  }
}

const params = new URLSearchParams('page=2&pageSize=999');
assert.deepEqual(parsePagination(params), { page: 2, pageSize: 100 });
assert.deepEqual(parsePagination(new URLSearchParams('page=-1&pageSize=0')), { page: 1, pageSize: 12 });
assert.deepEqual(paginate([1, 2, 3, 4, 5], { page: 2, pageSize: 2 }), {
  items: [3, 4],
  pagination: { page: 2, pageSize: 2, total: 5, totalPages: 3 },
});

assert.equal(successEnvelope({}, 'request-1').ok, true);
assert.equal(errorEnvelope('TEST', 'test', 'request-1').error.code, 'TEST');
assert.match(source, /handleMiniappApi\(req, res, u/);
assert.match(source, /Idempotency-Key,X-Request-Id/);
assert.match(contract, /\/api\/miniapp\/v1/);
assert.match(contract, /Idempotency-Key/);
assert.match(contract, /systemPrompt/);

const data = new Map([
  ['agents', [{ id: 'a1', name: '公开智能体', published: true, systemPrompt: 'never-return' }]],
  ['workflows', []], ['categories', []], ['categoryGroups', []], ['banners', []], ['announcements', []], ['recommended', ['a1']],
  ['reg_u1', { id: 'u1', name: '测试用户', password: 'never-return' }],
  ['user_u1', { id: 'u1', points: 88, balance: 6, planValidFrom: '2026-08-30T00:00:00.000Z', planValidDays: 30 }],
  ['assets_u1', [{ id: 'asset-new', userId: 'u1', type: 'image', createdAt: '2026-08-30T02:00:00.000Z' }]],
  ['compute_u1_new', { id: 'compute-new', userId: 'u1', createdAt: '2026-08-30T02:00:00.000Z' }],
  ['compute_u2_other', { id: 'compute-other', userId: 'u2', createdAt: '2026-08-30T03:00:00.000Z' }],
]);
const KV = {
  kvGet: async (key) => data.get(key) ?? null,
  kvList: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
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
  getPlanValidity: () => ({ expired: false, validTo: '2026-09-29T00:00:00.000Z' }),
  sanitizeId: (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_'),
};

const contentRes = makeResponse();
assert.equal(await handleMiniappApi({ method: 'GET', headers: {} }, contentRes, new URL('http://local/api/miniapp/v1/content'), deps), true);
assert.equal(contentRes.statusCode, 200);
assert.ok(!JSON.stringify(contentRes.body).includes('never-return'));

const meRes = makeResponse();
await handleMiniappApi({ method: 'GET', headers: {}, session: { userId: 'u1', role: 'user', client: 'miniapp', identityKey: 'identity-u1' } }, meRes, new URL('http://local/api/miniapp/v1/me'), deps);
assert.equal(meRes.body.data.points, 88);
assert.equal(meRes.body.data.balance, 6);
assert.equal(meRes.body.data.password, undefined);

const recordsRes = makeResponse();
await handleMiniappApi({ method: 'GET', headers: {}, session: { userId: 'u1', role: 'user', client: 'miniapp', identityKey: 'identity-u1' } }, recordsRes, new URL('http://local/api/miniapp/v1/compute-records?page=1&pageSize=12'), deps);
assert.deepEqual(recordsRes.body.data.map((item) => item.id), ['compute-new']);
assert.equal(recordsRes.body.meta.total, 1);

const adminRes = makeResponse();
await handleMiniappApi({ method: 'GET', headers: {}, session: { userId: 'admin', role: 'admin' } }, adminRes, new URL('http://local/api/miniapp/v1/assets'), deps);
assert.equal(adminRes.statusCode, 403);
assert.equal(adminRes.body.error.code, 'USER_AUTH_REQUIRED');

const webSessionRes = makeResponse();
await handleMiniappApi({ method: 'GET', headers: {}, session: { userId: 'u1', role: 'user', client: 'web' } }, webSessionRes, new URL('http://local/api/miniapp/v1/me'), deps);
assert.equal(webSessionRes.statusCode, 403);
assert.equal(webSessionRes.body.error.code, 'MINIAPP_SESSION_REQUIRED');

const failureRes = makeResponse();
await handleMiniappApi(
  { method: 'GET', headers: {} },
  failureRes,
  new URL('http://local/api/miniapp/v1/content'),
  { ...deps, KV: { ...KV, kvGet: async () => { throw new Error('test failure'); } } },
);
assert.equal(failureRes.statusCode, 500);
assert.equal(failureRes.body.error.code, 'INTERNAL_ERROR');

console.log('miniapp stage 1 contracts: ok');
