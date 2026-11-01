/**
 * 生成底部导航栏图标样式（src/styles/tab-icons.scss）
 *
 * 背景：微信小程序 WXML 只渲染已注册的内置组件，Taro 生成的 dist/base.wxml 里
 * 没有 svg / path / rect / linearGradient 等模板，所以「内联 SVG 图标」会被静默丢弃，
 * 表现为——容器渲染正常，但里面只有文字、一个图标都没有。
 * （微信官方文档亦明确：小程序不支持 svg 标签。）
 *
 * 解决：把图标画成 PNG，转 base64 内联进 CSS，通过 background-image + background-size:contain 渲染。
 * 小程序的 background-image 不支持本地相对路径，但支持 data URI；PNG 是兼容性最好的选择
 * （SVG data URI 在部分真机 WebView 下不可靠）。
 *
 * 两套造型（2026-11-02 主人指定「未选中线条 / 选中实心」，参考图：抖音底部栏）：
 *   - 未选中：描边线条（stroke 1.8 + fill=none）
 *   - 选中  ：实心剪影（fill 纯色、无描边、fill-rule=evenodd 让眼睛/横缝/分层镂空）
 * ⚠️ 实心版必须 stroke='none'：哪怕 1.2 的描边也会把 r=1.5 的镂空小孔填死。
 * ⚠️ evenodd 下「相切」安全、「重叠」会被镂空 —— 所以天线杆与头部、提手与箱体
 *    都要画到刚好相切（差 0.1 就会在接缝处挖出一条透明缝）。
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

const NORMAL_COLOR = '#8a98ad';
/* 选中态：纯蓝 #2878e8（iOS 27 Liquid Glass 主色，替代旧蓝紫渐变） */
const ACTIVE_COLOR = '#2878e8';

/**
 * 每个图标两套造型，签名统一为 render(color)：
 *   line  —— 描边线条；个别需要实心小点的位置（机器人眼睛/天线球）用传入的 color
 *   solid —— 实心剪影；忽略 color，颜色由外层 <g fill> 统一给
 */
