import fs from 'node:fs';
import assert from 'node:assert/strict';

const store = fs.readFileSync(new URL('../frontend/src/store.jsx', import.meta.url), 'utf8');
const cozeApi = fs.readFileSync(new URL('../frontend/src/cozeApi.js', import.meta.url), 'utf8');
const adminWorkflowEdit = fs.readFileSync(new URL('../frontend/src/pages/AdminWorkflowEdit.jsx', import.meta.url), 'utf8');
const singleKeySync = fs.readFileSync(new URL('../frontend/src/singleKeySync.js', import.meta.url), 'utf8');
const blobUpload = fs.readFileSync(new URL('../frontend/src/blobUpload.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');

const section = (start, end) => {
  const from = store.indexOf(start);
  const to = store.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section: ${start}`);
  return store.slice(from, to);
};

const adminLogin = section('const adminLogin = async', 'const changeAdminPassword = async');
assert.match(adminLogin, /fetch\('\/api\/auth\/admin-login'/);
assert.doesNotMatch(adminLogin, /apiFetch\('\/api\/auth\/admin-login'/);
assert.doesNotMatch(adminLogin, /setToken\(''\)|clearToken\(\)|setTokenState\(''\)/);

const changeAdminPassword = section('const changeAdminPassword = async', 'const adminLogout =');
assert.match(changeAdminPassword, /adminFetch\('\/api\/auth\/admin-change-password'/);

const adminLogout = section('const adminLogout =', 'const updateUserProfile = async');
assert.match(adminLogout, /adminFetch\('\/api\/auth\/logout'/);
assert.match(adminLogout, /clearAdminToken\(\)/);
assert.doesNotMatch(adminLogout, /clearToken\(\)|setTokenState\(''\)/);

const userLogout = section('const logout =', 'const adminLogin = async');
assert.match(userLogout, /clearToken\(\)/);
assert.doesNotMatch(userLogout, /clearAdminToken\(\)|setAdminUser\(|setAdminUsers\(|setRegisteredUsers\(/);

const resetUserPassword = section('const adminResetUserPassword = async', '// ============ 我的资产');
assert.match(resetUserPassword, /adminFetch\('\/api\/auth\/admin-reset-password'/);

const refreshConfig = section('const refreshAllConfig = useCallback', '// 单 key 写回');
assert.match(refreshConfig, /adminFetch/);
assert.match(refreshConfig, /\/api\/admin\/data\/get-config/);
assert.match(refreshConfig, /\/api\/data\/get-config/);

assert.match(singleKeySync, /adminFetch/);
assert.match(singleKeySync, /\/api\/admin\/single-key\//);
assert.match(blobUpload, /admin \? '\/api\/admin\/blob' : '\/api\/blob'/);
assert.doesNotMatch(store, /localStorage\.(getItem|setItem)\('clone_auth_providers'/);
assert.doesNotMatch(store, /\/api\/data\/put-config/);

assert.match(server, /function requireUser\(/);
for (const route of [
  '/api/admin/data/list-keys',
  '/api/admin/data/get-config',
  '/api/admin/data/put-config',
  '/api/admin/data/get-records',
  '/api/admin/data/assets',
  '/api/admin/assets/delete',
  '/api/admin/blob/upload-url',
  '/api/admin/blob/upload',
  '/api/admin/compute/recharge',
]) {
  assert.ok(server.includes(route), `missing admin-only route: ${route}`);
}
assert.match(server, /const safe = redactSensitiveConfig\(provider\)/);
assert.match(server, /'token', 'authProviderId'/);

for (const route of [
  '/api/coze/workspaces',
  '/api/coze/workflow-list',
  '/api/coze/workflow-info',
  '/api/admin/auth-providers',
  '/api/coze/connect-info',
  '/api/coze/bots',
  '/api/coze/bot-detail',
]) {
  assert.match(cozeApi, new RegExp(`adminFetch\\('${route.replaceAll('/', '\\/')}'`));
}
assert.match(adminWorkflowEdit, /return \{ authProviderId: auth\.id, baseUrl: auth\.baseUrl \}/);
assert.match(adminWorkflowEdit, /authProviderId: auth\.id,[\s\S]{0,120}workflowId: wfId/);

console.log('session isolation contract: ok');
