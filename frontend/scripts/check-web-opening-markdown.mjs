/**
 * 检查「网页端（frontend）智能体对话页」的 Markdown 渲染面：
 * 它和小程序那边的官方 chat-markdown 规范差在哪、自家两套（开场白 / AI 回复）彼此差在哪。
 *
 * 为什么要单独做一个（而不是照搬小程序那份自测）：
 *   网页端**不是**官方 WXML 组件 —— TDesign 的 chat-markdown 是 miniprogram 组件，浏览器跑不了。
 *   网页用的是 react-markdown + 自己写的组件映射 + `.md-render` 兜底 CSS。所以「合规」这件事
 *   在网页端的含义变成：**同一份 markdown，网页渲染出来的结构与官方规范是否等价**，以及
 *   **两个位置（开场白 / AI 回复）是否一致**。后者是本项目的老病（对话页历来并存多套渲染器）。
 *
 * 做法（沿用「别凭读代码猜」的原则）：
 *   直接从 `pages/Chat.jsx` **抽出**两个真实的组件映射对象（花括号配对提取，不重打字），
 *   用 esbuild 转 JSX，再用 `react-dom/server` SSR 三份输出：
 *     左＝网页开场白（welcomeMarkdownComponents）
 *     中＝网页 AI 回复（assistantMarkdownComponents）
 *     右＝官方规范（officialMarkdown.jsx，等同小程序真机）
 *   同一份样本、同一屏，差异一眼可见。
 *
 * 用法：node scripts/check-web-opening-markdown.mjs
 * 产物：.preview/web-opening-markdown.html（三方并排，可双击打开）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const TEMP = path.join(FRONTEND, '.check-web-opening-md');
const DIST = path.join(FRONTEND, 'dist/assets');
const CHAT = path.join(FRONTEND, 'src/pages/Chat.jsx');

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

/* ---------------------------------------------- 1. 从 Chat.jsx 抽出真实组件映射 */
const chatSource = read(CHAT);
if (!chatSource) {
  console.error(`[web-md] 读不到 ${CHAT}`);
  process.exit(1);
}

