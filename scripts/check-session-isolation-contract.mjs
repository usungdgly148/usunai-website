import fs from 'node:fs';
import assert from 'node:assert/strict';

const store = fs.readFileSync(new URL('../frontend/src/store.jsx', import.meta.url), 'utf8');
const cozeApi = fs.readFileSync(new URL('../frontend/src/cozeApi.js', import.meta.url), 'utf8');
const adminWorkflowEdit = fs.readFileSync(new URL('../frontend/src/pages/AdminWorkflowEdit.jsx', import.meta.url), 'utf8');

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
