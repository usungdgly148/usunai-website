/**
 * 渲染实测：用真实浏览器打开 check-web-opening-markdown.mjs 生成的并排预览页，
 * 量三列的**实际计算结果**（字号 / 行高），而不是只读 CSS 源码。
 *
 * 为什么 CSS 断言之外还要有这一层（真实踩过的坑）：
 *   check-web-opening-markdown.mjs 断言的是**源码文本**（`.md-render { line-height: 1.75 }` 在不在）。
 *   它全绿并不代表浏览器量出来就是 1.75：
 *     · 预览页内联的是 dist 产物 CSS —— 产物过期时预览仍是旧样式（已由那边的新鲜度断言兜住）；
 *     · 任何一条更具体的规则（例如元素上直接挂 `leading-*`）都能在源码断言全绿的情况下改掉实际行高。
 *   2026-09 就是靠这一层发现「网页正文实际行高 22.75px(1.625)」的。
 *
 * 量法要点：
 *   ① 每列的 `<h2 class="col-title">` 是**列标题**不是内容 → 标题必须限定在 `.col-body` 里查，
 *      否则 h2 会命中列标题，量出 12.5px 的假结果。
 *   ② 官方列的段落是 `<div class="t-chat-markdown-p">`（不是 `<p>`）。
 *   ③ 分母用**各列内容根容器**的字号：网页两列本来就不同（开场白 14 / AI 回复 15），官方 16。
 *      目标是「相对比例一致」，不是 px 相等。
 *
 * 环境容错：找不到 playwright 时**跳过而不报错** —— 浏览器不是本仓库的依赖，
 *   不能让一次「没装浏览器」把整个回归卡红。跳过会显式打印原因。
 *
 * 前置：先跑 check-web-opening-markdown.mjs（它负责产出 .preview/web-opening-markdown.html）。
 * 用法：node scripts/check-web-markdown-render.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const PAGE = path.join(FRONTEND, '.preview', 'web-opening-markdown.html');

/** playwright 可能装在 frontend，也可能装在 WorkBuddy 的共享 workspace 里 */
const PW_CANDIDATES = [
  path.join(FRONTEND, 'node_modules', 'playwright'),
  'C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules/playwright',
];

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of PW_CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    try {
      return require(p);
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) {
  console.log('[web-render] 跳过：没找到 playwright（浏览器不是本仓库依赖）。');
  console.log('[web-render] 候选路径：');
  PW_CANDIDATES.forEach((p) => console.log('             ' + p));
  console.log('[web-render] 想跑这一层：npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

if (!fs.existsSync(PAGE)) {
  console.log(`[web-render] 跳过：预览页不存在 → ${path.relative(FRONTEND, PAGE)}`);
  console.log('[web-render] 先跑：node scripts/check-web-opening-markdown.mjs');
  process.exit(0);
}

const EXPECT_RATIO = 1.75;

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1400 } });
await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' });

// 顺手留一张人眼可看的证据（主人的验收窗口就是这张图）
const SHOT = path.join(FRONTEND, '.preview', 'shot-web-opening-markdown.png');
await page.screenshot({ path: SHOT, fullPage: true });

const data = await page.evaluate(() => {
  const num = (v) => parseFloat(v) || 0;
  const cols = [...document.querySelectorAll('.col')];

  return cols.map((col) => {
    const title = (col.querySelector('.col-title')?.textContent || '').trim();
    const body = col.querySelector('.col-body');
    const official = !!col.querySelector('.t-chat-markdown');

    // 内容根容器：网页两列 .md-render，官方列 .t-chat-markdown
    const root = official ? col.querySelector('.t-chat-markdown') : col.querySelector('.md-render');
    const rcs = getComputedStyle(root);
    const rootFontSize = num(rcs.fontSize);

    // 正文段落：官方列 .t-chat-markdown-p，网页列 .md-render p
    const p = body.querySelector(official ? '.t-chat-markdown-p' : 'p');
    const pcs = p ? getComputedStyle(p) : null;

    // 标题：限定在 .col-body 内（避开 <h2 class="col-title">）
    const heads = [1, 2, 3, 4, 5, 6].map((lv) => {
      const sel = official ? `.t-chat-markdown-h${lv}` : `h${lv}`;
      const el = body.querySelector(sel);
      if (!el) return { lv, missing: true };
      return { lv, fontSize: num(getComputedStyle(el).fontSize) };
    });

    return {
      title,
      rootFontSize,
      pFound: !!p,
      pFontSize: pcs ? num(pcs.fontSize) : 0,
      pLineHeight: pcs ? num(pcs.lineHeight) : 0,
      hasHeadingCap: heads.some((h) => h.lv === 1 && (h.fontSize / rootFontSize).toFixed(2) === '2.00'),
      overallSizesOk: heads.every((h) => !h.missing),
      headingRatios: heads.map((h) => (h.missing ? null : +(h.fontSize / rootFontSize).toFixed(2))),
    };
  });
});

await browser.close();

console.log('');
console.log('列'.padEnd(16) + '基准px'.padEnd(9) + '正文px'.padEnd(9) + '行高px'.padEnd(9) + '行高比'.padEnd(9) + '六级标题 ÷ 基准');
console.log('-'.repeat(100));
for (const c of data) {
  const ratio = c.pFontSize ? c.pLineHeight / c.pFontSize : 0;
  console.log(
    String(c.title).slice(0, 14).padEnd(16) +
    String(c.rootFontSize).padEnd(9) +
    String(c.pFontSize).padEnd(9) +
    String(c.pLineHeight).padEnd(9) +
    ratio.toFixed(3).padEnd(9) +
    c.headingRatios.map((r) => (r === null ? '—' : r.toFixed(2))).join(' / ')
  );
}
console.log('');

const asserts = [];
const must = (name, pass, detail = '') => asserts.push({ name, pass, detail });

for (const c of data) {
  const ratio = c.pFontSize ? c.pLineHeight / c.pFontSize : 0;
  must(`${c.title} 实际行高比 = 1.75`, Math.abs(ratio - EXPECT_RATIO) < 0.02, `实际 ${ratio.toFixed(3)}`);
}
must('三列都取到了真实正文段落（没有靠兜底元素凑数）', data.every((c) => c.pFound));
must('三列六级标题齐全', data.every((c) => c.overallSizesOk));

const ratios = data.map((c) => c.headingRatios);
const sameRatio = ratios.every((r) => r.every((v, i) => v === null || Math.abs(v - ratios[0][i]) < 0.03));
must('三列「标题 ÷ 基准字号」相对比例完全一致', sameRatio,
  sameRatio ? '' : data.map((c, i) => `${c.title}: ${ratios[i].join('/')}`).join(' | '));

console.log('断言：');
for (const a of asserts) console.log(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.name}${a.pass || !a.detail ? '' : `  ← ${a.detail}`}`);

const failed = asserts.filter((a) => !a.pass);
console.log(failed.length ? `\n[web-render] ${failed.length} 项不通过` : `\n[web-render] ${asserts.length} 项全部通过`);
console.log(`[web-render] 截图 → ${path.relative(FRONTEND, SHOT)}`);
process.exit(failed.length ? 1 : 0);
