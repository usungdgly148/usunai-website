/**
 * 生成底部导航栏图标样式（src/styles/tab-icons.scss）
 *
 * 背景：微信小程序 WXML 只渲染已注册的内置组件，Taro 生成的 dist/base.wxml 里
 * 没有 svg / path / rect / linearGradient 等模板，所以「内联 SVG 图标」会被静默丢弃，
 * 表现为——胶囊容器渲染正常，但里面只有文字、一个图标都没有。
 * （微信官方文档亦明确：小程序不支持 svg 标签。）
 *
 * 解决：把图标画成 PNG，转 base64 内联进 CSS，通过 background-image + background-size:contain 渲染。
 * 小程序的 background-image 不支持本地相对路径，但支持 data URI；PNG 是兼容性最好的选择
 * （SVG data URI 在部分真机 WebView 下不可靠）。
 *
 * 依赖：sharp（仅本脚本使用，不进入小程序运行时）。
 *   npm i sharp --prefix <某临时目录>，然后设置 NODE_PATH 指向该目录的 node_modules 运行本脚本。
 * 若 sharp 不可用，脚本自动退回输出 SVG data URI。
 *
 * 改图标：只改下面的 ICONS，然后 `node scripts/gen-tab-icons.js`。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../src/styles/tab-icons.scss');

/** 输出位图边长（px）。24 单位 viewBox 放大 4 倍，保证 3x/4x 屏不糊。 */
const RASTER_SIZE = 96;

const GRAD_ID = 'g';
const DEFS =
  `<defs><linearGradient id='${GRAD_ID}' x1='0' y1='0' x2='24' y2='24' gradientUnits='userSpaceOnUse'>` +
  `<stop offset='0' stop-color='#3b82f6'/><stop offset='1' stop-color='#8b5cf6'/></linearGradient></defs>`;

/** 每个图标传入当前描边色（普通态实色 / 选中态渐变引用），返回 SVG 内部图形。 */
const ICONS = {
  // 首页：房子
  home: () =>
    `<path d='M3.2 10.8 L12 3.6 L20.8 10.8 L20.8 18.8 A1.6 1.6 0 0 1 19.2 20.4 L4.8 20.4 A1.6 1.6 0 0 1 3.2 18.8 Z'/>` +
    `<path d='M9.3 20.4 L9.3 14.4 L14.7 14.4 L14.7 20.4'/>`,

  // 智能体：机器人（天线 + 头部 + 双眼）
  agents: (c) =>
    `<rect x='4.4' y='7.6' width='15.2' height='11.6' rx='3.4'/>` +
    `<path d='M12 7.6 L12 4.9'/>` +
    `<circle cx='12' cy='3.4' r='1.15' fill='${c}' stroke='none'/>` +
    `<circle cx='9.3' cy='12.6' r='1.25' fill='${c}' stroke='none'/>` +
    `<circle cx='14.7' cy='12.6' r='1.25' fill='${c}' stroke='none'/>` +
    `<path d='M9.6 15.9 L14.4 15.9'/>`,

  // 工作流：公文包
  workflows: () =>
    `<rect x='3.2' y='7.6' width='17.6' height='11.8' rx='2.4'/>` +
    `<path d='M8.6 7.6 L8.6 5.8 A1.5 1.5 0 0 1 10.1 4.3 L13.9 4.3 A1.5 1.5 0 0 1 15.4 5.8 L15.4 7.6'/>` +
    `<path d='M3.2 13 L20.8 13'/>`,

  // 资产：数据库（三层圆柱）
  assets: () =>
    `<ellipse cx='12' cy='5.6' rx='7.4' ry='2.4'/>` +
    `<path d='M4.6 5.6 L4.6 11.8 C4.6 14.6 19.4 14.6 19.4 11.8 L19.4 5.6'/>` +
    `<path d='M4.6 11.8 L4.6 18 C4.6 20.8 19.4 20.8 19.4 18 L19.4 11.8'/>`,

  // 我的：人像
  profile: () =>
    `<circle cx='12' cy='7.8' r='3.9'/>` +
    `<path d='M4.6 20.4 C4.6 16.6 8 14 12 14 C16 14 19.4 16.6 19.4 20.4'/>`,
};

const NORMAL_COLOR = '#8a98ad';
/* 选中态：纯蓝 #2878e8（iOS 27 Liquid Glass 主色，替代旧蓝紫渐变） */
const ACTIVE_COLOR = '#2878e8';

function buildSvg(render, color) {
  const defs = color.startsWith('url(') ? DEFS : '';
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${RASTER_SIZE}' height='${RASTER_SIZE}' viewBox='0 0 24 24' fill='none'>` +
    defs +
    `<g stroke='${color}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' fill='none'>` +
    render(color) +
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
  if (!sharp) {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  const buf = await sharp(Buffer.from(svg, 'utf8'), { density: 288 })
    .resize(RASTER_SIZE, RASTER_SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

(async () => {
  const keys = Object.keys(ICONS);
  const normal = {};
  const active = {};
  for (const key of keys) {
    normal[key] = await toDataUri(ICONS[key], NORMAL_COLOR);
    active[key] = await toDataUri(ICONS[key], ACTIVE_COLOR);
  }

  const lines = [
    '/* 自动生成，请勿手改 —— 改图标请编辑 scripts/gen-tab-icons.js 后重新运行。 */',
    '',
    '/* 微信小程序不支持 <svg> 标签（dist/base.wxml 无对应模板），内联 SVG 会被静默丢弃；',
    `   故导航图标改为 base64 位图 + background-image 渲染。模式：${mode} */`,
    '',
    '.mini-tab-icon {',
    '  width: 44rpx;',
    '  height: 44rpx;',
    '  background-repeat: no-repeat;',
    '  background-position: center;',
    '  background-size: contain;',
    '}',
    '',
  ];
  for (const key of keys) lines.push(`.mini-tab-icon-${key} { background-image: url("${normal[key]}"); }`);
  lines.push('');
  for (const key of keys) lines.push(`.mini-tab-item-active .mini-tab-icon-${key} { background-image: url("${active[key]}"); }`);
  lines.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`written ${OUT} — ${keys.length} icons x 2 states, mode=${mode}, ${fs.statSync(OUT).size} bytes`);
})();
