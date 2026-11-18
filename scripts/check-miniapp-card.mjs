/**
 * 小程序卡片（智能体 / 工作流栅格卡）视觉契约守卫。
 *
 * 为什么单独守：2026-11-18 按主人要求把小程序卡片改成与网页端 `AgentCard` 同构
 * （渐变铺满整卡 + 左上角小图标块 + 名称/描述各定高 2 行），而**这台机器跑不了 taro build**
 * （既有环境问题：输出 Taro banner 后卡死），所以真机构建前唯一能拦回归的就是源码断言。
 *
 * 守三类东西：
 *   1. 结构：新结构必须在、旧封面块必须已消失（防止有人"参照旧版"改回去）。
 *   2. 语义：渐变角度 0° 与小节流 0% 都必须存活 —— 不能出现 `Number(x) || 30` / `|| 20`。
 *   3. 两端一致：蒙版默认浓度必须与网页端 `cardGradient.js` 的常量逐值相同。
 *
 * 只读源码，不建浏览器、不跑构建。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('  ✓', name); return; }
  fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log('  ✗', name, detail);
};

const CARD = 'miniapp/src/components/content-card.tsx';
const SCSS = 'miniapp/src/app.scss';
const TYPES = 'miniapp/src/types.ts';
const API = 'server/miniapp-api.mjs';
const WEB_GRADIENT = 'frontend/src/cardGradient.js';

for (const f of [CARD, SCSS, TYPES, API, WEB_GRADIENT]) {
  if (!fs.existsSync(path.join(ROOT, f))) {
    console.error(`缺少文件：${f}`);
    process.exit(1);
  }
}
const card = read(CARD);
const scss = read(SCSS);

// ── 1. 结构：新结构在、旧封面块不在 ─────────────────────────────────────────
ok('卡片有「图标块 + 名称」的头部容器', card.includes("className='mini-content-card-head'"));
ok('卡片有 56rpx 级图标块 .mini-content-card-tile', card.includes("className='mini-content-card-tile'"));
ok('有 VIP 角标（与标签同一套视觉语言）', card.includes("className='mini-content-card-vip'") && card.includes('item.vip'));
ok('旧「居中大封面」已移除（mini-content-card-cover）', !card.includes('mini-content-card-cover') && !scss.includes('.mini-content-card-cover'));
ok('点击反馈走 hoverClass（两个变体都要有）',
  (card.match(/hoverClass='mini-content-card-hover'/g) || []).length === 2,
  `实际 ${(card.match(/hoverClass=/g) || []).length} 处 hoverClass`);
ok('仍保留「配了链接优先、否则打开自身」的跳转口径', card.includes('navigateLink(resolveLink(link) || fallbackTarget)'));

// ── 2. 样式：定高 + 深色类目翻白 + 不再有旧的 382px 定高 ────────────────────
ok('卡片取消旧 382px 定高（改由内容撑）', !/min-height:\s*382px/.test(scss));
ok('名称定高（两行），保证同页卡片等高', /\.mini-content-grid \.card-title \{[^}]*height:\s*72px/.test(scss));
ok('描述定高（两行）', /\.mini-content-grid \.card-desc \{[^}]*height:\s*68px/.test(scss));
ok('深色类目有翻白规则（标题/描述/标签/人数）',
  ['card-title', 'card-desc', 'tag'].every((k) => scss.includes(`.mini-content-card--dark .${k}`)));
ok('深色类目卡片修正类由组件按 category=private 挂上',
  card.includes('mini-content-card--dark') && card.includes("item.category === 'private'"));

// ── 3. 语义：0 必须存活（两个都是本项目反复踩的坑）────────────────────────────
ok('角度解析不再是 Number(x) || 30', !/Number\(item\.gradientAngle\)\s*\|\|\s*30/.test(card));
ok('有独立的 resolveGradientAngle（0° 走 Number.isFinite 分支）',
  card.includes('function resolveGradientAngle') && card.includes('Number.isFinite(n) ? n : 30'));
ok('蒙版浓度有独立 resolveMaskOpacity，且有 0–100 夹紧',
  card.includes('function resolveMaskOpacity') && card.includes('Math.max(0, Math.min(100, Math.round(n)))'));
ok('蒙版浓度没用 || 兜底吃掉 0', !/maskOpacity[^\n]*\|\|/.test(card));
ok('蒙版层拼在渐变**前面**（多背景下标 0 = 上层）', /\$\{mask\}, \$\{buildGradient\(item\)\}/.test(card));
ok('深色类目不压白蒙版', card.includes("const mask = isDark ? '' : maskOverlayCss(item.maskOpacity)"));

// ── 4. 两端一致：默认浓度必须是同一个数 ────────────────────────────────────
const webDefault = /export const CARD_MASK_OPACITY_DEFAULT\s*=\s*(\d+)/.exec(read(WEB_GRADIENT));
const miniDefault = /const CARD_MASK_OPACITY_DEFAULT\s*=\s*(\d+)/.exec(card);
ok('两端都能解析出蒙版默认值', Boolean(webDefault && miniDefault),
  `${webDefault && webDefault[1]} vs ${miniDefault && miniDefault[1]}`);
ok('蒙版默认浓度两端一致', webDefault && miniDefault && webDefault[1] === miniDefault[1],
  `网页 ${webDefault && webDefault[1]} / 小程序 ${miniDefault && miniDefault[1]}`);

// ── 5. 数据链路：字段类型 + 服务端白名单（少一个就是"后台配了小程序没反应"）───
ok('ContentItem 有 maskOpacity 字段', /maskOpacity\?:\s*number/.test(read(TYPES)));
const api = read(API);
const agentLine = /const AGENT_PUBLIC_FIELDS = \[([\s\S]*?)\];/.exec(api);
const wfLine = /const WORKFLOW_PUBLIC_FIELDS = \[([\s\S]*?)\];/.exec(api);
ok('AGENT_PUBLIC_FIELDS 放行 maskOpacity', Boolean(agentLine && agentLine[1].includes("'maskOpacity'")));
ok('WORKFLOW_PUBLIC_FIELDS 放行 maskOpacity', Boolean(wfLine && wfLine[1].includes("'maskOpacity'")));

console.log(`\n===== ${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) {
  console.error('\n失败项：\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
