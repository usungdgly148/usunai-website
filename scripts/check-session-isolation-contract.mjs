import fs from 'node:fs';
import assert from 'node:assert/strict';

const store = fs.readFileSync(new URL('../frontend/src/store.jsx', import.meta.url), 'utf8');

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

console.log('session isolation contract: ok');
