// 侧边栏导航外观守卫（2026-10-28 立规 / 2026-11-03 改选中态配色 / 2026-11-18 选中态降级为浅橙 tonal）
// 规则：分类选中态 = 大圆弧胶囊（rounded-full）+ 浅橙 tonal（bg-brand-50 底 + brand-700 字，**无描边**），
//      **不画左侧竖线**、**不用实心橙 bg-brand-600 + 白字**（视觉过重，已按主人要求降级）。
//      这条规则只在 CSS 类里体现，函数行为完全不变，因此只能靠源码断言守。
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

// 3) 选中态 = 浅橙 tonal 胶囊（2026-11-18 主人要求：参考「算力充值」按钮的强度，从实心橙降级）
//    旧规则（2026-11-03 实心橙 bg-brand-600 + 白字）已废弃，这里反向断言它不许回来。
const activeBranch = (body) => {
  const m = /\$\{active \?\s*([^:]*?)\s*:\s*/.exec(body || '');
  return m ? m[1] : '';
};
const homeActive = activeBranch(homeBody);
const subActive = activeBranch(subBody);
ok('首页选中态用浅橙底 bg-brand-50', homeActive.includes('bg-brand-50'), homeActive.trim());
ok('子项选中态用浅橙底 bg-brand-50', subActive.includes('bg-brand-50'), subActive.trim());
ok('首页选中态文字/图标为 brand-700 深橙', homeActive.includes('text-brand-700'));
ok('子项选中态文字/图标为 brand-700 深橙', subActive.includes('text-brand-700'));
// 选中态**不画描边**（2026-11-18 主人二次指定：胶囊只要底色 + 字色 + 字重，不要框）
ok('首页选中态无描边环（ring-*）', !/\bring-/.test(homeActive), homeActive.trim());
ok('子项选中态无描边环（ring-*）', !/\bring-/.test(subActive));
ok('选中态不用 border（既避免文字位移，也避免胶囊多一圈框）',
  !homeActive.includes('border-') && !subActive.includes('border-'));
// 实心橙 + 白字是已否决的旧方案，不许回归
ok('选中态不再用实心橙 bg-brand-600', !homeActive.includes('bg-brand-600') && !subActive.includes('bg-brand-600'));
ok('选中态不再用白字 text-white（实心橙已废弃）',
  !homeActive.includes('text-white') && !subActive.includes('text-white'));
// 选中分支若带 hover:text-brand-700，悬停时深橙字压在深橙底上等于消失（伪类权重高于普通 text-*）
ok('选中分支内无 hover 文字色（防悬停对比度塌陷）',
  !homeActive.includes('hover:text-') && !subActive.includes('hover:text-'));

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
