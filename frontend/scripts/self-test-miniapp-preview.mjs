/**
 * 后台「小程序设计」画布的自测。
 *
 * 要证明的是一件事：**画布跟真机一致，是构造性的，不是我肉眼比出来的。**
 * 所以这里不 mock 任何渲染器 —— 直接把 miniapp/src 里的真组件（LayoutBlocks /
 * ContentCard / MiniappTabBar）拉进来跑：
 *   1. 结构一致性：用 react-dom/server 把画布渲成 HTML，断言里面的 class 就是真机那套
 *      （紧凑卡 / 分类卡 / 悬浮胶囊底栏 / 各区块标题），并且断言旧的假画布痕迹已经消失。
 *   2. 行为一致性：直接调用 LayoutBlocks(...) 拿到元素树，**真按**分类卡与推荐卡的
 *      onClick，看 Taro 替身记录下来的跳转地址是不是我们配的那个。
 *
 * 用法：node scripts/self-test-miniapp-preview.mjs
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
const TEMP = path.join(FRONTEND, '.selftest-miniapp-preview');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
}

/* ------------------------------------------------------------------ 1. 打包 */
const entry = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MiniappStage, { describeTarget, normalizeContent } from './src/miniapp-preview/index.jsx';
import { LayoutBlocks } from '${MINIAPP.replace(/\\/g, '/')}/src/components/layout-blocks.tsx';
import { onPreviewNavigate } from './src/miniapp-preview/taro.js';