const ICONS = {
  // 首页：房子（实心版门洞从底边开口，靠 path 单向绕行实现，不用 evenodd）
  home: {
    line: () =>
      `<path d='M3.2 10.8 L12 3.6 L20.8 10.8 L20.8 18.8 A1.6 1.6 0 0 1 19.2 20.4 L4.8 20.4 A1.6 1.6 0 0 1 3.2 18.8 Z'/>` +
      `<path d='M9.3 20.4 L9.3 14.4 L14.7 14.4 L14.7 20.4'/>`,
    solid: () =>
      `<path d='M12 2.6 L21.4 10.1 L19.4 12.4 L19.4 20 A1.5 1.5 0 0 1 17.9 21.5 L15.4 21.5 L15.4 15.4 L8.6 15.4 L8.6 21.5 L6.1 21.5 A1.5 1.5 0 0 1 4.6 20 L4.6 12.4 L2.6 10.1 Z'/>`,
  },

  // 智能体：机器人（天线球 + 天线杆 + 头部；实心版眼睛/嘴靠 evenodd 镂空）
  agents: {
    line: (c) =>
      `<rect x='4.4' y='7.6' width='15.2' height='11.6' rx='3.4'/>` +
      `<path d='M12 7.6 L12 4.9'/>` +
      `<circle cx='12' cy='3.4' r='1.15' fill='${c}' stroke='none'/>` +
      `<circle cx='9.3' cy='12.6' r='1.25' fill='${c}' stroke='none'/>` +
      `<circle cx='14.7' cy='12.6' r='1.25' fill='${c}' stroke='none'/>` +
      `<path d='M9.6 15.9 L14.4 15.9'/>`,
    solid: () =>
      // 🔴 主体与「孔」必须写进**同一条 path**：fill-rule 只在同一 path 的多个子路径之间生效，
      //    拆成 <rect>+<circle> 只会后画盖住先画、眼睛永远镂不出来。
      // ⚠️ 相切的子路径（杆底 7.6 = 头部顶 7.6、球底 4.6 = 杆顶 4.6）在 evenodd 下安全；
      //    一旦重叠就会被镂空，所以这些坐标不能随手改。
      `<path fill-rule='evenodd' d='` +
      // 天线杆
      `M11.1 4.6 L12.9 4.6 L12.9 7.6 L11.1 7.6 Z ` +
      // 天线球
      `M10.6 3.2 A1.4 1.4 0 1 0 13.4 3.2 A1.4 1.4 0 1 0 10.6 3.2 Z ` +
      // 头部圆角矩形
      `M7.8 7.6 L16.2 7.6 A3.4 3.4 0 0 1 19.6 11 L19.6 15.8 A3.4 3.4 0 0 1 16.2 19.2 ` +
      `L7.8 19.2 A3.4 3.4 0 0 1 4.4 15.8 L4.4 11 A3.4 3.4 0 0 1 7.8 7.6 Z ` +
      // 左眼（孔）
      `M7.9 12.6 A1.5 1.5 0 1 0 10.9 12.6 A1.5 1.5 0 1 0 7.9 12.6 Z ` +
      // 右眼（孔）
      `M13.1 12.6 A1.5 1.5 0 1 0 16.1 12.6 A1.5 1.5 0 1 0 13.1 12.6 Z ` +
      // 嘴（孔）
      `M10.35 15.4 L13.65 15.4 A0.75 0.75 0 0 1 14.4 16.15 A0.75 0.75 0 0 1 13.65 16.9 ` +
      `L10.35 16.9 A0.75 0.75 0 0 1 9.6 16.15 A0.75 0.75 0 0 1 10.35 15.4 Z` +
      `'/>`,
  },

  // 工作流：公文包（实心版提手与箱体顶边相切、中间横缝镂空）
  workflows: {
    line: () =>
      `<rect x='3.2' y='7.6' width='17.6' height='11.8' rx='2.4'/>` +
      `<path d='M8.6 7.6 L8.6 5.8 A1.5 1.5 0 0 1 10.1 4.3 L13.9 4.3 A1.5 1.5 0 0 1 15.4 5.8 L15.4 7.6'/>` +
      `<path d='M3.2 13 L20.8 13'/>`,
    solid: () =>
      // 提手与箱体顶边相切（同为 y=7.4），中间横缝与箱体同一个 path 才能镂空
      `<path fill-rule='evenodd' d='` +
      // 提手（实心）
      `M8.8 7.4 L8.8 5.9 A1.4 1.4 0 0 1 10.2 4.5 L13.8 4.5 A1.4 1.4 0 0 1 15.2 5.9 L15.2 7.4 Z ` +
      // 箱体（圆角矩形）
      `M5.8 7.4 L18.2 7.4 A2.6 2.6 0 0 1 20.8 10 L20.8 16.8 A2.6 2.6 0 0 1 18.2 19.4 ` +
      `L5.8 19.4 A2.6 2.6 0 0 1 3.2 16.8 L3.2 10 A2.6 2.6 0 0 1 5.8 7.4 Z ` +
      // 中间横缝（孔，贯穿到左右边缘）
      `M3.2 12.3 L20.8 12.3 L20.8 13.7 L3.2 13.7 Z` +
      `'/>`,
  },

  // 资产：数据库（实心版一条路径画完整圆柱，两条弧带镂空出分层）
  assets: {
    line: () =>
      `<ellipse cx='12' cy='5.6' rx='7.4' ry='2.4'/>` +
      `<path d='M4.6 5.6 L4.6 11.8 C4.6 14.6 19.4 14.6 19.4 11.8 L19.4 5.6'/>` +
      `<path d='M4.6 11.8 L4.6 18 C4.6 20.8 19.4 20.8 19.4 18 L19.4 11.8'/>`,
    solid: () =>
      // 三条子路径必须同一个 path：两条弧形缝与柱体重叠才会被 evenodd 镂空
      `<path fill-rule='evenodd' d='` +
      // 柱体：顶部上半椭圆 + 左右直边 + 底部下半椭圆
      `M4.6 5.6 C4.6 2.8 19.4 2.8 19.4 5.6 L19.4 18.6 C19.4 21.4 4.6 21.4 4.6 18.6 Z ` +
      // 分层缝 1
      `M4.6 10.2 C4.6 13 19.4 13 19.4 10.2 L19.4 11.8 C19.4 14.6 4.6 14.6 4.6 11.8 Z ` +
      // 分层缝 2
      `M4.6 15.4 C4.6 18.2 19.4 18.2 19.4 15.4 L19.4 17 C19.4 19.8 4.6 19.8 4.6 17 Z` +
      `'/>`,
  },

  // 我的：人像（实心版头与肩分离，中间留 2.1 的空隙）
  profile: {
    line: () =>
      `<circle cx='12' cy='7.8' r='3.9'/>` +
      `<path d='M4.6 20.4 C4.6 16.6 8 14 12 14 C16 14 19.4 16.6 19.4 20.4'/>`,
    solid: () =>
      `<circle cx='12' cy='7.6' r='4.2'/>` +
      `<path d='M4.4 21.4 C4.4 16.6 7.9 13.9 12 13.9 C16.1 13.9 19.6 16.6 19.6 21.4 Z'/>`,
  },
};

function buildSvg(render, color, state) {
  const gAttrs =
    state === 'solid'
      ? `fill='${color}' stroke='none' fill-rule='evenodd'`
      : `fill='none' stroke='${color}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'`;
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${RASTER_SIZE}' height='${RASTER_SIZE}' viewBox='0 0 24 24'>` +
    `<g ${gAttrs}>` +
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

async function toDataUri(render, color, state) {
  const svg = buildSvg(render, color, state);
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
    normal[key] = await toDataUri(ICONS[key].line, NORMAL_COLOR, 'line');
    active[key] = await toDataUri(ICONS[key].solid, ACTIVE_COLOR, 'solid');
  }

  const lines = [
    '/* 自动生成，请勿手改 —— 改图标请编辑 scripts/gen-tab-icons.js 后重新运行。 */',
    '',
    '/* 微信小程序不支持 <svg> 标签（dist/base.wxml 无对应模板），内联 SVG 会被静默丢弃；',
    `   故导航图标改为 base64 位图 + background-image 渲染。模式：${mode} */`,
    '',
    '/* 未选中 = 线条描边；选中 = 实心剪影（两套图，不只是换色）。 */',
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
