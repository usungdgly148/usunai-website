/**
 * 生成「后台 → 小程序设计」画布用的样式：把 miniapp/src/app.scss 原样搬过来，
 * 全部作用域限定在 `.miniapp-stage` 下，并把小程序长度单位换算成画布 px。
 *
 * 为什么要生成、而不是手抄一份到后台：
 *   画布「跟真机长得一样」这件事，靠人肉同步迟早会漂 —— 小程序改一次卡片样式，
 *   后台就得记得同步一次。这里让画布直接吃真机那份样式，app.scss 改了画布自动跟着变。
 *   （画布里的组件同样是真机组件，见 src/miniapp-preview/index.jsx。）
 *
 * 三条换算 / 裁剪规则：
 *   1. 作用域：每条选择器加 `.miniapp-stage ` 前缀；`page{}` 直接改写成 `.miniapp-stage{}`
 *      —— 后台自己的全局元素不受影响，画布内又能拿到 `--mini-*` 那套 token。
 *   2. 单位：小程序设计宽 750rpx，画布固定 375px 宽，所以所有长度 ÷2。
 *      app.scss 里 px 与 rpx 等价（Taro 的 postcss-pxtransform 配了 designWidth: 750，
 *      换算比例正好 1:1，dist/app.wxss 里 36px 出来就是 36rpx），所以两种单位一视同仁。
 *      带 url() 的声明整条跳过 —— 图标是 base64，里面可能碰巧出现「3px」这种片段。
 *   3. 裁剪：`@import` 由图标白名单单独取（否则 60KB base64 全进后台包）；
 *      `@media` 只服务资产页 / 记录页的窄屏，画布不渲染那两个页面，直接丢。
 *
 * ⚠️ 不要手改产物 frontend/src/miniappPreview.css。
 *    改 app.scss 即可，frontend 的 predev / prebuild 会自动重新生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINIAPP_SRC = path.resolve(HERE, '../../miniapp/src');
const OUT_FILE = path.resolve(HERE, '../src/miniappPreview.css');

const STAGE = '.miniapp-stage';
/** 750rpx 设计宽 → 375px 画布宽 */
const SCALE = 0.5;

/** 画布真正用得上的图标（底部导航 5 个 + 搜索/清除/公告铃铛），其余整条丢弃 */
const ICON_WHITELIST = [
  /^\.mini-tab-icon$/,
  /^\.mini-tab-icon-(home|agents|workflows|assets|profile)$/,
  /^\.mini-tab-item-active \.mini-tab-icon-(home|agents|workflows|assets|profile)$/,
  /^\.ui-icon-(search|clear|bell)$/,
];

/** 长度换算：数字 + px/rpx 一律 ÷2；带 url() 的值原样返回（base64 里不能乱改） */
function scaleLengths(value) {
  if (value.includes('url(')) return value;
  return value.replace(/(-?\d*\.?\d+)(r?px)(?![a-z0-9])/gi, (_match, num) => {
    const px = Number(num) * SCALE;
    return `${Number(px.toFixed(4))}px`;
  });
}

/** 选择器加作用域。`page` 是画布自己的根，直接替换而不是加前缀。 */
function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const one = part.trim();
      if (!one) return '';
      if (one === 'page') return STAGE;
      if (one.startsWith(`${STAGE} `) || one === STAGE) return one;
      return `${STAGE} ${one}`;
    })
    .filter(Boolean)
    .join(', ');
}

/** 一条规则的声明部分 → 单行 CSS 文本（app.scss 是扁平语法，规则里只有 decl） */
function declarations(node) {
  return node.nodes
    .filter((child) => child.type === 'decl')
    .map((child) => `${child.prop}: ${scaleLengths(child.value)}${child.important ? ' !important' : ''};`)
    .join(' ');
}

function iconRules(target) {
  const file = path.resolve(MINIAPP_SRC, `${target}.scss`);
  if (!/^\.\/styles\/(?:tab-icons|ui-icons)$/.test(target) || !fs.existsSync(file)) return [];
  const parsed = postcss.parse(fs.readFileSync(file, 'utf8'));
  return parsed.nodes
    .filter((node) => node.type === 'rule' && ICON_WHITELIST.some((pattern) => pattern.test(node.selector.trim())))
    .map((node) => `${scopeSelector(node.selector)} { ${declarations(node)} }`);
}

function main() {
  const source = fs.readFileSync(path.join(MINIAPP_SRC, 'app.scss'), 'utf8');
  const root = postcss.parse(source);
  const chunks = [];
  const stats = { rules: 0, icons: 0, keyframes: 0, skippedMedia: 0 };

  for (const node of root.nodes) {
    if (node.type === 'atrule') {
      if (node.name === 'import') {
        const target = String(node.params || '').replace(/['"]/g, '');
        const rules = iconRules(target);
        stats.icons += rules.length;
        chunks.push(...rules);
        continue;
      }
      if (node.name === 'media') {
        stats.skippedMedia += 1;
        continue;
      }
      if (node.name === 'keyframes') {
        stats.keyframes += 1;
        chunks.push(node.toString());
        continue;
      }
      continue;
    }
    if (node.type !== 'rule') continue;
    const decls = declarations(node);
    if (!decls) continue;
    chunks.push(`${scopeSelector(node.selector)} { ${decls} }`);
    stats.rules += 1;
  }

  const header = [
    '/* ============================================================================',
    ' * 自动生成，请勿手改 —— 源文件是 miniapp/src/app.scss（真机那份）。',
    ' * 生成器：frontend/scripts/gen-miniapp-preview-style.mjs',
    ' * 作用：后台「小程序设计」画布直接复用真机样式，保证画布 = 真机的构造性一致。',
    ` * 本次：${stats.rules} 条规则 / ${stats.icons} 条图标 / ${stats.keyframes} 组 keyframes` +
      `（跳过 ${stats.skippedMedia} 个 @media，画布不渲染那两个页面）`,
    ' * ========================================================================== */',
  ].join('\n');

  const body = `${header}\n${chunks.join('\n')}\n`;
  const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (previous === body) {
    console.log(`[miniapp-preview] 样式无变化（${stats.rules} 条规则 / ${stats.icons} 条图标）`);
    return;
  }
  fs.writeFileSync(OUT_FILE, body, 'utf8');
  console.log(`[miniapp-preview] 已生成 miniappPreview.css：${stats.rules} 条规则 / ${stats.icons} 条图标 / ${stats.keyframes} 组 keyframes`);
}

main();
