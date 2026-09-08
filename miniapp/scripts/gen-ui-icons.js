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
};

const STROKE_COLOR = '#8a98ad';

function buildSvg(render) {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${RASTER_SIZE}' height='${RASTER_SIZE}' viewBox='0 0 24 24' fill='none'>` +
    `<g stroke='${STROKE_COLOR}' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' fill='none'>` +
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

async function toDataUri(render) {
  const svg = buildSvg(render);
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
  for (const key of keys) uri[key] = await toDataUri(ICONS[key]);

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