/** 从 `const <name> = {` 起做花括号配对，取出整个对象字面量的源码 */
function extractObject(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const WELCOME_SRC = extractObject(chatSource, 'welcomeMarkdownComponents');
const ASSISTANT_SRC = extractObject(chatSource, 'assistantMarkdownComponents');
if (!WELCOME_SRC || !ASSISTANT_SRC) {
  console.error('[web-md] 提取失败：Chat.jsx 里找不到 welcomeMarkdownComponents / assistantMarkdownComponents');
  console.error(`  welcome=${!!WELCOME_SRC} assistant=${!!ASSISTANT_SRC}`);
  process.exit(1);
}

/* ---------------------------------------------- 2. 打包（只用真源码 + 真依赖） */
fs.writeFileSync(`${TEMP}.entry.jsx`, `
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficialMarkdown } from '${FRONTEND.replace(/\\/g, '/')}/src/officialMarkdown.jsx';

${WELCOME_SRC}
${ASSISTANT_SRC}

// ⚠️ 这里的 plugins 与容器 class 必须与 Chat.jsx 实际渲染时一致，否则自测在验证另一个东西：
// 开场白的容器是 md-render + text-sm（正文 14px），AI 回复是 md-render + text-[15px]（正文 15px）。
// 标题走 em 比例，所以容器字号不同 → 同一份 markdown 的绝对字号也不同，这是**有意的**。
// 注意：这段代码是写在模板字符串里的，注释里不能出现反引号。
function render(set, source, containerClass = '') {
  return renderToStaticMarkup(
    <div className={\`md-render \${containerClass}\`.trim()}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={set}>{source}</Markdown>
    </div>,
  );
}
export { React, render, renderToStaticMarkup, OfficialMarkdown, welcomeMarkdownComponents, assistantMarkdownComponents };
`, 'utf8');

const built = await esbuild.build({
  entryPoints: [`${TEMP}.entry.jsx`],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  target: 'node18',
  logLevel: 'warning',
  absWorkingDir: FRONTEND,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  plugins: [{ name: 'css-stub', setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }],
});
fs.writeFileSync(`${TEMP}.bundle.cjs`, built.outputFiles[0].text, 'utf8');
const mod = require(`${TEMP}.bundle.cjs`);

/* ---------------------------------------------- 3. 同一份样本（专挑有区分度的） */
const SAMPLE = [
  '# 一级标题',
  '## 二级标题',
  '### 三级标题',
  '#### 四级标题',
  '##### 五级标题',
  '###### 六级标题',
  '',
  '正文 **加粗** *斜体* ~~删除线~~ 行内代码 `code`。',
  '',
  '单行回车测试：',
  '这一行是软换行',
  '这一行也是',
  '',
  '- 无序一级',
  '  - 无序嵌套',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用块',
  '> 第二行',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| 列一 | 列二 | 列三 | 列四 | 列五 |',
  '| :- | :- | :- | :- | -: |',
  '| 1 | 2 | 3 | 4 | 5 |',
  '',
  '![图片](https://usunai.top/static/case.png)',
  '',
  '[站内链接](https://usunai.top/pack) 和 [外站链接](https://example.com/a)',
  '',
  '---',
].join('\n');

const outputs = {
  网页开场白: mod.render(mod.welcomeMarkdownComponents, SAMPLE, 'text-sm'),
  网页AI回复: mod.render(mod.assistantMarkdownComponents, SAMPLE, 'text-[15px]'),
  官方规范: mod.renderToStaticMarkup(mod.React.createElement(mod.OfficialMarkdown, { value: SAMPLE })),
};

/* ---------------------------------------------- 4. 逐列「特征指纹」
 *
 * ⚠️ 一台最容易被自己骗的地方：官方 chat-markdown 把标题渲成
 * `<view class="t-chat-markdown-h t-chat-markdown-h2">` 而**不是** `<h2>`，
 * 链接也不是 `<a>`（它 triggerEvent 抛 node 给业务，设计上不给锚点）。
 * 所以不能拿「有没有 `<h2>` / 有没有 target=_blank」当统一尺子 —— 那是拿网页的形态
 * 去量官方，必然全线标红。这里按**每列自己的形态**识别「支持了什么」，再横向对比。 */
const levelsOf = (html) => {
  const set = new Set();
  for (const m of html.matchAll(/<h([1-6])[ >]/g)) set.add(Number(m[1]));
  for (const m of html.matchAll(/t-chat-markdown-h([1-6])\b/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
};
const wrapperOf = (html, tag) => {
  // 找 <tag> 最近一层带 overflow 约束的祖先（只做 200 字符窗口，够用且稳）
  const re = new RegExp(`<div[^>]*class="([^"]*)"[^>]*>(?:(?!<table)[\\s\\S]){0,200}<${tag}[ >]`);
  const m = re.exec(html);
  return m ? m[1] : '';
};

const fingerprint = (html) => ({
  标题层级: levelsOf(html).join('/') || '无',
  删除线: /<del[ >]|t-chat-markdown-del/.test(html) ? '有' : '无',
  链接形态: /target="_blank"/.test(html)
    ? '<a target=_blank>（新标签）'
    : /<a[ >]/.test(html)
      ? '<a>（同页跳转）'
      : /t-chat-markdown-link/.test(html)
        ? '官方 link 节点（点击抛 node 给业务）'
        : '无',
  图片形态: /t-chat-markdown-image/.test(html)
    ? '官方 -image（宽度靠 app.scss 补）'
    : /<img[^>]+max-w-full/.test(html)
      ? '<img max-w-full>（组件自带约束）'
      : /<img[ >]/.test(html)
        ? '裸 <img>（只靠 .md-render CSS 兜底）'
        : '无',
  表格外层: wrapperOf(html, 'table') || '（无滚动容器）',
  代码块语言: /t-chat-markdown-code__lang/.test(html)
    ? '有可见语言标签'
    : /language-js/.test(html)
      ? '仅 class，无可见标签'
      : '无',
});

const fingerprints = Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, fingerprint(v)]));
const keys = Object.keys(fingerprints.网页开场白);
console.log('\n' + '特征'.padEnd(14) + Object.keys(outputs).map((k) => k.padEnd(26)).join(''));
console.log('-'.repeat(96));
for (const k of keys) {
  console.log(String(k).padEnd(12) + Object.keys(outputs).map((c) => String(fingerprints[c][k]).padEnd(24)).join(''));
}

