/**
 * 产出后台「开场白编辑器」的离线视觉快照，供肉眼验收 —— 与 preview-canvas-snapshot.mjs
 * 同一套路：不必起服务、不必登后台，双击打开 HTML 就能看到真组件长什么样。
 *
 * 为什么要单独做这个：
 *   自测脚本（self-test-chat-markdown.mjs）验的是**渲染结构**，结构对了 UI 仍可能塌
 *   （Tailwind 没生效、图标没渲染、textarea 高度为 0 这类「结构 PASS、眼睛一看就不对」）。
 *   所以这里把内容 SSR 出来、把构建产物里的 Tailwind 基座与官方 md 样式**内联**进 HTML，
 *   再顺手断言几个「塌了就说明构建坏了」的硬指标。
 *
 * 用法：node scripts/preview-opening-editor.mjs
 *   前置：先跑过一次 vite build（Tailwind 基座取自 dist/assets/index-*.css）。
 *   产物：.preview/opening-editor-preview.html（可双击打开）
 *
 * ⚠️ 样式必须内联、不能写 <link href="../../dist/...">：相对路径换个位置就 404，
 *    而「掉样式」和「渲染错」在肉眼上长得一模一样，排查时极易走错方向。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const TEMP = path.join(FRONTEND, '.preview-opening-editor');
const DIST = path.join(FRONTEND, 'dist/assets');
const OUT = path.join(FRONTEND, '.preview', 'opening-editor-preview.html');

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

if (!fs.existsSync(DIST)) {
  console.error('[opening-editor] 找不到 dist/assets —— 先执行 vite build 再跑本脚本');
  process.exit(1);
}
const pick = (re) => fs.readdirSync(DIST).filter((f) => re.test(f)).map((f) => path.join(DIST, f));
const BASE_CSS = pick(/^index-.*\.css$/).map(read).join('\n');
const MD_CSS = pick(/^AdminAgentEdit-.*\.css$/).map(read).join('\n');
if (!BASE_CSS) {
  console.error('[opening-editor] 没找到 Tailwind 基座（dist/assets/index-*.css）');
  process.exit(1);
}

fs.writeFileSync(`${TEMP}.entry.mjs`, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OpeningEditor from '${FRONTEND.replace(/\\/g, '/')}/src/components/OpeningEditor.jsx';
export { renderToStaticMarkup, OpeningEditor, React };
`, 'utf8');

const built = await esbuild.build({
  entryPoints: [`${TEMP}.entry.mjs`],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  target: 'node18',
  logLevel: 'warning',
  absWorkingDir: FRONTEND,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server', 'lucide-react'],
  plugins: [{ name: 'css-stub', setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }],
});
fs.writeFileSync(`${TEMP}.bundle.cjs`, built.outputFiles[0].text, 'utf8');
const mod = require(`${TEMP}.bundle.cjs`);

const RICH = [
  '## 欢迎来到友尚 AI',
  '',
  '我是你的**获客陪跑参谋长**，可以帮你做三件事：',
  '',
  '- 诊断账号：找出内容为什么没有留资',
  '- 出选题：按你的品类给 30 条可直接拍的选题',
  '- 写文案：口播稿 + 分镜建议',
  '',
  '### 你可以直接这样问我',
  '',
  '1. 我是做不锈钢橱柜的，帮我出 10 条抖音选题',
  '2. 这条视频为什么没有咨询',
  '',
  '> 提示：先告诉我你的行业和城市，回答会更准。',
  '',
  '也可以看看我们做过的案例：',
  '',
  '![案例图](https://usunai.top/static/case.png)',
  '',
  '更多资料：[短视频获客资料包](https://usunai.top/pack)',
  '',
  '```js',
  'const 选题 = 30;',
  '```',
  '',
  '| 模块 | 时长 |',
  '| :- | -: |',
  '| 开场 | 5s |',
  '| 正文 | 40s |',
].join('\n');

/** 用例：名称 → 输入（覆盖正常 / 空 / 超限三种状态） */
const CASES = [
  ['正常态', RICH],
  ['空态', ''],
  ['超长（触发计数超限变红）', '这是一段很长的开场白。'.repeat(120)],
];

let failures = 0;
const blocks = CASES.map(([title, value]) => {
  let html = '';
  try {
    html = mod.renderToStaticMarkup(mod.React.createElement(mod.OpeningEditor, { value, onChange() {} }));
  } catch (error) {
    failures += 1;
    console.error(`[opening-editor] FAIL 渲染「${title}」：${error.message}`);
  }
  // 塌了就说明构建/接线坏了：工具栏与上传入口必须在，预览区必须有官方 class
  // （不要拿「开场白」做标识 —— 它只出现在全屏态的标题栏里，非全屏渲染时不存在）
  const must = ['插入图片', '插入链接', '正文'];
  const missing = must.filter((k) => !html.includes(k));
  if (missing.length) {
    failures += 1;
    console.error(`[opening-editor] FAIL 「${title}」缺少：${missing.join(', ')}`);
  }
  if (value && !html.includes('official-md')) {
    failures += 1;
    console.error(`[opening-editor] FAIL 「${title}」预览区没有 official-md`);
  }
  if (!value && !html.includes('未设置开场白')) {
    failures += 1;
    console.error(`[opening-editor] FAIL 「${title}」空态没给占位说明`);
  }
  const buttons = (html.match(/<button/g) || []).length;
  console.log(`  ${missing.length ? 'FAIL' : 'PASS'}  ${title}  ${html.length} 字节 / ${buttons} 个按钮`);
  return `<section class="case"><h2 class="case-title">${title}</h2><div class="case-body">${html}</div></section>`;
}).join('\n');

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>开场白编辑器 · 后台快照</title>
<style>
${BASE_CSS}
${MD_CSS}
html,body{margin:0;background:#f1f5f9;font-family:"PingFang SC",system-ui,-apple-system,"Microsoft YaHei",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px}
h1.page{font-size:18px;font-weight:700;color:#0f172a;margin:0 0 4px}
p.page-sub{font-size:13px;color:#64748b;margin:0 0 20px;line-height:1.6}
.case{margin-bottom:28px}
.case-title{font-size:13px;font-weight:600;color:#475569;margin:0 0 8px}
.case-body{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px}
</style></head>
<body><div class="wrap">
<h1 class="page">后台「开场白」编辑器 · 静态快照</h1>
<p class="page-sub">内容由后台真组件 SSR 产出，样式内联自构建产物（Tailwind 基座 + 官方 chat-markdown 生成物），离线可看。<br>
工具栏点击、图片上传等交互需在后台页面里实际操作 —— 这里只看长什么样。</p>
${blocks}
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page, 'utf8');
fs.rmSync(`${TEMP}.entry.mjs`, { force: true });
fs.rmSync(`${TEMP}.bundle.cjs`, { force: true });

if (failures) {
  console.error(`\n[opening-editor] ${failures} 项不通过`);
  process.exit(1);
}
console.log(`\n[opening-editor] 快照已产出：${path.relative(FRONTEND, OUT)}`);
