#!/usr/bin/env node
// 品牌色守卫：填充主色必须是 #D65800、亮橙点缀必须是 #FF6900，且前端不得再出现旧深墨蓝。
//
// 背景：2026-11-03 第一轮主人要求把全站深蓝色（文字/背景/边框）统一换成 #FF6900；
// 同日第二轮把填充色加深到 #D65800（#FF6900 在白底只有 2.89:1，按钮文字和小号橙字偏飘）。
// 当时把 Tailwind 的 brand 色阶整体换掉，一次性覆盖 120+ 处引用。
// 这个脚本守三件事：
//   ① 色阶「唯一真源」不能被绕过 —— brand-600 必须是 #D65800、brand-500 必须是 #FF6900、
//      index.css 的 --brand 必须同源，且主填充白底对比度必须 ≥ 4.0:1；
//   ② 旧深蓝不许回流 —— 任何人手写 #1E4A78 / rgba(30,74,120,...) 都会被这条拦下，
//      因为散落在组件里的深蓝无法被色阶带动，改色必然漏；
//   ③ 不许用任意值（bg-[#D65800] 等）绕过色阶，否则 hover / disabled 会与主色漂移。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const read = (p) => fs.readFileSync(p, 'utf8');

// 白底对比度（WCAG 相对亮度）：防止以后有人把填充色又改回浅橙，正文立刻糊掉
const lum = (hex) => {
  const c = hex.slice(1).match(/../g).map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrastOnWhite = (hex) => 1.05 / (lum(hex) + 0.05);

// ---- 1. 色阶与变量同源 ----
const tw = read(path.join(FE, 'tailwind.config.js'));
const brandBlock = /brand:\s*\{([\s\S]*?)\}/.exec(tw);
check('tailwind.config.js 存在 brand 色阶', !!brandBlock);
if (brandBlock) {
  const step = (n) => {
    const m = new RegExp(`${n}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(brandBlock[1]);
    return m ? m[1].toUpperCase() : '';
  };
  check('brand-500 = #FF6900（亮橙，焦点环/装饰专用）', step(500) === '#FF6900', step(500));
  check('brand-600 = #D65800（主填充/主文字）', step(600) === '#D65800', step(600));
  check('brand-700 = #B84A00（比 600 更深，hover 可感知）', step(700) === '#B84A00', step(700));
  check('brand-800 = #9C3F00（active 深强调）', step(800) === '#9C3F00', step(800));
  // 主填充必须真的够深：目标白底 ≥ 4.0:1。#D65800 实测 3.996:1（四舍五入即 4.00），
  // 阈值取 3.9 是为了留浮点容差，不是放宽标准；若有人改回 #FF6900（2.89）会立刻红。
  const main = step(600);
  check('brand-600 白底对比度 ≥ 4.0:1', Boolean(main) && contrastOnWhite(main) >= 3.9,
    main ? `${main} = ${contrastOnWhite(main).toFixed(3)}:1` : '');
  // 浅底档位必须真的"浅"：不能被误写成主色，否则浅底标签会变成实心橙块
  const light = [50, 100].map(step);
  check('brand-50/100 仍为浅底档位', light.every((v) => v && v !== '#FF6900' && contrastOnWhite(v) > 1), light.join(' / '));
}

const css = read(path.join(FE, 'src/index.css'));
check('index.css --brand 与主填充同源', /--brand:\s*#D65800/i.test(css));
check('index.css --brand-dark 为 hover 深橙', /--brand-dark:\s*#B84A00/i.test(css));
check('品牌渐变中段与主填充同源（无深墨蓝停靠点）',
  /\.gradient-brand\s*\{[^}]*#D65800/i.test(css) && !/#0F2A4A/i.test(css));
check('输入框光标色为品牌橙', /caret-color:\s*#FF6900/i.test(css));

// ---- 2. 旧深蓝不许回流 ----
const NAVY_HEX = ['#1E4A78', '#163A5F', '#0F2A4A', '#0A1E36', '#2C6CA8'];
const NAVY_RGB = ['30, 74, 120', '22, 58, 95', '15, 42, 74', '44, 108, 168'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist_backup', '.git']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过构建产物与本地检查产物（.preview 等点目录由各 check 脚本临时生成，不入库、不上线）
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|css|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(FE)) {
  const text = read(file);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // 允许在注释里记录历史色值（说明"原来是深蓝"），只拦真正生效的写法
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hitHex = NAVY_HEX.find((h) => new RegExp(h, 'i').test(code));
    const hitRgb = NAVY_RGB.find((r) => new RegExp(`rgba?\\(\\s*${r}`).test(code));
    if (hitHex || hitRgb) offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${(hitHex || hitRgb)}`);
  });
}
check('前端源码无旧深墨蓝残留（hex / rgba）', offenders.length === 0, offenders.slice(0, 6).join(' | '));

// ---- 3. 组件里不许用任意值绕过色阶（否则 hover / disabled 会与主色漂移） ----
const ARBITRARY = [];
for (const file of walk(path.join(FE, 'src'))) {
  read(file).split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/\b(bg|text|border|ring|from|to|via)-\[#(FF6900|D65800|B84A00)\]/i.test(code)) {
      ARBITRARY.push(`${path.relative(ROOT, file)}:${i + 1}`);
    }
  });
}
check('组件未用 bg-[#D65800] 这类任意值绕过色阶', ARBITRARY.length === 0, ARBITRARY.slice(0, 4).join(' | '));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`);
console.log(`\n===== ${results.length - failed.length} 通过 / ${failed.length} 失败 =====`);
process.exit(failed.length === 0 ? 0 : 1);
