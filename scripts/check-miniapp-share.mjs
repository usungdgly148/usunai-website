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
 * 所以这里逐页断言「页面源码里直接调用」，并用 `doesNotMatch` 把「包一层」的写法钉死。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ---- 2. utils/share.ts 是文案与落地路径的唯一来源 ----
assert.match(share, /export function shareTargets\(/, 'utils/share.ts 必须导出 shareTargets');
assert.match(share, /export const SHARE_HOME_PATH/, 'utils/share.ts 必须导出兜底落地页');
assert.match(share, /getCurrentInstance\(\)/, '落地路径必须取「当前页面（含 query）」——写死首页会让详情页/分类页分享出去时丢掉 id');
assert.match(share, /startsWith\('\/pages\/'\)/, '必须校验路径形态，否则会拼出打不开的落地页');
assert.match(share, /const BRAND = /, '标题必须统一带品牌名');
assert.match(share, /export interface ShareTarget/, '分享入参必须有显式类型');

// 说明：这里不再断言「share.ts 里没有 hook 字样」—— 文件头注释必然要提到这两个 API，
// 而按注释与代码分别匹配的护栏既脆又和上面的逐页断言重复（页面若真把 hook 挪走，逐页断言会先失败）。

console.log(`miniapp share contracts: ok（${pages.length} 个页面全部开启转发 + 朋友圈）`);
