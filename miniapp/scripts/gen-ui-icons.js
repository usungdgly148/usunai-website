/**
 * 生成通用 UI 图标样式（src/styles/ui-icons.scss）
 *
 * 与 scripts/gen-tab-icons.js 同一套机制：微信小程序不渲染 <svg> 标签，
 * 所以图标统一走「SVG → sharp → PNG → base64 → CSS background-image」。
 *
 * 改图标：只改下面的 ICONS / ICON_COLORS / ICON_SIZES，然后
 *   NODE_PATH=<sharp 所在 node_modules> node scripts/gen-ui-icons.js
 *
 * ⚠️ sharp 不在 miniapp 的依赖里（构建产物不需要它）。本机可复用 WorkBuddy 的托管依赖：
 *   NODE_PATH="C:/Users/admin/.workbuddy/binaries/node/workspace/node_modules" \
 *     "C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" scripts/gen-ui-icons.js
 * 没有 sharp 时会退回 SVG data URI —— ⚠️ 微信 iOS 不渲染 SVG 背景图，会直接「图标不见了」，
 * 所以生成后必须确认输出里是 image/png。
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

  // 我的资产：钱包（紫色实心，后层浅紫卡片 + 白色扣子）——个人中心「我的服务」宫格
  assets: () =>
    `<rect x='2.6' y='2.8' width='13' height='10' rx='3.2' fill='#b9a8ff' stroke='none'/>` +
    `<rect x='6.6' y='6.4' width='14.8' height='14.6' rx='4' fill='#7c5cf0' stroke='none'/>` +
    `<circle cx='17.2' cy='13.8' r='1.7' fill='#ffffff' stroke='none'/>`,

  // 算力记录：闪电（绿色实心，同色描边把尖角磨圆）
  compute: () =>
    `<path d='M13.6 1.6L4.4 13.1h5.7l-1.1 9.3 9.4-11.9h-5.6z' fill='#1fc98a' stroke='#1fc98a' stroke-width='1.4' stroke-linejoin='round'/>`,

  // 订单记录：文件（橙色实心 + 浅橙折角 + 白色文本行）
  orders: () =>
    `<path d='M6.4 1.8h6.4l5.6 5.6v12.6a2.6 2.6 0 0 1-2.6 2.6H6.4a2.6 2.6 0 0 1-2.6-2.6V4.4A2.6 2.6 0 0 1 6.4 1.8z' fill='#fb923c' stroke='none'/>` +
    `<path d='M12.8 1.8l5.6 5.6h-5.6z' fill='#ffcda1' stroke='none'/>` +
    `<path d='M7.4 12.6h7.4' stroke='#ffffff' stroke-width='1.7' stroke-linecap='round' fill='none'/>` +
    `<path d='M7.4 16.4h5' stroke='#ffffff' stroke-width='1.7' stroke-linecap='round' fill='none'/>`,

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

  // 联系客服：耳机（蓝色实心，头梁 + 两个耳罩）——个人中心「我的服务」宫格
  service: () =>
    `<path d='M4.8 13.6v-1.4a7.2 7.2 0 1 1 14.4 0v1.4' stroke='#3b82f6' stroke-width='2.4' stroke-linecap='round' fill='none'/>` +
    `<rect x='2.4' y='12.4' width='4.8' height='7.8' rx='2.4' fill='#3b82f6' stroke='none'/>` +
    `<rect x='16.8' y='12.4' width='4.8' height='7.8' rx='2.4' fill='#3b82f6' stroke='none'/>`,

  // VIP 徽标：皇冠（白色实心）
  vip: () =>
    `<path d='M3.4 8.2L7.5 11.5L12 4.6l4.5 6.9 4.1-3.3-1.7 10.6H5.1z' fill='#ffffff' stroke='#ffffff' stroke-width='1.2' stroke-linejoin='round'/>`,

  // 算力点数：立体六边形宝石（自外向内三层六边形 + 蓝色渐变，营造厚度与高光）
  power: () =>
    `<defs>` +
    `<linearGradient id='pf-a' x1='0' y1='0' x2='0.65' y2='1'>` +
    `<stop offset='0' stop-color='#cfe0ff'/><stop offset='1' stop-color='#8fb3ff'/>` +
    `</linearGradient>` +
    `<linearGradient id='pf-b' x1='0.2' y1='0' x2='0.8' y2='1'>` +
    `<stop offset='0' stop-color='#7ea8ff'/><stop offset='1' stop-color='#2f5fe0'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<path d='M12 1.4L21.18 6.7V17.3L12 22.6L2.82 17.3V6.7Z' fill='#e2ecff' stroke='none'/>` +
    `<path d='M12 3.4L19.45 7.7V16.3L12 20.6L4.55 16.3V7.7Z' fill='url(#pf-a)' stroke='none'/>` +
    `<path d='M12 5.7L17.46 8.85V15.15L12 18.3L6.54 15.15V8.85Z' fill='url(#pf-b)' stroke='none'/>` +
    `<path d='M12 9.2L14.2 10.5v2.6L12 14.4l-2.2-1.3v-2.6Z' fill='#ffffff' fill-opacity='0.55' stroke='none'/>`,

  // 复制（对话消息操作，Feather copy：两个重叠矩形）
  copy: () =>
    `<rect x='9' y='9' width='13' height='13' rx='2'/>` +
    `<path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/>`,

  // 重新生成（对话消息操作，Feather refresh-cw：循环箭头）
  regenerate: () =>
    `<path d='M23 4v6h-6'/>` +
    `<path d='M1 20v-6h6'/>` +
    `<path d='M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'/>`,

  // 加入资产库（对话消息操作，Feather bookmark-plus：书签 + 加号）
  bookmark: () =>
    `<path d='M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'/>` +
    `<path d='M12 7v6'/>` +
    `<path d='M9 10h6'/>`,
};

/** 默认线性描边色（中性灰蓝，用于搜索/清除/聊天操作类线性图标） */
const STROKE_COLOR = '#8a98ad';
/** 深灰色线性图标（个人中心「使用协议 / 隐私政策 / 模式切换」入口） */
const DARK_ICONS = new Set(['terms', 'privacy', 'theme']);
const DARK_STROKE_COLOR = '#5a6b7e';
/**
 * 分色覆盖：个人中心「我的服务」四宫格用的是彩色图标。
 * ⚠️ 这里只覆盖外层 <g> 的 stroke（图形颜色在 ICONS 里各自 inline 写死）；
 * 想改彩色图标的颜色，改 ICONS 里对应图形的 fill/stroke。
 */
