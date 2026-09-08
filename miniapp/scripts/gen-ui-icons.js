/**
 * 生成通用 UI 图标样式（src/styles/ui-icons.scss）
 *
 * 与 scripts/gen-tab-icons.js 同一套机制：微信小程序不渲染 <svg> 标签，
 * 所以图标统一走「SVG → sharp → PNG → base64 → CSS background-image」。
 *
 * 改图标：只改下面的 ICONS，然后
 *   NODE_PATH=<sharp 所在 node_modules> node scripts/gen-ui-icons.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../src/styles/ui-icons.scss');

/** 输出位图边长（px）。24 单位 viewBox 放大 4 倍，保证 3x/4x 屏不糊。 */
const RASTER_SIZE = 96;

/** 每个图标返回 SVG 内部图形（外层 <g> 已带 stroke/stroke-width/fill）。 */
const ICONS = {
  // 放大镜
  search: () =>
    `<circle cx='10.6' cy='10.6' r='6.6'/>` +
    `<path d='M15.4 15.4 L20.8 20.8'/>`,

  // 清除：实心圆底 + 白色叉
  clear: () =>
    `<circle cx='12' cy='12' r='9' fill='#c3ccd8' stroke='none'/>` +
    `<path d='M8.9 8.9 L15.1 15.1' stroke='#ffffff'/>` +
    `<path d='M15.1 8.9 L8.9 15.1' stroke='#ffffff'/>`,

  // 我的资产：包裹 / 盒子（Feather package）
  assets: () =>
    `<path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/>` +
    `<path d='M3.27 6.96L12 12.01l8.73-5.05'/>` +
    `<path d='M12 22.08V12'/>`,

  // 算力记录：闪电（Feather zap）
  compute: () =>
    `<path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z'/>`,

  // 订单记录：文件清单（Feather file-text）
  orders: () =>
    `<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/>` +
    `<path d='M14 2v6h6'/>` +
    `<path d='M16 13H8'/>` +
    `<path d='M16 17H8'/>` +
    `<path d='M10 9H8'/>`,

  // 使用协议：文件 + 对勾（Feather file-check）
  terms: () =>
    `<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/>` +
    `<path d='M14 2v6h6'/>` +
    `<path d='M9 15l2 2 4-4'/>`,

  // 隐私政策：盾牌（Feather shield）
  privacy: () =>
    `<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/>`,

  // 模式切换：月亮（Feather moon）
  theme: () =>
    `<path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/>`,

  // 公告通知：铃铛（Feather bell）
  bell: () =>
    `<path d='M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'/>` +
    `<path d='M13.73 21a2 2 0 0 1-3.46 0'/>`,
};

const STROKE_COLOR = '#8a98ad';
/** 深灰色线性图标（个人中心「使用协议 / 隐私政策 / 模式切换」入口） */
const DARK_ICONS = new Set(['terms', 'privacy', 'theme']);
const DARK_STROKE_COLOR = '#5a6b7e';

function buildSvg(render, color) {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${RASTER_SIZE}' height='${RASTER_SIZE}' viewBox='0 0 24 24' fill='none'>` +
    `<g stroke='${color}' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' fill='none'>` +
    render() +
    `</g></svg>`
  );
}

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = null;
}
const mode = sharp ? 'PNG' : 'SVG(fallback, sharp 不可用)';

async function toDataUri(render, color) {
  const svg = buildSvg(render, color);
  if (!sharp) return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const buf = await sharp(Buffer.from(svg, 'utf8'), { density: 288 })
    .resize(RASTER_SIZE, RASTER_SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

(async () => {
  const keys = Object.keys(ICONS);
  const uri = {};
  for (const key of keys) uri[key] = await toDataUri(ICONS[key], DARK_ICONS.has(key) ? DARK_STROKE_COLOR : STROKE_COLOR);

  const lines = [
    '/* 自动生成，请勿手改 —— 改图标请编辑 scripts/gen-ui-icons.js 后重新运行。 */',
    '',
    `/* 通用 UI 图标（搜索 / 清除），base64 位图 + background-image。模式：${mode} */`,
    '',
  ];
  for (const key of keys) {
    lines.push(`.ui-icon-${key} {`);
    lines.push('  background-repeat: no-repeat;');
    lines.push('  background-position: center;');
    lines.push('  background-size: contain;');
    lines.push(`  background-image: url("${uri[key]}");`);
    lines.push('}');
  }
  lines.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`written ${OUT} — ${keys.length} icons, mode=${mode}, ${fs.statSync(OUT).size} bytes`);
})();
