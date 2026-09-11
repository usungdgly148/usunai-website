/**
 * 生成一张「后台小程序设计画布」的静态快照 HTML。
 *
 * 用途：③④ 这两条要看的本来就是**样子**，光靠自测断言说服力不够。这个脚本用同一套
 * 真机组件 + 同一份生成样式（miniappPreview.css / adapter.css）SSR 出一张可以
 * 直接打开的单页 HTML，肉眼比对不用部署、不用开小程序开发者工具。
 *
 * 数据源：优先拉线上已发布的首页布局与公共内容（头像/封面都是真的），
 *         拉不到就退化成本地 fixture，脚本不会因此失败。
 *
 * 用法：node scripts/preview-canvas-snapshot.mjs [输出路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const ROOT = path.resolve(FRONTEND, '..');
const MINIAPP = path.join(ROOT, 'miniapp');
const TEMP = path.join(FRONTEND, '.preview-snapshot-entry');
const OUT = process.argv[2] || path.join(FRONTEND, '.preview', 'miniapp-canvas.html');

const ORIGIN = process.env.USUN_PREVIEW_ORIGIN || 'https://www.usunai.top';

/* --------------------------------------------------------------- 1. 取数据 */
async function fetchJson(pathname) {
  try {
    const response = await fetch(`${ORIGIN}${pathname}`, { signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    return body?.ok ? body.data : null;
  } catch (error) {
    console.warn(`[snapshot] 拉取 ${pathname} 失败，用本地 fixture：${error.message}`);
    return null;
  }
}

const FALLBACK_CONTENT = {
  agents: Array.from({ length: 6 }, (_v, i) => ({ id: `ag${i + 1}`, name: `示例智能体 ${i + 1}`, description: '帮助实体门店做短视频获客的 AI 助手', tags: ['获客'] })),
  workflows: Array.from({ length: 3 }, (_v, i) => ({ id: `wf${i + 1}`, name: `示例工作流 ${i + 1}`, description: '一键批量产出脚本', tags: ['提效'] })),
  categories: [{ id: 'c1', key: 'short-video', name: '短视频获客' }, { id: 'c2', key: 'private', name: '私域运营' }, { id: 'c3', key: 'geo', name: 'GEO 优化' }, { id: 'c-all', key: 'all', name: '全部' }],
  categoryGroups: [],
  banners: [],
  announcements: [{ id: 'a1', title: '欢迎体验友尚 AI · 新增 12 个装修建材获客智能体', publishedAt: new Date().toISOString() }],
  recommended: ['ag1', 'wf1', 'ag2', 'ag3', 'ag4', 'ag5', 'ag6'],
  computePackages: [],
  rechargeInfo: '',
  customerService: { enabled: false, qr: '', lines: [] },
};

const FALLBACK_LAYOUT = {
  page: 'home',
  blocks: [
    { id: 'carousel-1', type: 'carousel', visible: true, limit: 3, slides: [] },
    { id: 'announcements-1', type: 'announcements', visible: true, limit: 8 },
    { id: 'search-1', type: 'search', visible: true, limit: 8 },
    { id: 'categories-1', type: 'categories', visible: true, limit: 12, categoryImages: {} },
    { id: 'featured-agents-1', type: 'featured-agents', visible: true, limit: 6, dataSource: 'recommended' },
    { id: 'featured-workflows-1', type: 'featured-workflows', visible: true, limit: 4, dataSource: 'recommended' },
  ],
};

const [liveLayout, liveContent] = await Promise.all([
  fetchJson('/api/miniapp/v1/layout?page=home'),
  fetchJson('/api/miniapp/v1/content'),
]);
const layout = liveLayout || FALLBACK_LAYOUT;
const content = liveContent || FALLBACK_CONTENT;
console.log(`[snapshot] 布局来源：${liveLayout ? '线上已发布' : '本地 fixture'}；内容来源：${liveContent ? '线上公共内容' : '本地 fixture'}`);

/* --------------------------------------------------------------- 2. 渲染 */
fs.writeFileSync(`${TEMP}.mjs`, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MiniappStage from './src/miniapp-preview/index.jsx';
export { React, renderToStaticMarkup, MiniappStage };
`, 'utf8');

const built = await esbuild.build({
  entryPoints: [`${TEMP}.mjs`],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  target: 'node18',
  logLevel: 'warning',
  absWorkingDir: FRONTEND,
  // React 必须留 external，否则 react-dom 里运行期的 require('react') 会解出第二份 React
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  plugins: [{ name: 'css-stub', setup(build) { build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }],
  alias: {
    '@tarojs/components': path.join(FRONTEND, 'src/miniapp-preview/taro-components.jsx'),
    '@tarojs/taro': path.join(FRONTEND, 'src/miniapp-preview/taro.js'),
  },
  define: {
    __MINIAPP_ENV__: '"preview"',
    __MINIAPP_API_BASE__: '""',
    __MINIAPP_VERSION__: '"preview"',
    __MINIAPP_BUILD__: '"preview"',
  },
});
fs.writeFileSync(`${TEMP}.cjs`, built.outputFiles[0].text, 'utf8');
const { React, renderToStaticMarkup, MiniappStage } = require(`${TEMP}.cjs`);
fs.rmSync(`${TEMP}.mjs`, { force: true });
fs.rmSync(`${TEMP}.cjs`, { force: true });

const stage = renderToStaticMarkup(React.createElement(MiniappStage, { layout, content, active: 'home' }));

/* --------------------------------------------------------------- 3. 出页 */
const canvasCss = fs.readFileSync(path.join(FRONTEND, 'src/miniappPreview.css'), 'utf8');
const adapterCss = fs.readFileSync(path.join(FRONTEND, 'src/miniapp-preview/adapter.css'), 'utf8');

// 只补小程序/后台页面里本来就有的那几条基座（等价于后台的 Tailwind preflight），
// 别的一概不加 —— 否则这张快照就不是「真机 + 生成样式」的结果了
const baseCss = `
*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: currentColor; }
html { font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
body { margin: 0; }
img { display: block; max-width: 100%; }
`;
const chromeCss = `
body { background: #eef2f7; color: #0f172a; padding: 32px 16px 64px; }
.snap-head { max-width: 900px; margin: 0 auto 24px; }
.snap-head h1 { margin: 0; font-size: 20px; }
.snap-head p { margin: 6px 0 0; color: #475569; font-size: 13px; line-height: 1.7; }
.snap-head code { background: #e2e8f0; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.snap-wrap { display: flex; justify-content: center; }
.snap-phone { width: 375px; border-radius: 34px; box-shadow: 0 0 0 9px #0f172a, 0 18px 40px -10px rgba(15,23,42,.5); }
.snap-phone-inner { overflow: hidden; border-radius: 34px; background: #fff; }
.snap-notch { background: #fff; padding-top: 8px; }
.snap-notch-bar { width: 96px; height: 16px; margin: 0 auto; border-radius: 999px; background: #0f172a; }
.snap-notch-row { display: flex; align-items: center; justify-content: space-between; padding: 0 16px 4px; }
.snap-notch-row span:first-child { font-size: 10px; font-weight: 600; color: #64748b; }
.snap-notch-row span:last-child { border-radius: 999px; background: #eff6ff; color: #2563eb; font-size: 9px; font-weight: 500; padding: 2px 8px; }
.snap-note { max-width: 900px; margin: 40px auto 0; color: #475569; font-size: 12px; line-height: 1.8; }
.snap-note b { color: #0f172a; }
`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小程序设计画布 · 快照</title>
<style>${baseCss}</style>
<style>${canvasCss}</style>
<style>${adapterCss}</style>
<style>${chromeCss}</style>
</head>
<body>
<div class="snap-head">
  <h1>后台「小程序设计」手机画布 · 快照</h1>
  <p>这张页面里的手机屏之内，跑的是小程序真机组件本身（<code>LayoutBlocks</code> / <code>ContentCard variant=compact</code> / <code>MiniappTabBar</code>），样式来自 <code>miniapp/src/app.scss</code> 经生成器作用域化后的产物 —— 所以「画布＝真机」是构造性结果，不是照着画的。</p>
  <p>布局来源：${liveLayout ? '线上已发布布局' : '本地 fixture'}　·　内容来源：${liveContent ? '线上公共内容（头像即真实数据）' : '本地 fixture'}　·　生成时间：${new Date().toLocaleString('zh-CN')}</p>
</div>
<div class="snap-wrap">
  <div class="snap-phone">
    <div class="snap-phone-inner">
      <div class="snap-notch">
        <div class="snap-notch-bar"></div>
        <div class="snap-notch-row"><span>友尚AI 小程序</span><span>真机同款渲染</span></div>
      </div>
      ${stage}
    </div>
  </div>
</div>
<div class="snap-note">
  <p><b>怎么验：</b>手机屏里能滚到底部，底部悬浮玻璃胶囊就是真机那个自绘 TabBar（首页 / 智能体 / 工作流 / 资产 / 我的，5 个 PNG 图标 + 选中态蓝色气泡）。推荐智能体是单列毛玻璃紧凑卡（左圆形头像 + 右名称/简介），分类是 2 列 16:9 图卡 + 渐变遮罩文字。</p>
  <p><b>交互不在这张快照里：</b>点击与跳转读出行需要 React 运行时，只有在后台页面里才有。这个快照只证明「样子」一致。</p>
</div>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`[snapshot] 已写出 ${OUT}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);