/* ---------------------------------------------- 4b. 两套网页组件集的逐项差集 */
const setKeys = (set) => Object.keys(set).sort();
const welcomeKeys = setKeys(mod.welcomeMarkdownComponents);
const assistantKeys = setKeys(mod.assistantMarkdownComponents);
const onlyWelcome = welcomeKeys.filter((k) => !assistantKeys.includes(k));
const onlyAssistant = assistantKeys.filter((k) => !welcomeKeys.includes(k));
const OFFICIAL_NODES = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del', 'a',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'code', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
const welcomeMissing = OFFICIAL_NODES.filter((n) => !welcomeKeys.includes(n));
const assistantMissing = OFFICIAL_NODES.filter((n) => !assistantKeys.includes(n));

console.log(`\n网页开场白映射了 ${welcomeKeys.length} 个标签：${welcomeKeys.join(' ')}`);
console.log(`网页 AI 回复映射了 ${assistantKeys.length} 个标签：${assistantKeys.join(' ')}`);
console.log(`  仅开场白有：${onlyWelcome.join(' ') || '（无）'}`);
console.log(`  仅 AI 回复有：${onlyAssistant.join(' ') || '（无）'}`);
console.log(`  未映射（但 .md-render CSS 兜底）：`);
console.log(`    开场白 → ${welcomeMissing.join(' ') || '（无）'}`);
console.log(`    AI 回复 → ${assistantMissing.join(' ') || '（无）'}`);

/* 结论：只在「网页自家两套不一致」或「相对官方缺能力」时才列，避免把探针口径差异当缺陷 */
const findings = [];
if (!onlyWelcome.length && !onlyAssistant.length) {
  findings.push('两套映射标签集合一致 ✅');
} else {
  findings.push(`网页自家两套映射不一致：仅开场白有 [${onlyWelcome.join(' ')}]，仅 AI 回复有 [${onlyAssistant.join(' ')}]`);
}
if (!assistantKeys.includes('a')) {
  findings.push('AI 回复没映射 `a` → 链接没有 target=_blank，点击会**在当前页跳走、把会话顶掉**');
} else if (!/<a[^>]+target="_blank"/.test(outputs.网页AI回复)) {
  findings.push('AI 回复的链接不是新标签打开');
}
if (!welcomeKeys.includes('img')) {
  findings.push('开场白没映射 `img` → 只能靠 `.md-render img{max-width:100%}` 兜底（换容器就失效）');
}
console.log('\n结论：');
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

/* ---------------------------------------------- 4c. 断言（改漂了就退出非 0，别只打印） */
const INDEX_CSS_SRC = read(path.join(FRONTEND, 'src/index.css'));
const asserts = [];
const must = (name, pass, detail = '') => asserts.push({ name, pass, detail });

must('两套映射标签集合完全一致', !onlyWelcome.length && !onlyAssistant.length,
  `仅开场白有 [${onlyWelcome.join(' ')}] / 仅 AI 回复有 [${onlyAssistant.join(' ')}]`);
must('两套都把 table 包进横向滚动容器',
  /overflow-x-auto[^>]*><table/.test(outputs.网页开场白) && /overflow-x-auto[^>]*><table/.test(outputs.网页AI回复));
