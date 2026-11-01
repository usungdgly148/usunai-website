#!/usr/bin/env node
/**
 * 小程序底部标签栏契约守卫（2026-11-02 主人指定改版为「固定贴底 · 铺满宽度」）
 *
 * 锁住三条容易被后人改回去的硬约束：
 *   1) 几何：必须 fixed + left/right/bottom:0 + 无左右 margin + 无圆角（即贴底铺满，不是悬浮胶囊）
 *   2) 造型：未选中线条 / 选中实心 —— tab-icons.scss 必须存在两套**不同**的图，
 *      且 solid 版走 fill + evenodd + stroke:none（否则镂空细节会被描边填死）
 *   3) 状态：选中态靠 `.mini-tab-item-active` 同时驱动图标换图与文字变色，缺一即视觉不同步
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 小程序源码在 miniapp/ 子目录，本脚本在仓库根的 scripts/ 下
const read = (p) => fs.readFileSync(path.join(ROOT, 'miniapp', p), 'utf8');

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, cond: Boolean(cond), detail });
};

/**
 * 去掉注释再断言。
 * ⚠️ 踩坑：注释里写明「已删除 backdrop-filter / mini-tab-bubble」时，直接对全文做
 *    not-contains 会把自己的说明文字判成违规，两条断言永远红。
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

// ---------- 1) 组件结构 ----------
const comp = stripComments(read('src/components/miniapp-tab-bar.tsx'));
ok('组件存在且导出了 MiniappTabBar', /export function MiniappTabBar/.test(comp));
ok('保留了底部占位（否则内容会被固定栏盖住）', /mini-tab-bar-spacer/.test(comp));
ok('图标按 key 生成两套 class 名', /mini-tab-icon-\$\{tab\.key\}/.test(comp));
ok('选中态 class 为 mini-tab-item-active（图标换图依赖它）',
  /mini-tab-item-active/.test(comp));
ok('已删除胶囊气泡层 mini-tab-bubble（改回贴底就不需要了）', !/mini-tab-bubble/.test(comp));
ok('标签跳转仍是 reLaunch（非 switchTab，本工程无原生 tabBar）', /Taro\.reLaunch/.test(comp));

// ---------- 2) 样式：app.scss 的 tabbar 段 ----------
const scssRaw = read('src/app.scss');
const scss = stripComments(scssRaw);
// 段落定位必须用**未去注释**的原文（'/* ===== 底部导航栏' 本身就是注释标记）
const start = scssRaw.indexOf('/* ===== 底部导航栏');
const nextMark = scssRaw.indexOf('/* =====', start + 10);
const bar = start >= 0 ? stripComments(scssRaw.slice(start, nextMark > 0 ? nextMark : undefined)) : '';
ok('app.scss 里能切出底部栏样式段', bar.length > 200, `${bar.length} 字符`);

const rule = (sel) => {
  const i = bar.indexOf(sel + ' {');
  if (i < 0) return '';
  const j = bar.indexOf('}', i);
  return bar.slice(i, j);
};
const barRule = rule('.mini-tab-bar');
const innerRule = rule('.mini-tab-bar-inner');
const itemRule = rule('.mini-tab-item');

ok('.mini-tab-bar 是 fixed 定位', /position:\s*fixed/.test(barRule));
ok('.mini-tab-bar 四边贴边（left/right/bottom 全 0）',
  /left:\s*0/.test(barRule) && /right:\s*0/.test(barRule) && /bottom:\s*0/.test(barRule));
ok('.mini-tab-bar 有底色（不能透明，否则内容会透出来）', /background:\s*var\(--mini-tab-bg\)/.test(barRule));
ok('.mini-tab-bar 有顶部 1px 分隔线', /border-top:\s*1rpx solid/.test(barRule));
ok('.mini-tab-bar 保留安全区 padding',
  /env\(safe-area-inset-bottom\)/.test(barRule) && /constant\(safe-area-inset-bottom\)/.test(barRule));

ok('.mini-tab-bar-inner 没有左右 margin（贴底必须铺满）', !/margin:/.test(innerRule), innerRule.trim().slice(0, 90));
ok('.mini-tab-bar-inner 没有圆角（不再是胶囊）', !/border-radius/.test(innerRule));
ok('.mini-tab-bar-inner 没有玻璃/阴影残留',
  !/backdrop-filter/.test(innerRule) && !/box-shadow/.test(innerRule));
ok('.mini-tab-bar-inner 高度为 104rpx（与 spacer 一致）', /height:\s*104rpx/.test(innerRule));
ok('.mini-tab-item 竖排（column）', /flex-direction:\s*column/.test(itemRule));
ok('.mini-tab-item 五等分不塌陷', /flex:\s*1 1 0/.test(itemRule) && /min-width:\s*0/.test(itemRule));

ok('占位 spacer 高度与栏体一致（104rpx）',
  /\.mini-tab-bar-spacer\s*\{[^}]*height:\s*104rpx/.test(bar));
ok('整段无 backdrop-filter（贴底后模糊无意义）', !/backdrop-filter/.test(bar));
ok('整段无 mini-tab-bubble / mini-tab-shadow 残留',
  !/mini-tab-bubble/.test(bar) && !/mini-tab-shadow/.test(bar));

const vars = scss.slice(scss.indexOf('page {'), scss.indexOf('}', scss.indexOf('page {')));
ok('--mini-tab-bg 是纯色而非渐变（贴底白底）',
  /--mini-tab-bg:\s*#[0-9a-f]{3,8};/i.test(vars), (vars.match(/--mini-tab-bg:[^;]+;/) || [''])[0]);
ok('未选中/选中文字色都有 token',
  /--mini-tab-text:/.test(vars) && /--mini-tab-text-active:/.test(vars));

// ---------- 3) 状态：图文同步 ----------
ok('选中态文字变色', /\.mini-tab-item-active\s+\.mini-tab-label\s*\{[^}]*color:\s*var\(--mini-tab-text-active\)/.test(bar));
ok('选中态文字加粗（与未选中拉开层级）', /\.mini-tab-item-active\s+\.mini-tab-label\s*\{[^}]*font-weight/.test(bar));
ok('未选中文字走默认 token', /\.mini-tab-label\s*\{[^}]*color:\s*var\(--mini-tab-text\)/.test(bar));

// ---------- 4) 图标：两套造型 ----------
const icons = read('src/styles/tab-icons.scss');
const KEYS = ['home', 'agents', 'workflows', 'assets', 'profile'];
const uriOf = (key, active) => {
  const sel = active
    ? `.mini-tab-item-active .mini-tab-icon-${key} { background-image: url("`
    : `.mini-tab-icon-${key} { background-image: url("`;
  const i = icons.indexOf(sel);
  if (i < 0) return '';
  const s = i + sel.length;
  const e = icons.indexOf('"', s);
  return icons.slice(s, e);
};
const normals = {};
const actives = {};
for (const k of KEYS) {
  normals[k] = uriOf(k, false);
  actives[k] = uriOf(k, true);
  ok(`${k} 有未选中图标`, normals[k].length > 100, `${normals[k].length} 字符`);
  ok(`${k} 有选中图标`, actives[k].length > 100, `${actives[k].length} 字符`);
  ok(`${k} 选中与未选中是两套不同的图（实心 ≠ 只换色）`, normals[k] !== actives[k]);
}
ok('未选中图标互不相同（没有互相复制）', new Set(KEYS.map((k) => normals[k])).size === KEYS.length);
ok('选中图标互不相同（没有互相复制）', new Set(KEYS.map((k) => actives[k])).size === KEYS.length);

const gen = read('scripts/gen-tab-icons.js');
ok('实心版改色由外层 <g fill> 统一给（不是逐个硬编码）', /fill='\$\{color\}'/.test(gen));
ok('实心版显式 stroke=none（否则镂空小孔会被描边填死）', /stroke='none' fill-rule='evenodd'/.test(gen));
ok('实心版用 evenodd 让孔洞镂空', /fill-rule='evenodd'/.test(gen));
ok('生成脚本仍是 PNG 位图（小程序不支持 svg 标签）', /png\(\{ compressionLevel/.test(gen));

// ---------- 5) 暗色模式同步 ----------
const theme = read('src/utils/theme.ts');
ok('暗色覆盖了 --mini-tab-bg（否则深色下栏体仍是亮白）', /'--mini-tab-bg':/.test(theme));
ok('暗色覆盖了 --mini-tab-border', /'--mini-tab-border':/.test(theme));
ok('暗色同步了选中文字色', /'--mini-tab-text-active':/.test(theme));
ok('暗色里已清掉气泡/阴影变量', !/mini-tab-bubble/.test(theme) && !/mini-tab-shadow/.test(theme));

// ---------- 输出 ----------
let fail = 0;
for (const r of results) {
  if (r.cond) {
    console.log('  ✓', r.name + (r.detail ? ` — ${r.detail}` : ''));
  } else {
    fail += 1;
    console.log('  ✗', r.name + (r.detail ? ` — ${r.detail}` : ''));
  }
}
console.log(`\n===== ${results.length - fail} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
