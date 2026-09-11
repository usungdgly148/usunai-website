/**
 * 「开场白 / AI 回复的 Markdown 渲染」自测。
 *
 * 这个文件的存在理由，是一次真实事故：
 *   对话页里**同时跑着三套渲染器** —— 用户消息走官方 rich-text、AI 回复走官方
 *   chat-markdown、而开场白走的是自研 components/markdown-content.tsx。
 *   后果是同一份 Markdown 换个位置就渲染成两个样（自研那套不支持删除线 / 表格 /
 *   围栏代码块 / 图片，嵌套列表还会被压平），而且 AI 回复里的链接与图片点了完全
 *   没反应（官方把节点点击 triggerEvent 出来，我们没接）。两边分开看都「能用」，
 *   不拿同一份输入并排验根本发现不了。
 *
 * 2026-09-11 的修法：开场白统一走官方 t-chat-markdown，并接住官方的 click 事件。
 * 本脚本把这件事钉死，分四段：
 *   A 源码接线 —— 别再有人把开场白接回自研渲染器 / 把 click 去掉 / 把 breaks 打开
 *   B 产物断言 —— 接线写对了不等于进产物（这个项目的头号顽疾）
 *   C 官方能力 —— 8 条历史缺口对应的节点分支确实在产物里（开场白走的就是这个组件）
 *   D 后台预览 —— 后台预览产出的 class 必须是官方真有的，不许「预览好看、真机难看」
 *
 * 用法：node scripts/self-test-chat-markdown.mjs [--preview]
 *       --preview 额外产出一份可肉眼验收的 HTML（.preview/chat-markdown-preview.html）
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
const TEMP = path.join(FRONTEND, '.selftest-chat-markdown');
const TD = path.join(MINIAPP, 'dist/miniprogram_npm/tdesign-miniprogram');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const CHAT = read(path.join(MINIAPP, 'src/pages/chat/index.tsx'));
const APP_CONFIG = read(path.join(MINIAPP, 'src/app.config.ts'));
const APP_SCSS = read(path.join(MINIAPP, 'src/app.scss'));

/* ============================================================ A. 源码接线 */
check('开场白注册了官方 t-chat-markdown',
  /'t-chat-markdown':\s*'tdesign-miniprogram\/chat-markdown\/chat-markdown'/.test(APP_CONFIG), 'app.config.ts usingComponents');
check('开场白用官方组件渲染', /<t-chat-markdown\s+content=\{agent\.opening\}/.test(CHAT));
check('开场白不再用自研 MarkdownContent', !/MarkdownContent/.test(CHAT), '自研渲染器只应留在公告页 / 法律条款页');
check('AI 回复接住了官方 click', /onClick=\{handleMarkdownNode\}/.test(CHAT));
check('节点点击区分 image 与 link', /node\.type === 'image'/.test(CHAT) && /node\.type !== 'link'/.test(CHAT));
check('图片走 previewImage', /Taro\.previewImage/.test(CHAT));
check('https 链接走站内 webview 页', /\/pages\/webview\/index\?url=/.test(CHAT));
check('非 https 链接退化为复制到剪贴板', /setClipboardData\(\{ data: href \}\)/.test(CHAT));
check('流式光标只在流式的最后一条传入',
  /chatContentProps=\{streaming \? STREAMING_MARKDOWN_PROPS : undefined\}/.test(CHAT));
check('开场白显式 breaks:false（breaks:true 会让换行静默消失）',
  /OPENING_MARKDOWN_OPTIONS = \{ gfm: true, breaks: false \}/.test(CHAT),
  '官方 wxss 没有 .t-chat-markdown-br 规则，br 节点是 0 高度');
