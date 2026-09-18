import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADIENT_ANGLE_DEFAULT, gradientCss, hasCustomGradient, resolveGradientAngle } from '../frontend/src/cardGradient.js';

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

// ── ⑥ 源码契约：三个消费方都必须共用同一个实现（不许再内联一份）──────────────
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
}

// ── ⑦ 源码契约：全目录不得再出现 `…gradientAngle) || 30` 这种写法 ─────────────
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