const ICON_COLORS = {
  assets: '#7c5cf0',
  compute: '#1fc98a',
  orders: '#fb923c',
  service: '#3b82f6',
};
/** 分色描边需要的额外位图密度（立体宝石缩到 78px 显示，96px 位图不够） */
const ICON_SIZES = { power: 240 };

function colorOf(key) {
  return ICON_COLORS[key] || (DARK_ICONS.has(key) ? DARK_STROKE_COLOR : STROKE_COLOR);
}

function buildSvg(render, color, size) {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none'>` +
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

async function toDataUri(render, color, size) {
  const svg = buildSvg(render, color, size);
  if (!sharp) return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const buf = await sharp(Buffer.from(svg, 'utf8'), { density: 288 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

(async () => {
  const keys = Object.keys(ICONS);
  const uri = {};
  for (const key of keys) {
    const size = ICON_SIZES[key] || RASTER_SIZE;
    uri[key] = await toDataUri(ICONS[key], colorOf(key), size);
  }

  const lines = [
    '/* 自动生成，请勿手改 —— 改图标请编辑 scripts/gen-ui-icons.js 后重新运行。 */',
    '',
    `/* 通用 UI 图标（搜索 / 清除 / 个人中心我的服务 / 设置项 / 聊天操作），base64 位图 + background-image。模式：${mode} */`,
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
  if (!sharp) {
    console.warn('⚠️ sharp 不可用 → 输出的是 SVG data URI，微信 iOS 不渲染，图标会消失！');
    process.exitCode = 1;
  }
})();
