import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARD_MASK_OPACITY_DEFAULT,
  cardSurfaceCss,
  GRADIENT_ANGLE_DEFAULT,
  gradientCss,
  hasCustomGradient,
  maskOverlayCss,
  resolveGradientAngle,
  resolveMaskOpacity,
} from '../frontend/src/cardGradient.js';

/**
 * 回归（纯单元 + 源码契约）：卡片渐变的角度取值 / 渐变色生成 / 优先级。
 *
 * 为什么单独守（2026-09-18 线上报障「有些卡片渐变颜色和角度不生效」）：
 *   ① 角度处理写成了 `Number(x) || 30` —— 0° 是合法角度（后台预设里就有 0°），
 *      但 0 是 falsy，于是被悄悄换成 30°。三处都这么写，连后台预览也一起骗人。
 *   ② 网页卡片把「分类主题」判在自定义渐变**前面**（theme ? theme.header : 自定义），
 *      于是 short-video / private / geo 三类卡片的颜色与角度被整段丢弃、永远渲染成硬编码 135°。
 *      线上当时 35 个智能体里 19 个命中。而小程序端（content-card.tsx）一直是「自定义优先」
 *      —— 同一张卡在两端不是一个样。后台「渐变预览」又只看自定义 → 三处三个样。
 *
 * ⚠️ 本脚本不碰网络、不建浏览器：纯函数断言 + 对源码文本做契约断言。
 * ⚠️ 源码契约只扫「精确代码形态」，不扫自由文本，所以注释里提到旧写法不会误报。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(HERE, '..', 'frontend', 'src');

// ── ① 角度：0 必须活下来（这条就是线上那个 bug 的反例）──────────────────────
assert.equal(resolveGradientAngle(0), 0, '0° 是合法角度，绝不能被当成缺省换成 30°');
assert.equal(resolveGradientAngle('0'), 0, '0 的字符串形态同样必须保留');
assert.equal(gradientCss({ gradientFrom: '#fde0d3', gradientTo: '#FFFFFF', gradientAngle: 0 }),
  'linear-gradient(0deg, #fde0d3, #FFFFFF)', '角度 0 必须原样进 CSS');

// ── ② 角度：只有「真的没有 / 不是数」才回落默认值 ─────────────────────────────
for (const empty of [null, undefined, '']) {
  assert.equal(resolveGradientAngle(empty), GRADIENT_ANGLE_DEFAULT,
    `缺省值 ${JSON.stringify(empty)} 应回落 ${GRADIENT_ANGLE_DEFAULT}`);
}
for (const bad of ['abc', {}, [], NaN]) {
  assert.equal(resolveGradientAngle(bad), GRADIENT_ANGLE_DEFAULT,
    `非数值 ${JSON.stringify(bad)} 应回落 ${GRADIENT_ANGLE_DEFAULT}`);
}
assert.equal(GRADIENT_ANGLE_DEFAULT, 30, '后台提示写的是「默认 30°」，两处必须一致');

// ── ③ 角度：正常值原样透传（线上存量就是 30 / 170 / 175 / 180 这几种）────────
for (const v of [30, 170, 175, 180, 360, '180']) {
  assert.equal(resolveGradientAngle(v), Number(v), `正常角度 ${v} 应原样透传`);
}

// ── ④ hasCustomGradient：任一色有值即算「配过」────────────────────────────────
assert.equal(hasCustomGradient({}), false);
assert.equal(hasCustomGradient({ gradientFrom: '', gradientTo: '' }), false);
assert.equal(hasCustomGradient({ gradientFrom: '#fde0d3' }), true, '只配了起始色也算配过');
assert.equal(hasCustomGradient({ gradientTo: '#FFFFFF' }), true, '只配了结束色也算配过');
assert.equal(hasCustomGradient(null), false);

// ── ⑤ gradientCss：缺色时用传入的兜底色 ──────────────────────────────────────
assert.equal(gradientCss({}, '#DBEAFE', '#FFFFFF'), 'linear-gradient(30deg, #DBEAFE, #FFFFFF)');
assert.equal(gradientCss({ gradientFrom: '#fde0d3' }, '#DBEAFE', '#FFFFFF'),
  'linear-gradient(30deg, #fde0d3, #FFFFFF)', '只给了起始色时结束色走兜底');

// ── ⑥ 白色蒙版：0 同样必须活下来（跟角度是同一个坑，2026-11-18 加）────────────
assert.equal(resolveMaskOpacity(0), 0, '0% 是合法值（= 不要蒙版），绝不能被当成缺省换成 30%');
assert.equal(resolveMaskOpacity('0'), 0, '0 的字符串形态同样必须保留');
assert.equal(maskOverlayCss(0), '', '0% 时不应产出任何蒙版层');
assert.equal(cardSurfaceCss('linear-gradient(30deg, #DBEAFE, #FFFFFF)', 0),
  'linear-gradient(30deg, #DBEAFE, #FFFFFF)', '0% 时卡片背景必须与改版前的纯渐变逐字节一致');

// 缺省 / 脏数据才回落 30%
for (const empty of [null, undefined, '']) {
  assert.equal(resolveMaskOpacity(empty), CARD_MASK_OPACITY_DEFAULT,
    `缺省值 ${JSON.stringify(empty)} 应回落 ${CARD_MASK_OPACITY_DEFAULT}`);
}
for (const bad of ['abc', {}, [], NaN, true]) {
  assert.equal(resolveMaskOpacity(bad), CARD_MASK_OPACITY_DEFAULT,
    `非数值 ${JSON.stringify(bad)} 应回落 ${CARD_MASK_OPACITY_DEFAULT}`);
}
assert.equal(CARD_MASK_OPACITY_DEFAULT, 20, '后台默认值 20% 必须与函数缺省一致（30% 会把浅渐变洗成白底）');

// 越界夹紧 + 取整，不报错
assert.equal(resolveMaskOpacity(150), 100, '超过 100 夹到 100');
assert.equal(resolveMaskOpacity(-20), 0, '负数夹到 0');
assert.equal(resolveMaskOpacity('42.6'), 43, '小数四舍五入成整数');
for (const v of [10, 30, 55, 100, '70']) {
  assert.equal(resolveMaskOpacity(v), Math.round(Number(v)), `正常浓度 ${v} 应原样透传`);
}

// 蒙版必须叠在渐变**前面**（CSS 多背景里前者在上层），且只叠加不替换
const MASK30 = 'linear-gradient(rgba(255,255,255,0.3), rgba(255,255,255,0.3))';
assert.equal(maskOverlayCss(30), MASK30);
assert.equal(cardSurfaceCss('linear-gradient(135deg, #DBEAFE, #FFFFFF)', 30),
  MASK30 + ', linear-gradient(135deg, #DBEAFE, #FFFFFF)',
  '蒙版在下标 0、原渐变原样挂在后面 —— 色相与角度都不许被改');
assert.ok(cardSurfaceCss('X', 30).endsWith(', X'), '原背景必须完整保留在末尾');

// ── ⑦ 源码契约：三个消费方都必须共用同一个实现（不许再内联一份）──────────────
const read = (rel) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8');

const card = read('components.jsx');
assert.ok(card.includes("from './cardGradient.js'"), 'components.jsx 必须 import cardGradient.js');
assert.ok(card.includes('hasCustomGradient(item) ? null : theme'),
  '网页卡片必须「自定义渐变优先于分类主题」（与小程序端一致）');
assert.ok(!card.includes('const headerBg = theme ?'),
  '不得回退到「分类主题优先」——那会把 short-video/private/geo 三类卡片的颜色和角度整段丢弃');

for (const rel of ['pages/AdminAgentEdit.jsx', 'pages/AdminWorkflowEdit.jsx']) {
  const src = read(rel);
  assert.ok(src.includes("from '../cardGradient.js'"), `${rel} 必须 import cardGradient.js`);
  assert.ok(src.includes('gradientCss(form'), `${rel} 的渐变预览必须走 gradientCss`);
  // 2026-11-18：预览必须连蒙版一起算，否则管理员调浓度时预览不变 = 又是「看到的是假象」
  assert.ok(src.includes('cardSurfaceCss(gradientCss(form'), `${rel} 的渐变预览必须叠上蒙版（cardSurfaceCss）`);
  assert.ok(src.includes('maskOpacity'), `${rel} 必须有「蒙版透明度」配置项`);
}

// 卡片根节点必须用「蒙版 + 渐变」的合成结果，不许退回只铺裸渐变（否则后台配置项形同虚设）
assert.ok(card.includes('const surfaceBg ='), 'components.jsx 必须用 surfaceBg 承载卡片背景');
assert.ok(card.includes('cardSurfaceCss(headerBg'), '卡片背景必须经 cardSurfaceCss 叠蒙版');
assert.ok(card.includes('style={{ background: surfaceBg }}'), '卡片根节点必须把 surfaceBg 真正用上');
assert.ok(!/maskOpacity\s*\)\s*\|\|\s*30/.test(card), '不得用 `maskOpacity || 30` 取浓度（0% 会失效）');

// ── ⑧ 源码契约：全目录不得再出现 `…gradientAngle) || 30` 这种写法 ─────────────
const BAD_ANGLE = /\bgradientAngle\s*\)\s*\|\|\s*30/;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  return /\.(js|jsx|ts|tsx)$/.test(e.name) ? [full] : [];
});
const offenders = walk(FRONTEND_SRC)
  .filter((f) => BAD_ANGLE.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(FRONTEND_SRC, f));
assert.deepEqual(offenders, [],
  `这些文件又在用 \`|| 30\` 取角度（0° 会变成 30°）：${offenders.join(', ')}`);

console.log('check-card-gradient: ALL PASS');
console.log('  · 0° 不再被换成 30°（含预览）');
console.log('  · 网页卡片改为「自定义渐变优先」，与小程序一致');
console.log('  · 三个消费方共用 frontend/src/cardGradient.js（唯一实现）');
