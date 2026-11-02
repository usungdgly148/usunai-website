// 侧边栏导航外观守卫（2026-10-28 立规 / 2026-11-03 改选中态配色）
// 规则：分类选中态 = 大圆弧胶囊（rounded-full）+ 实心橙底 bg-brand-600 + 白字白图标，
//      **不画左侧竖线**。这条规则只在 CSS 类里体现，函数行为完全不变，因此只能靠源码断言守。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'frontend', 'src', 'components.jsx');

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log('  ✓', name + (detail ? ` — ${detail}` : ''));
    return;
  }
  fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log('  ✗', name + (detail ? ` — ${detail}` : ''));
};

ok('components.jsx 存在', fs.existsSync(FILE), FILE);
if (!fs.existsSync(FILE)) {
  console.log('\n===== 0 通过 / 1 失败 =====');
  process.exit(1);
}

const src = fs.readFileSync(FILE, 'utf8');

/** 取出某个类名工厂函数的函数体（箭头函数以分号结尾） */
const factoryBody = (name) => {
  const i = src.indexOf(`const ${name} = (active) =>`);
  if (i < 0) return null;
  const j = src.indexOf(';', i);
  return j > i ? src.slice(i, j + 1) : src.slice(i, i + 800);
};

const homeBody = factoryBody('homeItemClass');
const subBody = factoryBody('subItemClass');

ok('homeItemClass 存在', Boolean(homeBody));
ok('subItemClass 存在', Boolean(subBody));

// 1) 两个工厂都用 rounded-full（而不是 rounded-xl / rounded-lg 的圆角矩形）
ok('首页项用 rounded-full（胶囊）', Boolean(homeBody && homeBody.includes('rounded-full')),
  homeBody && (homeBody.match(/rounded-[a-z0-9[\]]+/g) || []).join(','));
ok('子项用 rounded-full（胶囊）', Boolean(subBody && subBody.includes('rounded-full')),
  subBody && (subBody.match(/rounded-[a-z0-9[\]]+/g) || []).join(','));

// 2) 子项不得再残留圆角矩形的 rounded-xl
ok('子项不再使用 rounded-xl（旧圆角矩形）', Boolean(subBody && !subBody.includes('rounded-xl')));

// 3) 选中态 = 实心橙胶囊 + 白字白图标（2026-11-03 主人指定；原浅蓝底 bg-brand-100 已废弃）
const activeBranch = (body) => {
  const m = /\$\{active \?\s*([^:]*?)\s*:\s*/.exec(body || '');
  return m ? m[1] : '';
};
const homeActive = activeBranch(homeBody);
const subActive = activeBranch(subBody);
ok('首页选中态用 bg-brand-600（实心橙）', homeActive.includes('bg-brand-600'), homeActive.trim());
ok('子项选中态用 bg-brand-600（实心橙）', subActive.includes('bg-brand-600'), subActive.trim());
ok('首页选中态文字/图标为白色', homeActive.includes('text-white'));
ok('子项选中态文字/图标为白色', subActive.includes('text-white'));
ok('选中态不再用浅底 bg-brand-100', !homeActive.includes('bg-brand-100') && !subActive.includes('bg-brand-100'));
// 选中分支若带 hover:text-brand-700，悬停时深橙字压在深橙底上等于消失（伪类权重高于 text-white）
ok('选中分支内无深橙文字（防悬停不可读）',
  !homeActive.includes('hover:text-brand-700') && !subActive.includes('hover:text-brand-700'));

// 4) 左侧深蓝竖线彻底移除：整文件不允许出现 ::before 竖线条实现
ok('components.jsx 内不存在左侧竖线实现（before:absolute before:left-0）',
  !/before:absolute\s+before:left-0/.test(src));
ok('components.jsx 内不存在 3px 竖线条（before:w-[3px]）', !src.includes('before:w-[3px]'));
ok('components.jsx 内不存在竖线配色（before:bg-brand-600）', !src.includes('before:bg-brand-600'));

// 5) 竖线彻底移除后，不要再保留仅供竖线用的相对定位包装
ok('侧边栏类名里不再残留 relative（仅为竖线服务的定位）',
  Boolean(homeBody && subBody && !homeBody.includes('relative') && !subBody.includes('relative')));

console.log(`\n===== ${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) {
  console.error('\n失败项：\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
