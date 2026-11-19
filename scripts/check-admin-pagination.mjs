/**
 * 后台分页跳转守卫（用户管理 / 资产管理 / 算力中心 / 订单财务）。
 *
 * 唯一实现 = `frontend/src/adminUI.jsx` 的 `AdminPagination`，四个板块用 `showJump` 显式开启。
 * 用户端那套 `components/UserPagination.jsx` 是给会员中心用的，绝不能被顺手改掉。
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

const UI = 'frontend/src/adminUI.jsx';
const PAGES = [
  ['用户管理', 'frontend/src/pages/AdminUsers.jsx'],
  ['资产管理', 'frontend/src/pages/AdminAssets.jsx'],
  ['算力中心', 'frontend/src/pages/AdminCompute.jsx'],
  ['订单财务', 'frontend/src/pages/AdminOrders.jsx'],
];
for (const f of [UI, ...PAGES.map(([, p]) => p), 'frontend/src/components/UserPagination.jsx', 'frontend/src/pages/AdminAgents.jsx']) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.error(`缺少文件：${f}`); process.exit(1); }
}
const ui = read(UI);
const component = /export function AdminPagination\([\s\S]*?\n\}/.exec(ui);
ok('AdminPagination 组件存在', Boolean(component));
const src = component ? component[0] : '';

// ── 共享组件：输入 + 按钮 + 校验 ────────────────────────────────────────────
ok('showJump 默认 false（不误改其他复用方）', /showJump\s*=\s*false/.test(src));
ok('页码输入框有 aria-label「跳转页码」', src.includes('aria-label="跳转页码"'));
ok('输入框限定数字键盘（inputMode=numeric）', src.includes('inputMode="numeric"'));
ok('有「跳转」按钮且调用统一的 jumpToPage', />跳转</.test(src) && /onClick=\{jumpToPage\}/.test(src));
ok('回车与点击走同一条跳转逻辑', /e\.key === 'Enter'/.test(src) && src.includes('jumpToPage();'));
ok('空值 / 非数字 / 小数都会被拦下', /!raw\s*\|\|/.test(src) && /!Number\.isFinite\(typed\)/.test(src) && /!Number\.isInteger\(typed\)/.test(src));
ok('越界页码自动纠正到 1 - totalPages', /Math\.min\(Math\.max\(1, typed\), totalPages\)/.test(src));
ok('非法输入有 role=alert 的提示', src.includes('role="alert"') && src.includes('整数页码'));
ok('跳转只改列表页 page，不另存一份当前页', !/setCurrent/.test(src) && /onPageChange\(target\)/.test(src));

// 原有分页交互一样都不能少
ok('原有「上一页 / 下一页」与禁用态保留', src.includes('disabled={current <= 1}') && src.includes('disabled={current >= totalPages}'));
ok('原有「共 N 条，当前 X-Y 条」保留', src.includes('共 {total} 条，当前 {start}-{end} 条'));
ok('原有「第 X / Y 页」保留', src.includes('第 {current} / {totalPages} 页'));
ok('新增按钮沿用原按钮同一套 class', src.includes('jumpButtonClass') && src.includes('border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'));

// ── 四个板块：各自显式开启，行为一致 ────────────────────────────────────────
for (const [label, file] of PAGES) {
  const text = read(file);
  ok(`${label} 已开启页码跳转`, /<AdminPagination[^>]*\bshowJump\b[^>]*\/>/.test(text));
}

// 作用范围：智能体设置与用户端分页不受影响
ok('智能体设置仍用原分页（未开 showJump）',
  !/<AdminPagination[^>]*\bshowJump\b[^>]*\/>/.test(read('frontend/src/pages/AdminAgents.jsx')));
const userFacing = read('frontend/src/components/UserPagination.jsx');
ok('用户端 UserPagination 未被加入跳转输入', !userFacing.includes('跳转') && !userFacing.includes('aria-label'));

console.log(`\n===== ${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) {
  console.error('\n失败项：\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
