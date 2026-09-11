/**
 * 生成后台「开场白编辑器」预览用的样式：把 TDesign 官方 chat-markdown 的 wxss
 * 原样搬过来，作用域限定在 `.official-md` 下，并把 rpx 换算成网页 px。
 *
 * 为什么要生成、而不是手抄一套到后台：
 *   后台预览存在的唯一意义是「让运营看到真机上会是什么样」。手抄一份样式，
 *   官方组件一升级就漂了，运营会照着错的预览去排版。吃官方那份 wxss 才是构造性一致。
 *
 * 换算 / 裁剪规则（与 gen-miniapp-preview-style.mjs 同一套约定）：
 *   1. 作用域：`.t-chat-markdown{}` → `.official-md{}`；其余选择器加 `.official-md ` 前缀。
 *      ⚠️ 必须是**后代**选择器。写成复合选择器 `.official-md.t-chat-markdown-p` 要求
 *      两个 class 落在同一元素上，而子节点只是根节点的后代 → 规则全在、样式全不生效。
 *   2. 单位：750rpx 设计宽 → 预览容器按 375px 宽渲染，长度一律 ÷2。
 *   3. 裁剪：`@import` 丢掉（官方三份 wxss 各自 import 同一个 common/style，重复且巨大）。
 *
 * 容错：源文件不存在（例如 miniapp 还没 npm install）时**不报错退出**，
 * 写一份最小兜底样式，避免整个后台构建被一个预览样式卡死。
 *
 * ⚠️ 不要手改产物 frontend/src/officialMarkdown.generated.css。
 *    改的是生成器，frontend 的 predev / prebuild 会自动重新生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD_SRC = path.resolve(HERE, '../../miniapp/node_modules/tdesign-miniprogram/miniprogram_dist/chat-markdown');
const OUT_FILE = path.resolve(HERE, '../src/officialMarkdown.generated.css');

const SCOPE = '.official-md';
/** 750rpx 设计宽 → 375px 预览宽 */
const SCALE = 0.5;

/** 官方 chat-markdown 的三份样式（root / node 无自己的规则 / table / code） */
const SOURCES = [
  'chat-markdown.wxss',
  'chat-markdown-table/chat-markdown-table.wxss',
  'chat-markdown-code/chat-markdown-code.wxss',
];

/** 长度换算：数字 + px/rpx 一律 ÷2（wxss 里只有 rpx，但两种单位一视同仁更省心） */
function scaleLengths(value) {
  if (value.includes('url(')) return value;
  return value.replace(/(-?\d*\.?\d+)(r?px)(?![a-z0-9])/gi, (_m, num) => {
    const px = Number(num) * SCALE;
    return `${Number(px.toFixed(3))}px`;
  });
}

/** 选择器作用域化：根规则换成 .official-md，其余挂成后代 */
function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return s;
      if (s === '.t-chat-markdown') return SCOPE;
      if (s.startsWith('.t-chat-markdown')) return `${SCOPE} ${s}`;
      return s;
    })
    .join(', ');
}

/** 取规则体的声明（原样保留，只做长度换算） */
function declarations(rule) {
  const out = [];
  rule.walkDecls((decl) => {
    out.push(`${decl.prop}: ${scaleLengths(decl.value)}${decl.important ? ' !important' : ''};`);
  });
  return out.join(' ');
}

/**
 * 官方 wxss 覆盖不到、由小程序 `app.scss` 补的规则 —— 真机上有的，预览里也必须有，
 * 否则预览会在这些地方说谎（最典型的是图片：官方没有 `.t-chat-markdown-image` 规则，
 * 真机靠 app.scss 撑成满宽，预览里就退回 `<img>` 的原生小尺寸）。
 *
 * 取值口径与官方那份一致：小程序 app.scss 里的 `Npx` 经 Taro（designWidth 750）折成
 * `Nrpx`，再按 SCALE 换算 → 预览里写 `N/2 px`。
 *   - `.chat-opening-row .t-chat-markdown { font-size: 32px }` → **只补字号 16px**
 *     （⚠️ 行高不要一起写：官方 `.t-chat-markdown` 自己有 `line-height:1.75`，在真机上
 *      正是它生效 —— 开场白若写 1.5 会比助手消息更紧。所以这里也不设 line-height，
 *      让官方那条规则照常起作用。）
 *   - `.t-chat-markdown-image image { display:block; width:100%; margin:12px 0; border-radius:12px }`
 *     → 元素名 `image` 在网页里是 `img`
 *
 * ⚠️ 这段必须排在官方规则**之后**：真机上 app.scss 的选择器比官方更具体，是它赢；
 *    预览里靠「同特异性 + 靠后」复现同一个结果。
 */