check('深浅色 token 仍映射给官方组件', /--td-text-color-primary: var\(--mini-ink\)/.test(APP_SCSS));
check('官方 md 图片补了宽度规则（官方 wxss 没有 -image 规则，默认 320×240px）',
  /\.t-chat-markdown-image image \{/.test(APP_SCSS));
// ⚠️ 开场白只能补 font-size，**不能补 line-height**：官方 `.t-chat-markdown` 自己有
// `line-height:1.75`，而 chat-content 的 `48rpx` 是设在 chat-content 元素上的、到不了 md 元素。
// 这里写 line-height 会把官方值压掉 → 开场白比助手消息更紧（同一份 markdown 两种行距）。
check('开场白补了与官方一致的 font-size', /\.chat-opening-row \.t-chat-markdown \{ font-size: 32px; \}/.test(APP_SCSS));
check('开场白不覆盖官方行高（写 line-height 会让开场白比助手消息更紧）',
  !/\.chat-opening-row \.t-chat-markdown \{[^}]*line-height/.test(APP_SCSS),
  '官方 .t-chat-markdown 是 line-height:1.75，应继承');
check('官方 chat-markdown 的行高确实是 1.75（上面那条断言的依据）',
  /\.t-chat-markdown\s*\{[^}]*line-height:\s*1\.75/.test(read(path.join(TD, 'chat-markdown/chat-markdown.wxss'))),
  '若官方升级改了行高，要重新核对开场白该继承什么');
check('开场白不再自绘气泡（与 assistant 消息同一套排布）', !/chat-opening-bubble/.test(CHAT));

/* ============================================================ B. 产物断言 */
const DIST_CHAT = read(path.join(MINIAPP, 'dist/pages/chat/index.js'));
const DIST_APP_JSON = read(path.join(MINIAPP, 'dist/app.json'));
const DIST_BASE_WXML = read(path.join(MINIAPP, 'dist/base.wxml'));
const DIST_APP_WXSS = read(path.join(MINIAPP, 'dist/app.wxss'));
const DIST_MSG_WXML = read(path.join(TD, 'chat-message/chat-message.wxml'));
const NODE_WXML = read(path.join(TD, 'chat-markdown/chat-markdown-node/chat-markdown-node.wxml'));
const ROOT_WXSS = read(path.join(TD, 'chat-markdown/chat-markdown.wxss'));

const hasDist = !!DIST_CHAT;
if (!hasDist) {
  check('产物存在（先跑 taro build）', false, 'dist/pages/chat/index.js 不存在');
} else {
  check('产物：t-chat-markdown 已注册进 app.json',
    /"t-chat-markdown"\s*:\s*"tdesign-miniprogram\/chat-markdown\/chat-markdown"/.test(DIST_APP_JSON));
  check('产物：模板里有 t-chat-markdown 节点', DIST_BASE_WXML.includes('t-chat-markdown') || DIST_CHAT.includes('t-chat-markdown'));
  check('产物：开场白确实由官方组件渲染',
    /"t-chat-markdown",\{content:[\w.$]+\.opening/.test(DIST_CHAT), '编译后形如 jsx("t-chat-markdown",{content:X.opening,options:…})');
  check('产物：开场白 options = {gfm:!0,breaks:!1}', /breaks:!1/.test(DIST_CHAT),
    'breaks:!1 是硬要求；出现 breaks:!0 就是换行会丢');
  check('产物：click 处理逻辑进了 bundle', /previewImage/.test(DIST_CHAT) && /\/pages\/webview\/index\?url=/.test(DIST_CHAT));
  check('产物：流式 markdownProps 已透传（postbuild 补丁生效）',
    /markdownProps="\{\{chatContentProps\.markdown\}\}"/.test(DIST_MSG_WXML),
    'postbuild-chat-markdown-streaming.js；漏跑 = 流式光标静默失效');
  check('产物：app.wxss 有官方 md 图片宽度规则', /\.t-chat-markdown-image image/.test(DIST_APP_WXSS));
  check('产物：旧开场白气泡样式已清除', !/\.chat-opening-bubble/.test(DIST_APP_WXSS));
  check('产物：chat-markdown 整套组件已复制',
    fs.existsSync(path.join(TD, 'chat-markdown/chat-markdown.wxml')) && !!NODE_WXML,
    'config/index.ts 的 TDESIGN_COMPONENTS 白名单里本来就有（作为 chat-message 的传递依赖）');
  check('产物：官方组件仍带长按选择补丁', /<text selectable>/.test(NODE_WXML), 'postbuild-chat-selectable.js');
}

/* ============================================ C. 官方能力：8 条历史缺口 */
const GAP_BRANCHES = [
  ['删除线', "item.type==='del'"],
  ['围栏代码块', "item.type==='code'"],
  ['表格', "item.type==='table'"],
  ['图片', "item.type==='image'"],
  ['嵌套列表', "item.type==='list'"],
  ['引用块', "item.type==='blockquote'"],
  ['行内代码', "item.type==='codespan'"],
  ['分割线', "item.type==='hr'"],
  ['六级标题', 'h{{item.depth}}'],
];
if (NODE_WXML) {
  for (const [label, token] of GAP_BRANCHES) check(`官方组件支持：${label}`, NODE_WXML.includes(token), token);
  check('官方组件 h4 有独立字号（自研曾把 4-6 级降级成 h3）', /\.t-chat-markdown-h4\{/.test(ROOT_WXSS));
  check('官方组件列表支持嵌套（list-item 里再套一层）', /li\.tokens[\s\S]{0,140}chat-markdown-node/.test(NODE_WXML));
  check('官方组件把节点点击抛给业务（我们已接）', /bindtap="nodeClick"/.test(NODE_WXML));
  // 反面证据：官方确实没给 br 写样式 → 所以开场白必须 breaks:false
  check('官方没有 .t-chat-markdown-br 规则（breaks:true 会丢换行）', !/\.t-chat-markdown-br\{/.test(ROOT_WXSS));
} else {
  check('官方 chat-markdown 产物存在', false, '先跑 taro build + postbuild');
}

/* ============================== D. 后台预览与官方真机的一致性（SSR 真组件） */
let previewHtml = '';
try {
  fs.writeFileSync(`${TEMP}.entry.mjs`, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficialMarkdown } from '${FRONTEND.replace(/\\/g, '/')}/src/officialMarkdown.jsx';
export { renderToStaticMarkup, OfficialMarkdown, React };
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
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
    plugins: [{ name: 'css-stub', setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }],
  });
  fs.writeFileSync(`${TEMP}.bundle.cjs`, built.outputFiles[0].text, 'utf8');
  const mod = require(`${TEMP}.bundle.cjs`);

  const SAMPLE = [
    '## 二级标题', '#### 四级标题', '',
    '正文 **加粗** *斜体* ~~删除线~~ 行内代码 `code`', '',
    // 松散列表（项间留空行）—— remark 会给项内容套 <p>，正好逼出 li 的扁平化；
    // 紧凑列表 remark 本来就不套，测了等于没测。
    '- 无序', '', '  - 嵌套', '', '1. 有序', '',
    '```js', 'const a = 1;', '```', '',
    '| 左 | 右 |', '| :- | -: |', '| 1 | 2 |', '',
    '![图](https://example.com/a.png)', '[链接](https://usunai.top)', '',
    '> 引用', '', '---',
  ].join('\n');
  previewHtml = mod.renderToStaticMarkup(mod.React.createElement(mod.OfficialMarkdown, { value: SAMPLE }));

  // 官方真机上真会出现的 class：官方 wxss 里定义的 + wxml 里引用但官方没写样式的
  const officialClasses = new Set();
  for (const file of [
    'chat-markdown/chat-markdown.wxss',
    'chat-markdown/chat-markdown-table/chat-markdown-table.wxss',
    'chat-markdown/chat-markdown-code/chat-markdown-code.wxss',
  ]) {
    for (const m of read(path.join(TD, file)).matchAll(/\.t-chat-markdown[a-z0-9_-]*/g)) officialClasses.add(m[0].slice(1));
  }
  ['t-chat-markdown-text', 't-chat-markdown-space', 't-chat-markdown-br',
    't-chat-markdown-image', 't-chat-markdown-raw', 't-chat-markdown-ref', 't-chat-markdown-ref-txt',
  ].forEach((c) => officialClasses.add(c));

  const emitted = new Set();
  for (const m of previewHtml.matchAll(/class="([^"]*)"/g)) {
    m[1].split(/\s+/).filter((c) => c.startsWith('t-chat-markdown')).forEach((c) => emitted.add(c));
  }

  const invented = [...emitted].filter((c) => !officialClasses.has(c));
  check('后台预览没有自造「官方不存在」的 class', invented.length === 0, invented.join(', ') || '（无）');

  const EXPECT = ['t-chat-markdown-h2', 't-chat-markdown-h4', 't-chat-markdown-strong', 't-chat-markdown-em',
    't-chat-markdown-del', 't-chat-markdown-codespan', 't-chat-markdown-list', 't-chat-markdown-list-item',
    't-chat-markdown-list__decimal', 't-chat-markdown-code__text', 't-chat-markdown-table__td',
    't-chat-markdown-blockquote', 't-chat-markdown-hr', 't-chat-markdown-image', 't-chat-markdown-link'];
  const missed = EXPECT.filter((c) => !emitted.has(c));
  check('后台预览覆盖官方全部关键节点', missed.length === 0, missed.join(', ') || '（无）');

  const multiline = mod.renderToStaticMarkup(mod.React.createElement(mod.OfficialMarkdown, { value: '第一行\n第二行' }));
  check('后台预览把单行回车渲成换行（对齐真机 breaks:false）', /<br\/?>/.test(multiline),
    'HTML 会把 \n 折成空格，不补 <br> 预览就在骗人');

  // 官方 wxss 覆盖不到、由小程序 app.scss 补的规则，预览也必须带上。
  // 官方 wxss 里没有 .t-chat-markdown-image 规则 → 真机靠 app.scss 撑成满宽；
  // 预览漏了这条，图片就退回 <img> 的原生小尺寸（实测 30px / 父 336px），
  // 而运营正是照着这个预览去插图的。
  const OFFICIAL_CSS = read(path.join(FRONTEND, 'src/officialMarkdown.generated.css'));
  check('预览样式含 app.scss 补的图片宽度规则',
    /\.official-md \.t-chat-markdown-image img \{[^}]*width: 100%[^}]*\}/.test(OFFICIAL_CSS),
    '缺这条，预览里的图片只有原生尺寸，与真机满宽不符');
  check('预览基准字号 = 真机 32rpx（÷2 → 16px）',
    /\.official-md \{ font-size: 16px; \}/.test(OFFICIAL_CSS),
    'app.scss 的 .chat-opening-row .t-chat-markdown 只设 font-size:32px');
  check('预览不覆盖官方行高（SUPPLEMENT 只补字号，行高交给官方 1.75）',
    /^\.official-md \{ font-size: 16px; \}$/m.test(OFFICIAL_CSS),
    'SUPPLEMENT 里一旦出现 line-height，后台预览的行高就与真机不一致');

  // 真机上列表项 / 引用块 / 单元格里**没有** -p 这一层（marked 给的是 text token），
  // 而 remark 会把松散列表项内容包进 <p>。不抹掉，预览行距会比真机大一倍。
  //
  // 断言方式：不数总数（样本里有几个顶层段落是样本自己的事，写死数字极易误报），
  // 而是走一遍标签栈，检查**扁平容器内部**有没有出现 -p —— 这才是真不变量。
  const FLAT_OWNERS = ['t-chat-markdown-list-item', 't-chat-markdown-blockquote',
    't-chat-markdown-table__th', 't-chat-markdown-table__td'];
  const stack = [];
  const nestedInFlat = [];
  let topLevelP = 0;
  for (const m of previewHtml.matchAll(/<div\b([^>]*)>|<\/div>/g)) {
    if (m[0] === '</div>') { stack.pop(); continue; }
    const cls = (/class="([^"]*)"/.exec(m[1]) || [, ''])[1];
    const isP = /(^|\s)t-chat-markdown-p(\s|$)/.test(cls);
    if (isP) {
      const owner = [...stack].reverse().find((c) => FLAT_OWNERS.some((f) => c.includes(f)));
      if (owner) nestedInFlat.push(owner);
      else topLevelP += 1;
    }
    stack.push(cls);
  }
  check('后台预览没在列表/引用/单元格里多套一层段落', nestedInFlat.length === 0,
    nestedInFlat.length ? `有 -p 落在：${nestedInFlat.join(' / ')}` : `（顶层段落 ${topLevelP} 个，均合法）`);
} catch (error) {
  check('后台预览渲染（SSR 真组件）', false, error?.message || String(error));
} finally {
  fs.rmSync(`${TEMP}.entry.mjs`, { force: true });
  fs.rmSync(`${TEMP}.bundle.cjs`, { force: true });
}

