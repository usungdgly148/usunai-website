import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const appConfig = read('miniapp/src/app.config.ts');
const app = read('miniapp/src/app.tsx');
const api = read('miniapp/src/services/api.ts');
const taroConfig = read('miniapp/config/index.ts');
const projectConfig = JSON.parse(read('miniapp/project.config.json'));
const packageJson = JSON.parse(read('miniapp/package.json'));

const requiredPages = [
  'home', 'category', 'search', 'detail', 'profile',
  'compute', 'assets', 'orders', 'bind',
];
for (const page of requiredPages) {
  assert.match(appConfig, new RegExp(`pages/${page}/index`), `missing miniapp page: ${page}`);
  assert.ok(fs.existsSync(path.join(root, `miniapp/src/pages/${page}/index.tsx`)), `missing page source: ${page}`);
}

assert.equal(projectConfig.appid, 'wx4f071fbfd1e51130');
assert.equal(projectConfig.miniprogramRoot, 'dist/');
assert.equal(packageJson.scripts['build:weapp'], 'taro build --type weapp');
assert.ok(packageJson.devDependencies['@tarojs/webpack5-runner'], 'build runner must stay a development dependency');

assert.match(taroConfig, /https:\/\/www\.usunai\.top/);
assert.match(api, /__MINIAPP_API_BASE__/);
assert.match(api, /\/api\/miniapp\/v1\/auth\/login/);
assert.match(api, /\/api\/miniapp\/v1\/auth\/bind/);
assert.match(api, /CONTENT_CACHE_KEY/);
assert.match(api, /CONTENT_TTL/);
assert.match(api, /statusCode === 401/);
assert.match(app, /AppErrorBoundary/);
assert.match(app, /getUpdateManager/);

const recordPage = read('miniapp/src/components/records-page.tsx');
assert.match(api, /pageSize = 12/);
assert.match(recordPage, /usePullDownRefresh/);
assert.match(recordPage, /loadMore/);

const allSource = fs.readdirSync(path.join(root, 'miniapp/src'), { recursive: true })
  .filter((entry) => typeof entry === 'string' && /\.(?:ts|tsx)$/.test(entry))
  .map((entry) => read(path.join('miniapp/src', entry)))
  .join('\n');

assert.doesNotMatch(allSource, /WECHAT_MINIAPP_APP_SECRET/);
assert.doesNotMatch(allSource, /AppSecret\s*[:=]/i);
assert.doesNotMatch(allSource, /\/api\/admin\//);
assert.doesNotMatch(allSource, /system\s*prompt/i);

console.log('miniapp stage 3 UI contracts: ok');
