#!/usr/bin/env node
// 品牌色守卫：主色必须是橙色 #FF6900，且前端不得再出现旧深墨蓝。
//
// 背景：2026-11-03 主人要求把全站深蓝色（文字/背景/边框）统一换成 #FF6900。
// 当时把 Tailwind 的 brand 色阶整体换掉，一次性覆盖 120+ 处引用。
// 这个脚本守两件事：
//   ① 色阶「唯一真源」不能被绕过 —— brand 500/600 必须是 #FF6900，index.css 的 --brand 必须同源；
//   ② 旧深蓝不许回流 —— 任何人手写 #1E4A78 / rgba(30,74,120,...) 都会被这条拦下，
//      因为散落在组件里的深蓝无法被色阶带动，改色必然漏。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const read = (p) => fs.readFileSync(p, 'utf8');

// ---- 1. 色阶与变量同源 ----
const tw = read(path.join(FE, 'tailwind.config.js'));
const brandBlock = /brand:\s*\{([\s\S]*?)\}/.exec(tw);
check('tailwind.config.js 存在 brand 色阶', !!brandBlock);
if (brandBlock) {
  const step = (n) => {
    const m = new RegExp(`${n}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(brandBlock[1]);
    return m ? m[1].toUpperCase() : '';
  };
  check('brand-500 = #FF6900', step(500) === '#FF6900', step(500));
  check('brand-600 = #FF6900（主填充/主文字）', step(600) === '#FF6900', step(600));
  check('brand-700 比主色更深（hover 可感知）', step(700) === '#E85D00', step(700));
  // 浅底档位必须真的"浅"：不能被误写成主色，否则浅底标签会变成实心橙块
  const light = [50, 100].map(step);
  check('brand-50/100 仍为浅底档位', light.every((v) => v && v !== '#FF6900'), light.join(' / '));
}

const css = read(path.join(FE, 'src/index.css'));
check('index.css --brand 与色阶同源', /--brand:\s*#FF6900/i.test(css));
check('index.css --brand-dark 为深橙', /--brand-dark:\s*#E85D00/i.test(css));
check('品牌渐变已改橙（无深墨蓝停靠点）', /\.gradient-brand\s*\{[^}]*#FF6900/i.test(css) && !/#0F2A4A/i.test(css));
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
    if (/\b(bg|text|border|ring|from|to|via)-\[#FF6900\]/i.test(code)) {
      ARBITRARY.push(`${path.relative(ROOT, file)}:${i + 1}`);
    }
  });
}
check('组件未用 bg-[#FF6900] 这类任意值绕过色阶', ARBITRARY.length === 0, ARBITRARY.slice(0, 4).join(' | '));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`);
console.log(`\n===== ${results.length - failed.length} 通过 / ${failed.length} 失败 =====`);
process.exit(failed.length === 0 ? 0 : 1);
