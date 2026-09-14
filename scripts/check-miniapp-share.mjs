/**
 * 小程序「转发 / 分享到朋友圈」契约。
 *
 * 为什么需要这个护栏：**漏接是静默的** —— 页面没注册原生 `onShareAppMessage` 时，
 * 右上角「…」里的「转发」只是灰着显示「当前页面不可转发」，不报错、不警告、控制台干净，
 * 只有用户点开菜单才看得见。而 Taro 的开启方式又反直觉：
 *
 *   `@tarojs/plugin-framework-react` 的 `addConfig()` 会**逐页扫源码 AST**，
 *   只有页面**自己的源码里**出现 `useShareAppMessage` / `useShareTimeline` 这两个**调用名**，
 *   才给该页注入 `component.enableShareAppMessage = true`。
 *   ⇒ 把 hook 包成 `useMiniappShare()` 再让页面调用 **不会生效**（扫不到那个名字）。
 *
 * 所以这里逐页断言「页面源码里直接调用」。
 *
 * 2026-09-13 起，分享卡片的三个变量（标题 / 落地路径 / 配图）改成后台「小程序设置」可配，
 * 于是链路变成四段：`server/miniapp-share.mjs`（归一化 + 校验）→ 后台页面（读写）→
 * 内容接口下发（`miniapp-api.mjs`）→ 小程序端（落缓存 + 同步取值）。
 * **四段里任意一段的字段名漂了，表现都是「后台改了没效果」**，所以这里一起钉住。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const appConfig = read('miniapp/src/app.config.ts');
const share = read('miniapp/src/utils/share.ts');

// ---- 1. app.config.ts 登记的每个页面都要开启转发 + 朋友圈 ----
const pages = [...appConfig.matchAll(/'(pages\/[a-z0-9-]+\/index)'/g)].map((match) => match[1]);
assert.ok(pages.length >= 18, `从 app.config.ts 只解析到 ${pages.length} 个页面，页面清单可能改过写法`);

for (const page of pages) {
  const file = `miniapp/src/${page}.tsx`;
  assert.ok(exists(file), `app.config.ts 登记的页面缺少源文件：${file}`);
  const source = read(file);

  assert.match(
    source,
    /import Taro, \{[^}]*\buseShareAppMessage\b[^}]*\} from '@tarojs\/taro';/,
    `${page}: 必须从 @tarojs/taro 直接 import useShareAppMessage（Taro 靠扫这个调用名开启转发）`,
  );
  assert.match(
    source,
    /import Taro, \{[^}]*\buseShareTimeline\b[^}]*\} from '@tarojs\/taro';/,
    `${page}: 必须从 @tarojs/taro 直接 import useShareTimeline`,
  );
  assert.match(source, /useShareAppMessage\(\(\) => share\.app\)/, `${page}: 缺少 useShareAppMessage 调用`);
  assert.match(source, /useShareTimeline\(\(\) => share\.timeline\)/, `${page}: 缺少 useShareTimeline 调用`);
  assert.match(source, /import \{ shareTargets \} from '\.\.\/\.\.\/utils\/share';/, `${page}: 分享文案必须统一取自 utils/share`);
}

// ---- 2. utils/share.ts 是取值来源：默认值 + 服务端配置的落点 ----
assert.match(share, /export function shareTargets\(/, 'utils/share.ts 必须导出 shareTargets');
assert.match(share, /export const SHARE_HOME_PATH/, 'utils/share.ts 必须导出兜底落地页');
assert.match(share, /getCurrentInstance\(\)/, '落地路径必须取「当前页面（含 query）」——写死首页会让详情页/分类页分享出去时丢掉 id');
assert.match(share, /startsWith\('\/pages\/'\)/, '必须校验路径形态，否则会拼出打不开的落地页');
assert.match(share, /const BRAND = /, '标题必须统一带品牌名');
assert.match(share, /export interface ShareTarget/, '分享入参必须有显式类型');
// 三个变量：后台配置优先，留空回退内置默认（缺任一条 = 「后台改了没效果」）
assert.match(share, /export function applyShareSettings/, 'utils/share.ts 必须导出 applyShareSettings（服务端配置落缓存）');
assert.match(share, /settings\.title \|\|/, '标题必须「后台配置优先、留空回退语境名」');
assert.match(share, /settings\.path \|\|/, '落地路径必须「后台配置优先、留空跟随当前页面」');
assert.match(share, /toMiniappUrl\(settings\.imageUrl\)/, '配图必须补全成绝对地址，否则卡片图加载不出来');
assert.match(share, /const SHARE_IMAGE_RE = /, '配图形态必须与 server/miniapp-share.mjs 同口径收敛（https 外链 / 本站图床）');
assert.match(share, /if \(!raw \|\| typeof raw !== 'object'\) return;/, 'applyShareSettings 收到空值必须直接返回：服务端回滚一版不能把本地已有配置清空');

// 说明：这里不断言「share.ts 里没有 hook 字样」—— 文件头注释必然要提到这两个 API，
// 而按注释与代码分别匹配的护栏既脆又和上面的逐页断言重复（页面若真把 hook 挪走，逐页断言会先失败）。

// ---- 3. 服务端纯函数：真单元测试（直接 import，无第三方依赖） ----
const shareModule = await import(pathToFileURL(path.join(root, 'server/miniapp-share.mjs')).href);

assert.equal(shareModule.SHARE_CONFIG_KV_KEY, 'miniappShareSettings', 'KV 键名是服务端读写与后台的公共契约，不能改');
assert.deepEqual(shareModule.normalizeShareSettings(null), { title: '', path: '', imageUrl: '' });
assert.deepEqual(shareModule.normalizeShareSettings(undefined), { title: '', path: '', imageUrl: '' });
assert.deepEqual(
  shareModule.normalizeShareSettings({ title: 123, path: [], imageUrl: {} }),
  { title: '', path: '', imageUrl: '' },
  '非字符串值必须收敛成空串（KV 里可能有历史脏数据）',
);
assert.equal(
  shareModule.normalizeShareSettings({ title: 'x'.repeat(200) }).title.length,
  shareModule.SHARE_TITLE_MAX,
  '读取侧对超长标题应截断（写入侧才报错）',
);
assert.equal(
  shareModule.normalizeShareSettings({ path: 'bad-path' }).path,
  '',
  '读取侧也要丢掉非法落地页（KV 被手工写坏时不能下发一个点不开的页面）',
);
assert.equal(shareModule.normalizeShareSettings({ path: '/pages/home/index' }).path, '/pages/home/index');

const badPaths = ['pages/home/index', '/pages/home', 'https://usunai.top/pages/home/index', '/pages/home/index#frag', '/pages/Home/index'];
for (const bad of badPaths) {
  assert.equal(shareModule.validateShareSettingsInput({ path: bad }).ok, false, `非法落地页必须被拒绝：${bad}`);
}
for (const good of ['/pages/home/index', '/pages/detail/index?id=abc&x=1']) {
  assert.equal(shareModule.validateShareSettingsInput({ path: good }).ok, true, `合法落地页被误拒：${good}`);
}
assert.equal(shareModule.validateShareSettingsInput({ title: 'x'.repeat(61) }).ok, false, '标题超 60 字必须拒绝');
assert.equal(shareModule.validateShareSettingsInput({ title: 'x'.repeat(60) }).ok, true, '标题正好 60 字应当允许');
assert.equal(shareModule.validateShareSettingsInput({ imageUrl: 'ftp://x/y.png' }).ok, false, '配图必须是 https 外链或本站图床');
assert.equal(
  shareModule.validateShareSettingsInput({ imageUrl: '/images/share.png' }).ok,
  false,
  '必须拒绝小程序包内相对路径：微信文档示例恰好是这种，照抄进后台只会得到一张不报错的破图',
);
assert.equal(
  shareModule.validateShareSettingsInput({ imageUrl: '/api/blob/serve?key=uploads/a.png' }).ok,
  true,
  '本站图床地址必须接受',
);
assert.equal(
  shareModule.normalizeShareSettings({ imageUrl: '/images/share.png' }).imageUrl,
  '',
  '读取侧也要丢掉不可加载的配图（退化成「截取当前页面」比一张破图好）',
);
assert.equal(shareModule.shareSettingsConfigured({}), false, '三项全空 = 未配置');
assert.equal(shareModule.shareSettingsConfigured({ title: '友尚AI' }), true);
assert.equal(shareModule.validateShareSettingsInput({ title: '  友尚AI  ' }).data.title, '友尚AI', '标题应 trim 后落库');

// ---- 4. 内容接口下发 ----
// 注意：对 server/index.mjs、miniapp-api.mjs 这类大文件用 assert.ok(re.test(...)) 而不是
// assert.match —— assert.match 失败时会把整份源码 dump 出来（上万字符），消息反被淹掉。
const api = read('server/miniapp-api.mjs');
assert.ok(
  /import \{ SHARE_CONFIG_KV_KEY, normalizeShareSettings \} from '\.\/miniapp-share\.mjs'/.test(api),
  'miniapp-api.mjs 必须 import 分享设置模块（2026-09-13 真踩过：漏 import 时 content 接口 500）',
);
assert.ok(/KV\.kvGet\(SHARE_CONFIG_KV_KEY\)/.test(api), 'content 路由必须真的去读分享设置的 KV');
assert.ok(/normalizeShareSettings\(config\.shareSettings\)/.test(api), 'sanitizePublicContent 必须下发 shareSettings（恒为三个字符串）');

// 光看源码不够：这里真的调一次（stage1 契约也 import 这个模块，但那是它在替我们兜底）。
const { sanitizePublicContent } = await import(pathToFileURL(path.join(root, 'server/miniapp-api.mjs')).href);
assert.deepEqual(
  sanitizePublicContent({}).shareSettings,
  { title: '', path: '', imageUrl: '' },
  '未配置分享时也必须下发三个空串（客户端按空串回退内置默认，不能是 undefined）',
);
assert.deepEqual(
  sanitizePublicContent({ shareSettings: { title: ' 友尚AI ', path: 'bad-path', imageUrl: 'https://x/y.png' } }).shareSettings,
  { title: '友尚AI', path: '', imageUrl: 'https://x/y.png' },
  '下发前必须归一化：标题 trim、非法落地页在这里就被丢掉（否则小程序会跳到打不开的页面）',
);

// ---- 5. 后台读写接口 ----
const serverSource = read('server/index.mjs');
assert.ok(
  /import \{[^}]*SHARE_CONFIG_KV_KEY[^}]*\} from '\.\/miniapp-share\.mjs'/.test(serverSource),
  'server/index.mjs 必须 import 分享设置模块（漏 import = 后台接口 500）',
);
const adminStart = serverSource.indexOf("'/api/admin/miniapp-share-settings'");
assert.ok(adminStart > 0, 'server/index.mjs 缺少 /api/admin/miniapp-share-settings 接口');
const adminTail = serverSource.slice(adminStart);
const adminStop = adminTail.indexOf("'/api/data/get-records'");
const adminBlock = adminStop > 0 ? adminTail.slice(0, adminStop) : adminTail.slice(0, 4000);
assert.ok(/requireAdmin\(req, res\)/.test(adminBlock), '分享设置接口必须校验管理员');
assert.ok(/validateShareSettingsInput\(body\)/.test(adminBlock), '保存前必须走服务端校验（不能只信前端）');
assert.ok(/KV\.kvPut\(SHARE_CONFIG_KV_KEY, checked\.data\)/.test(adminBlock), '保存必须写进分享设置的 KV 键');

// ---- 6. 后台页面：三个输入框与接口字段名 ----
const adminPage = read('frontend/src/pages/AdminMiniappSettings.jsx');
assert.ok(/adminFetch\('\/api\/admin\/miniapp-share-settings'\)/.test(adminPage), '后台必须读回分享设置');
assert.ok(
  /body: JSON\.stringify\(\{ title: shareTitle, path: sharePath, imageUrl: shareImageUrl \}\)/.test(adminPage),
  '后台保存必须提交 标题 / 路径 / 配图 三个字段（字段名与 server/miniapp-share.mjs 对齐）',
);

// ---- 7. 小程序端：内容拉到后落缓存 + 类型 ----
const clientApi = read('miniapp/src/services/api.ts');
assert.match(clientApi, /import \{ applyShareSettings \} from '\.\.\/utils\/share'/, 'services/api.ts 必须引入 applyShareSettings');
assert.match(clientApi, /applyShareSettings\(response\.data\.shareSettings\)/, '拉到内容时必须把 shareSettings 落缓存（分享回调是同步的，不能现发请求）');
assert.match(read('miniapp/src/types.ts'), /shareSettings: ShareSettings;/, 'PublicContent 必须声明 shareSettings 字段');

console.log(`miniapp share contracts: ok（${pages.length} 个页面开启转发 + 朋友圈；后台三变量链路 7 段全通）`);