/* ================================================================ 输出 */
const failed = results.filter((r) => !r.pass);
for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\nchat-markdown 自测：通过 ${results.length - failed.length}/${results.length}`);

if (process.argv.includes('--preview') && previewHtml) {
  const outDir = path.join(FRONTEND, '.preview');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'chat-markdown-preview.html');
  // 官方样式**内联**进预览页：不写 <link>，否则换目录打开就掉样式，
  // 而「预览掉样式」和「预览渲染错」长得一模一样，很容易白排查一轮。
  const officialCss = read(path.join(FRONTEND, 'src/officialMarkdown.generated.css'));
  fs.writeFileSync(file, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<title>开场白后台预览渲染结果</title>
<style>body{margin:0;padding:24px;background:#eef2f7;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 6px 22px rgba(15,50,91,.1);max-width:520px}
h1{font-size:18px;margin:0 0 4px}.sub{color:#5d7391;margin-bottom:18px;font-size:13px}
${officialCss}</style></head><body>
<h1>后台「开场白」预览渲染结果</h1>
<div class="sub">用的就是后台真组件 OfficialMarkdown（react-markdown + 官方 class + 官方 wxss 生成物）</div>
<div class="card">${previewHtml}</div>
</body></html>`, 'utf8');
  console.log(`预览 → ${file}`);
}

if (failed.length) process.exit(1);