const SUPPLEMENT = `/* ---- 补丁：官方 wxss 未覆盖、由小程序 app.scss 提供的规则（见生成器注释） ---- */
${SCOPE} { font-size: 16px; }
${SCOPE} .t-chat-markdown-image img { display: block; width: 100%; margin: 6px 0; border-radius: 6px; }
`;

const FALLBACK = `/* 官方 wxss 源缺失，使用最小兜底：仅保证预览不塌。请先到 miniapp/ 执行 npm install。 */
${SCOPE} { color: rgba(0,0,0,.9); line-height: 1.75; word-break: break-word; }
${SCOPE} .t-chat-markdown-h { font-weight: 700; margin: 12px 0; }
${SCOPE} .t-chat-markdown-h1 { font-size: 28px; }
${SCOPE} .t-chat-markdown-h2 { font-size: 24px; }
${SCOPE} .t-chat-markdown-h3 { font-size: 21px; }
${SCOPE} .t-chat-markdown-p { margin: 12px 0; }
${SCOPE} .t-chat-markdown-list { display: block; padding: 0; margin: 0 0 8px 1.5em; }
${SCOPE} .t-chat-markdown-list__decimal { list-style-type: decimal; }
${SCOPE} .t-chat-markdown-list-item { display: list-item; margin-bottom: 12px; }
${SCOPE} .t-chat-markdown-del { text-decoration: line-through; }
${SCOPE} .t-chat-markdown-blockquote { padding: 0 .75em; border-left: 4px solid #dcdcdc; background: #f3f3f3; margin-bottom: 12px; }
${SCOPE} .t-chat-markdown-codespan { padding: 2px 4px; margin: 0 2px; border-radius: 4px; font-size: .8em; background: #f3f3f3; border: 1px solid #dcdcdc; }
${SCOPE} .t-chat-markdown-link { color: #0052d9; }
${SCOPE} .t-chat-markdown-hr { height: 3px; margin: 12px 0; background: #dcdcdc; border: 0; }
${SCOPE} .t-chat-markdown-code { margin: 8px 0; border-radius: 4px; background: #f6f8fa; border: 1px solid #e1e4e8; overflow: hidden; }
${SCOPE} .t-chat-markdown-code__header { padding: 4px 8px; background: #e1e4e8; }
${SCOPE} .t-chat-markdown-code__lang { font-size: 12px; color: #656d76; }
${SCOPE} .t-chat-markdown-code__content { padding: 8px; overflow-x: auto; }
${SCOPE} .t-chat-markdown-code__text { font-family: 'SF Mono', Monaco, Consolas, monospace; white-space: pre; color: #24292f; }
`;

function main() {
  const missing = SOURCES.filter((f) => !fs.existsSync(path.join(TD_SRC, f)));
  if (missing.length) {
    console.warn(`[official-md] 官方 wxss 缺失：${missing.join(', ')} → 写兜底样式`);
    console.warn(`[official-md] 期望路径：${TD_SRC}`);
    writeIfChanged(FALLBACK + SUPPLEMENT);
    return;
  }

  const chunks = [];
  let rules = 0;
  for (const file of SOURCES) {
    const css = fs.readFileSync(path.join(TD_SRC, file), 'utf8').replace(/@import[^;]+;/g, '');
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      if (rule.parent && rule.parent.type === 'atrule') return; // 官方这三份里没有 @media，保守跳过
      const decls = declarations(rule);
      if (!decls) return;
      chunks.push(`${scopeSelector(rule.selector)} { ${decls} }`);
      rules += 1;
    });
  }

  const header = [
    '/* ============================================================================',
    ' * 自动生成，请勿手改 —— 源文件是 tdesign-miniprogram 的 chat-markdown wxss。',
    ' * 生成器：frontend/scripts/gen-official-markdown-style.mjs',
    ' * 作用：后台「开场白编辑器」的预览与真机跑同一套官方样式，避免运营照着错的预览排版。',
    ` * 本次：${rules} 条规则（作用域 ${SCOPE}，rpx ÷2）`,
    ' * ========================================================================== */',
  ].join('\n');

  writeIfChanged(`${header}\n${chunks.join('\n')}\n${SUPPLEMENT}`);
  console.log(`[official-md] 已生成 officialMarkdown.generated.css：${rules} 条规则`);
}

function writeIfChanged(body) {
  const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (previous === body) {
    console.log('[official-md] 无变化');
    return;
  }
  fs.writeFileSync(OUT_FILE, body, 'utf8');
}

main();