must('两套的链接都新标签打开（不顶掉当前会话）',
  /<a[^>]+target="_blank"[^>]*rel="noopener/.test(outputs.网页开场白)
  && /<a[^>]+target="_blank"[^>]*rel="noopener/.test(outputs.网页AI回复));

// 代码块：组件映射里不许再出现颜色类（会被 .md-render pre 的特异性搞成「浅灰底 + 近白字」）
const PRE_MAP_LINES = chatSource.split('\n').filter((l) => /^\s*pre: \(/.test(l));
must('能定位到 pre 映射行（脚本前提已变，需更新本检查）', PRE_MAP_LINES.length > 0);
must('pre 映射里不含会与 .md-render pre 打架的颜色类',
  PRE_MAP_LINES.length > 0 && !PRE_MAP_LINES.some((l) => /\b(bg-slate-9|bg-gray-9|text-slate-1|text-white)/.test(l)),
  PRE_MAP_LINES.join(' | ').slice(0, 160));
must('`.md-render` 显式声明了 color（否则继承链会把文字色带跑）',
  /\.md-render pre\s*\{[^}]*color:/.test(INDEX_CSS_SRC));

// ---- B 方案：字号阶梯按官方 em 比例、行高对齐 1.75、软换行渲染成 <br> ----
const headingEm = {};
for (const m of INDEX_CSS_SRC.matchAll(/\.md-render h([1-6])\s*\{\s*font-size:\s*([\d.]+)em\s*;/g)) {
  headingEm[m[1]] = Number(m[2]);
}
const EXPECT_EM = { 1: 2, 2: 1.75, 3: 1.5, 4: 1.25, 5: 1, 6: 0.75 };
const emBad = Object.entries(EXPECT_EM).filter(([n, v]) => headingEm[n] !== v);
must('h1–h6 用官方 chat-markdown 的 em 比例（2 / 1.75 / 1.5 / 1.25 / 1 / 0.75）',
  emBad.length === 0, emBad.map(([n, v]) => `h${n}=${headingEm[n] ?? '缺失'}（应 ${v}）`).join(', '));
must('`.md-render` 行高 = 官方 1.75',
  /\.md-render\s*\{\s*line-height:\s*1\.75;/.test(INDEX_CSS_SRC));
// 行高是继承属性：只要映射里哪个元素自己带 `leading-*`，就会盖掉从 .md-render 继承的 1.75。
// 断言渲染结果里一个 `leading-` 类都没有 —— 比逐个 grep 映射行更可靠（容器也可能带）。
must('渲染结果里没有任何 `leading-*` 类（否则会盖掉 .md-render 的 1.75 行高）',
  !/\bleading-/.test(outputs.网页开场白) && !/\bleading-/.test(outputs.网页AI回复),
  (((outputs.网页开场白 + outputs.网页AI回复).match(/leading-[^\s"]+/g)) || []).slice(0, 4).join(', '));
const MD_CALLS = chatSource.split('\n').filter((l) => /<Markdown\b/.test(l));
must('两处 <Markdown> 都装了 remarkBreaks（否则软换行会挤成一行）',
  MD_CALLS.length === 2 && MD_CALLS.every((l) => /remarkBreaks/.test(l)),
  MD_CALLS.length !== 2 ? `找到 ${MD_CALLS.length} 处 <Markdown>` : MD_CALLS.filter((l) => !/remarkBreaks/.test(l)).join(' | ').slice(0, 160));
must('两处都把段落内软换行渲染成 <br>（对齐小程序 <text> 的折行）',
  /单行回车测试[\s\S]{0,60}<br\s*\/?>/.test(outputs.网页开场白)
  && /单行回车测试[\s\S]{0,60}<br\s*\/?>/.test(outputs.网页AI回复));
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6]
  .filter((n) => new RegExp(`\\.md-render h${n}\\s*\\{[^}]*font-size`).test(INDEX_CSS_SRC));
must('`.md-render` 给了 h1–h6 全部六级的字号（Tailwind preflight 会清空标题默认值）',
  HEADING_LEVELS.length === 6, `只写了 ${HEADING_LEVELS.join('/') || '无'}`);

/* ---- 产物新鲜度：下面第 5 步把 dist 里的 CSS 内联进预览页。产物比源码旧时，
   预览会「说谎」—— 曾经踩过：改完 src/index.css 与 officialMarkdown.generated.css 就跑本检查，
   预览页里内联的还是上一次构建的 CSS，量出来的行高仍是旧的 1.5，被误判成「网页与官方不一致」。
   定位这个问题花掉的力气远大于在这里红一次。 */
const cssArtifacts = fs.existsSync(DIST)
  ? fs.readdirSync(DIST).filter((f) => f.endsWith('.css')).map((f) => path.join(DIST, f))
  : [];
const cssSources = [
  path.join(FRONTEND, 'src/index.css'),
  path.join(FRONTEND, 'src/officialMarkdown.generated.css'),
  path.join(FRONTEND, 'src/pages/Chat.jsx'),
].filter((p) => fs.existsSync(p));
const newestSource = cssSources.length ? Math.max(...cssSources.map((p) => fs.statSync(p).mtimeMs)) : 0;
const oldestArtifact = cssArtifacts.length ? Math.min(...cssArtifacts.map((p) => fs.statSync(p).mtimeMs)) : 0;
must('dist 产物不比样式源码旧（过期产物会让预览说谎，先跑 vite build）',
  cssArtifacts.length > 0 && oldestArtifact >= newestSource,
  cssArtifacts.length
    ? `产物最旧 ${new Date(oldestArtifact).toISOString()} 早于源码最新 ${new Date(newestSource).toISOString()} → 先 npm run build`
    : 'dist/assets 里没有 CSS → 先 npm run build');

console.log('\n断言：');
for (const a of asserts) console.log(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.name}${a.pass || !a.detail ? '' : `  ← ${a.detail}`}`);
const failed = asserts.filter((a) => !a.pass);
console.log(failed.length ? `\n[web-md] ${failed.length} 项不通过` : `\n[web-md] ${asserts.length} 项全部通过`);

/* ---------------------------------------------- 5. 三方并排预览（内联样式，离线可看） */
const pick = (re) => fs.readdirSync(DIST).filter((f) => re.test(f)).map((f) => path.join(DIST, f));
const BASE_CSS = fs.existsSync(DIST) ? pick(/^index-.*\.css$/).map(read).join('\n') : '';
const INDEX_CSS = read(path.join(FRONTEND, 'src/index.css'));
const MD_CSS = fs.existsSync(DIST) ? pick(/^AdminAgentEdit-.*\.css$/).map(read).join('\n') : '';

const columns = Object.entries(outputs)
  .map(([label, html]) => `<section class="col"><h2 class="col-title">${label}</h2><div class="col-body">${html}</div></section>`)
  .join('\n');

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>网页端开场白 Markdown 检查</title>
<style>
${BASE_CSS}
${MD_CSS}
${INDEX_CSS}
html,body{margin:0;background:#eef2f7;font-family:"PingFang SC",system-ui,-apple-system,"Microsoft YaHei",sans-serif}
.wrap{padding:20px}
h1.page{font-size:17px;font-weight:700;color:#0f172a;margin:0 0 6px}
p.page-sub{font-size:12.5px;color:#64748b;margin:0 0 14px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:start}
.col{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
.col-title{font-size:12.5px;font-weight:700;color:#334155;margin:0;padding:9px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.col-body{padding:14px;font-size:14px;color:#334155}
.col-body img{max-width:100%}
</style></head>
<body><div class="wrap">
<h1 class="page">网页端「智能体内页」Markdown 渲染检查</h1>
<p class="page-sub">同一份样本、同一屏。左＝网页开场白（Chat.jsx <code>welcomeMarkdownComponents</code>），中＝网页 AI 回复（<code>assistantMarkdownComponents</code>），右＝官方 chat-markdown 规范（小程序真机同款）。<br>
三列结构完全一致 ⇒ 该位置合规；某一列塌掉/符号裸露/比其他列少东西 ⇒ 就是它的问题。</p>
<div class="grid">
${columns}
</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(path.join(FRONTEND, '.preview/x')), { recursive: true });
const OUT = path.join(FRONTEND, '.preview', 'web-opening-markdown.html');
fs.writeFileSync(OUT, page, 'utf8');
fs.rmSync(`${TEMP}.entry.jsx`, { force: true });
fs.rmSync(`${TEMP}.bundle.cjs`, { force: true });
console.log(`[web-md] 并排预览 → ${path.relative(FRONTEND, OUT)}`);

if (failed.length) process.exit(1);
