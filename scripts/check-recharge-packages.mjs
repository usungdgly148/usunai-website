// 回归：网页端「算力充值」弹窗只展示已上架套餐（与小程序端口径一致）
// 背景：2026-11-01 线上问题 —— 后台设为「未上架」的套餐出现在会员的充值弹窗里，
//       根因是 store 的 computePackages 是后台全量数据，而 RechargeDialog 直接全量渲染。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('  ✓', name + (detail ? ` — ${detail}` : '')); return; }
  fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log('  ✗', name + (detail ? ` — ${detail}` : ''));
};

const components = read('frontend/src/components.jsx');
const appSrc = read('frontend/src/App.jsx');
const storeSrc = read('frontend/src/store.jsx');
const miniappSrc = read('server/miniapp-api.mjs');
const adminSrc = read('frontend/src/pages/AdminCompute.jsx');

// 只截取 RechargeDialog 组件体，避免误伤同文件其它列表（侧边栏菜单等）
const start = components.indexOf('export function RechargeDialog');
const end = components.indexOf('export function', start + 10);
const dialog = start >= 0 ? components.slice(start, end > start ? end : undefined) : '';

ok('RechargeDialog 组件存在', Boolean(dialog));
ok('弹窗按「已上架」过滤（published !== false，缺省视为上架）',
  dialog.includes('.filter((pkg) => pkg && pkg.published !== false)'));
ok('弹窗按 sortOrder 排序（与小程序端一致）',
  dialog.includes('.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))'));
// 断言 JSX 表达式而不是中文文案：注释里解释背景时会写到「未上架」，按字面量查会误报
ok('不再渲染上架状态徽标（无 pkg.published 三元 + 无绿色徽标底）',
  !dialog.includes('pkg.published ?') && !dialog.includes('bg-emerald-50 text-emerald-700'));
ok('过滤后不会误删「后台暂未设置算力套餐」空态',
  dialog.includes('后台暂未设置算力套餐'));

// 小程序端基准：它才是"正常行为"的参照，口径不能被改偏
ok('小程序端仍用 isPublished（published !== false）过滤 computePackages',
  /computePackages: asCollection\(config\.computePackages\)\s*\n\s*\.filter\(isPublished\)/.test(miniappSrc));

// 后台必须保留全量（能看到并切换未上架项），过滤只能发生在展示层
ok('后台管理页仍展示上架状态并可切换',
  adminSrc.includes("pkg.published ? '上架中' : '已下架'") && adminSrc.includes('togglePackagePublished(pkg.id)'));
ok('store 未对 computePackages 做全局过滤（否则后台看不到未上架项）',
  !/setComputePackages\([\s\S]{0,160}filter\([\s\S]{0,80}published/.test(storeSrc));

// 调用方仍把全量交进来，由组件自己收敛（契约不变）
ok('App.jsx 仍以 packages={computePackages} 传入',
  appSrc.includes('<RechargeDialog packages={computePackages}'));

console.log(`\n===== ${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) {
  console.error('\n失败项：\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