export { React, renderToStaticMarkup, MiniappStage, describeTarget, normalizeContent, LayoutBlocks, onPreviewNavigate };
`;

fs.writeFileSync(`${TEMP}.entry.mjs`, entry, 'utf8');

const built = await esbuild.build({
  entryPoints: [`${TEMP}.entry.mjs`],
  bundle: true,
  write: false,
  // 打成 CJS 再 require：react-dom/server 是 CJS，走 ESM 会在 `require('stream')` 上炸
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  target: 'node18',
  logLevel: 'warning',
  absWorkingDir: FRONTEND,
  /*
   * React 必须留成 external：react-dom 的 CJS 里是运行期 `require('react')`，
   * 一旦被打进 bundle，这句话就会在 bundle 所在目录再解析出**第二份 React**，
   * 于是 dispatcher 对不上，报「Invalid hook call / dispatcher 为 null」。
   * 留成 external，让 node 从 frontend/node_modules 解析，全局只有一份。
   */
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  // 画布里的样式 import 不参与逻辑，桩掉即可（样式一致性由生成器 + 产物校验负责）
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

fs.writeFileSync(`${TEMP}.bundle.cjs`, built.outputFiles[0].text, 'utf8');
const mod = require(`${TEMP}.bundle.cjs`);

const { React, renderToStaticMarkup, MiniappStage, describeTarget, LayoutBlocks, onPreviewNavigate } = mod;

/* --------------------------------------------------------------- 2. 测试数据 */
const categories = [
  { id: 'c1', key: 'short-video', name: '短视频获客' },
  { id: 'c2', key: 'private', name: '私域运营' },
  { id: 'c3', key: 'geo', name: 'GEO 优化' },
  { id: 'c-all', key: 'all', name: '全部' },
];
const agent = (id, name) => ({ id, name, description: `${name} 的简介`, tags: ['获客'] });
const agents = Array.from({ length: 8 }, (_v, i) => agent(`ag${i + 1}`, `智能体${i + 1}`));
const workflows = Array.from({ length: 4 }, (_v, i) => ({ ...agent(`wf${i + 1}`, `工作流${i + 1}`), category: '' }));

const content = {
  agents,
  workflows,
  categories,
  categoryGroups: categories,
  banners: [{ image: '/api/blob/serve?key=b1', title: 'Banner' }],
  announcements: [{ id: 'a1', title: '欢迎体验友尚 AI', publishedAt: '2026-09-01T00:00:00.000Z' }],
  recommended: ['ag1', 'wf1', 'ag2', 'ag3', 'ag4', 'ag5', 'ag6', 'ag7'],
  computePackages: [],
  rechargeInfo: '',
  customerService: { enabled: false, qr: '', lines: [] },
};

const block = (type, patch = {}) => ({
  id: `${type}-1`, type, visible: true, title: '', image: '', backgroundColor: '', textColor: '',
  spacing: 16, link: '', slides: [], categoryImages: {}, categoryLinks: {}, cardLinks: {},
  dataSource: type.startsWith('featured-') ? 'recommended' : '', limit: type === 'categories' ? 12 : 6,
  searchPlaceholder: '', moreText: '', showMore: true, ...patch,
});

const layout = {
  page: 'home',
  blocks: [
    block('carousel', { limit: 3, slides: [{ image: '/api/blob/serve?key=s1', link: '' }] }),
    block('announcements'),
    block('search'),
    block('categories', { limit: 2, categoryLinks: { 'short-video': { kind: 'page', path: '/pages/recharge/index' } } }),
    block('featured-agents', { limit: 3, cardLinks: { ag2: { kind: 'workflow', id: 'wf3' } } }),
    block('featured-workflows', { limit: 2 }),
  ],
};

/* ----------------------------------------------------- 3. 结构一致性（SSR） */
const html = renderToStaticMarkup(React.createElement(MiniappStage, { layout, content, active: 'home', selectedId: 'categories-1' }));

const has = (needle) => html.includes(needle);
const count = (needle) => html.split(needle).length - 1;

// 3.1 页面根结构与真机 pages/home/index.tsx 一致
check('根结构 = 真机首页 (.page.mini-home-page)', has('class="page mini-home-page"'), '');
// 3.2 推荐区用的是真机紧凑卡，不是后台自己画的 Tailwind 卡
check('推荐卡 = 真机 ContentCard variant=compact', has('mini-content-card mini-content-card--compact'));
check('推荐卡子结构：圆形头像容器', has('mini-content-card-compact-avatar'));
check('推荐卡子结构：名称（真机 class）', has('mini-content-card-compact-name'));
check('推荐卡子结构：简介（真机 class）', has('mini-content-card-compact-desc'));
check('推荐区容器 = .mini-content-list（单列毛玻璃）', has('mini-content-list'));
// 3.3 推荐卡数量：featured-agents 3 张（推荐位混排前 3）+ featured-workflows 1 张（推荐位里只有 wf1）
check('推荐卡数量＝递归区块 limit 后取到的 3+1', count('mini-content-card--compact') === 4, `实际 ${count('mini-content-card--compact')}`);
// 3.4 分类卡 = 真机分类卡（封面图 + 渐变遮罩 + 文字），且「全部」被排除
check('分类卡 = 真机 .mini-category-item', has('mini-category-item'));
check('分类卡子结构：渐变遮罩 .mini-category-cover', has('mini-category-cover'));
check('分类卡子结构：文字 .mini-category-label', has('mini-category-label'));
check('分类卡数量＝limit（2，且排除「全部」）', count('mini-category-item') === 2, `实际 ${count('mini-category-item')}`);
check('「全部」不出现在分类区', !has('>全部<'));
// 3.5 底部导航 = 真机自绘悬浮胶囊
check('底栏 = 真机 .mini-tab-bar', has('mini-tab-bar'));
check('底栏 = 真机 .mini-tab-bar-inner（玻璃胶囊底板）', has('mini-tab-bar-inner'));
check('底栏 = 真机 .mini-tab-bubble（选中气泡）', has('mini-tab-bubble'));
check('底栏 = 真机 .mini-tab-icon（PNG 图标位）', has('mini-tab-icon mini-tab-icon-home'));
check('底栏 = 真机 .mini-tab-label', has('mini-tab-label'));
check('底栏选中态在「首页」', has('mini-tab-item mini-tab-item-active'));
const tabLabels = ['>首页<', '>智能体<', '>工作流<', '>资产<', '>我的<'];
check(`底栏 5 个文案 = 首页/智能体/工作流/资产/我的（${tabLabels.join(' ')}）`, tabLabels.every(has));
check('旧画布的错字「灵感」已消失', !has('>灵感<'));
check('底栏 5 项', count('class="mini-tab-item') === 5, `实际 ${count('class="mini-tab-item')}`);
// 3.6 其余区块也是真机结构
check('区块标题 = .mini-block-heading', has('mini-block-heading'));
check('「更多」= .mini-section-more', has('mini-section-more'));
check('搜索框 = .mini-searchbar（真机组件）', has('mini-searchbar'));
check('搜索框图标用 PNG（.ui-icon-search）', has('ui-icon-search'));
check('轮播 = .mini-hero-swiper', has('mini-hero-swiper'));
check('轮播图 = .layout-banner.mini-hero-image', has('layout-banner mini-hero-image'));
check('公告栏 = .mini-announce-bar + 铃铛 PNG 图标', has('mini-announce-bar') && has('ui-icon-bell'));
// 3.7 旧假画布的痕迹必须消失
const oldArtifacts = ['aspect-[4/3]', 'line-clamp-2', 'text-shadow:0_1px_6px', 'max-h-[640px]', 'bg-[#f4f8ff]'];
check('旧假画布痕迹已清除', oldArtifacts.every((cls) => !has(cls)), `残留 ${oldArtifacts.filter(has).join(', ')}`);

/* ------------------------------------------- 4. 行为一致性（真点，看跳转） */
const calls = [];
onPreviewNavigate((info) => calls.push(info.url));
const lastCall = () => calls[calls.length - 1];
const clickAndRead = (node) => { calls.length = 0; node.props.onClick(); return lastCall(); };

/** 在元素树里找所有满足条件的节点 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (!node.props) return;
  visit(node);
  // ContentCard 是无 hooks 的纯组件，直接展开就能拿到它内部的 onClick（也就是真实点击入口）
  if (typeof node.type === 'function' && node.props.item) walk(node.type(node.props), visit);
  walk(node.props.children, visit);
}
const collect = (root, match) => {
  const found = [];
  walk(root, (node) => { if (match(node)) found.push(node); });
  return found;
};

const categoriesBlock = layout.blocks.find((item) => item.type === 'categories');
const tree = LayoutBlocks({ layout: { page: 'home', blocks: [categoriesBlock] }, content });
const categoryNodes = collect(tree, (node) => node.props.className === 'mini-category-item');
check('取到 2 张分类卡（可点）', categoryNodes.length === 2, `实际 ${categoryNodes.length}`);

// 4.1 配了 categoryLinks 的那张走配置
const configured = categoryNodes[0];
const configuredUrl = clickAndRead(configured);
check('分类卡 ①（短·video 配了链接）→ 跳配置的 /pages/recharge/index', configuredUrl === '/pages/recharge/index', `实际 ${configuredUrl}`);
// 4.2 没配的那张走默认（进该分类列表页，带 category 与 title）
const fallbackUrl = clickAndRead(categoryNodes[1]);
check('分类卡 ②（没配）→ 回落默认 /pages/category/index?category=private…', fallbackUrl.startsWith('/pages/category/index?category=private'), `实际 ${fallbackUrl}`);
check('回落地址带上了分类标题', decodeURIComponent(fallbackUrl).includes('私域运营'), `实际 ${decodeURIComponent(fallbackUrl)}`);
// 4.3 分类自带 miniappLink 时的优先级（后台没配 → 用分类自带的）
const withLegacy = { ...categoriesBlock, categoryLinks: {} };
const legacyContent = { ...content, categories: [{ id: 'cX', key: 'legacy', name: '老分类', miniappLink: '/pages/hot/index?type=agent' }, ...categories] };
const legacyTree = LayoutBlocks({ layout: { page: 'home', blocks: [withLegacy] }, content: legacyContent });
const legacyNode = collect(legacyTree, (node) => node.props.className === 'mini-category-item')[0];
check('分类自带 miniappLink（后台没配）→ 用分类自带的', clickAndRead(legacyNode) === '/pages/hot/index?type=agent', `实际 ${clickAndRead(legacyNode)}`);

// 4.4 推荐卡：配了 cardLinks 的走配置，没配的打开自己
const agentsBlock = layout.blocks.find((item) => item.type === 'featured-agents');
const cardTree = LayoutBlocks({ layout: { page: 'home', blocks: [agentsBlock] }, content });
/*
 * ⚠️ 顺序不是「前 N 个智能体」：推荐位下渲染器保持网页版那个口径 ——
 *    推荐数组里的智能体与工作流**混排**（见 layout-blocks.tsx 的 featuredEntries 注释），
 *    recommended = [ag1, wf1, ag2, …] 取前 3 就是 ag1 / wf1 / ag2。
 *    所以这里按 item.id 断言，不按位置。
 */
const cards = collect(cardTree, (node) => node.props && node.props.item && 'link' in node.props);
const cardOf = (id) => cards.find((node) => node.props.item.id === id);
// 卡片壳 = ContentCard 渲染出来的那层，onClick 也就是真机的点击入口（ContentCard 无 hooks，可直接展开）
const cardShell = (id) => cardOf(id).type(cardOf(id).props);
const clickCard = (id) => clickAndRead(cardShell(id));

check('取到 3 张推荐卡（＝limit）', cards.length === 3, `实际 ${cards.length}`);
check('推荐卡含 智能体1 / 工作流1 / 智能体2（推荐位智能体工作流混排，与网页版同源）',
  ['ag1', 'wf1', 'ag2'].every(cardOf), `实际 ${cards.map((node) => node.props.item.id).join(',')}`);
check('卡片壳用的是真机紧凑卡 class', String(cardShell('ag1').props.className).includes('mini-content-card--compact'), String(cardShell('ag1').props.className));
check('推荐卡「智能体1」（没配）→ 打开它自己 /pages/chat/index?id=ag1', clickCard('ag1') === '/pages/chat/index?id=ag1', `实际 ${clickCard('ag1')}`);
check('推荐卡「工作流1」（没配）→ 打开它自己 /pages/workflow/index?id=wf1', clickCard('wf1') === '/pages/workflow/index?id=wf1', `实际 ${clickCard('wf1')}`);
check('推荐卡「智能体2」（配了→工作流3）→ 跳配置的 /pages/workflow/index?id=wf3', clickCard('ag2') === '/pages/workflow/index?id=wf3', `实际 ${clickCard('ag2')}`);
check('逐项跳转只作用于被配的那一张（智能体1 不受影响）', clickCard('ag1') === '/pages/chat/index?id=ag1');

// 4.5 工作流块：推荐位里只有 wf1，卡片默认打开工作流页（不是智能体页）
const workflowBlock = layout.blocks.find((item) => item.type === 'featured-workflows');
const workflowTree = LayoutBlocks({ layout: { page: 'home', blocks: [workflowBlock] }, content });
const workflowCards = collect(workflowTree, (node) => node.props && node.props.item && 'link' in node.props);
check('工作流块只取到工作流（推荐位里的 wf1）', workflowCards.length === 1 && workflowCards[0].props.item.id === 'wf1', `实际 ${workflowCards.map((node) => node.props.item.id).join(',')}`);
check('工作流卡默认打开 /pages/workflow/index?id=wf1', clickAndRead(workflowCards[0].type(workflowCards[0].props)) === '/pages/workflow/index?id=wf1', `实际 ${clickAndRead(workflowCards[0].type(workflowCards[0].props))}`);

// 4.6 数据源 / 数量
const allSource = { ...agentsBlock, dataSource: 'all', limit: 4 };
const allTree = LayoutBlocks({ layout: { page: 'home', blocks: [allSource] }, content });
const allCards = collect(allTree, (node) => String(node.props.className || '').includes('mini-content-card--compact'));
check('数据源=全部 + limit=4 → 真渲出 4 张', allCards.length === 4, `实际 ${allCards.length}`);

/* ------------------------------------------------- 5. 跳转文案（读出行） */
check('读出行：有 id 且能查到名字', describeTarget('/pages/chat/index?id=ag1', content) === '打开AI 智能体对话「智能体1」', describeTarget('/pages/chat/index?id=ag1', content));
check('读出行：id 已下架要明说', describeTarget('/pages/chat/index?id=ghost', content).includes('已找不到'), describeTarget('/pages/chat/index?id=ghost', content));
check('读出行：带 title 的分类页', describeTarget('/pages/category/index?category=private&title=%E7%A7%81%E5%9F%9F%E8%BF%90%E8%90%A5', content).includes('私域运营'));
check('读出行：外链 webview', describeTarget('/pages/webview/index?url=https%3A%2F%2Fusunai.top', content) === '打开小程序内置浏览器');

/* ------------------------------------------------------------- 6. 收尾报告 */
fs.rmSync(`${TEMP}.entry.mjs`, { force: true });
fs.rmSync(`${TEMP}.bundle.cjs`, { force: true });

const failed = results.filter((item) => !item.pass);
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  ← ${item.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;
