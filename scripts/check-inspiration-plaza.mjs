// 回归：灵感广场（AI全能设计 作品墙）+ 后台「灵感广场」管理
//
// 覆盖五层：
//   1. 纯函数真跑（地址白名单 / 分类清单校验 —— 都是安全边界，必须逐条验）
//   2. 前后端**默认分类清单**一致性（两份副本，最容易悄悄漂移）
//   3. 服务端接线（用户端 4 条 + 后台 4 条，后台全部要管理员）
//   4. 前端结构（瀑布流 / 滚动增量加载 / 做同款 / 发布 / 本轮页面调整）
//   5. 后台页面存在且真的接了那 4 个接口
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INSPIRATION_CATEGORIES,
  INSPIRATION_DEFAULT_CATEGORIES,
  INSPIRATION_MAX_ITEMS,
  INSPIRATION_PAGE_MAX,
  INSPIRATION_CATEGORY_MAX,
  INSPIRATION_SETTINGS_KEY,
  normalizeCategoryList,
  normalizeOwnImageUrl,
} from '../server/inspiration.mjs';
import { PLAZA_CATEGORIES, DEFAULT_CATEGORIES } from '../frontend/src/inspirationCategories.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const serverSrc = read('server/index.mjs');
const inspirationSrc = read('server/inspiration.mjs');
const plazaSrc = read('frontend/src/InspirationPlaza.jsx');
const pageSrc = read('frontend/src/pages/ImageGen.jsx');
const adminPageSrc = read('frontend/src/pages/AdminInspiration.jsx');
const adminUiSrc = read('frontend/src/adminUI.jsx');
const appSrc = read('frontend/src/App.jsx');
const catsSrc = read('frontend/src/inspirationCategories.js');
const hookSrc = read('frontend/src/useInspirationCategories.js');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
}

// ===== 1. 地址白名单（安全边界）=====
check('接受本站图床相对地址', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2Fgen-1.png') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('把未编码斜杠规范化', normalizeOwnImageUrl('/api/blob/serve?key=uploads/gen-1.png') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('剥离多余 query', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2Fgen-1.png&x=1') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('拒绝外链', normalizeOwnImageUrl('https://evil.example.com/a.png') === '');
check('拒绝本站非图床路径', normalizeOwnImageUrl('https://www.usunai.top/uploads/gen-1.png') === '');
check('拒绝目录穿越', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2F..%2F..%2Fetc%2Fpasswd') === '');
check('拒绝非 uploads 前缀', normalizeOwnImageUrl('/api/blob/serve?key=other%2Fgen-1.png') === '');
check('拒绝空值', normalizeOwnImageUrl('') === '' && normalizeOwnImageUrl(null) === '');
check('拒绝伪协议', normalizeOwnImageUrl('javascript:alert(1)') === '');

// ===== 2. 默认分类清单一致性（前端兜底副本 vs 服务端默认值）=====
const serverIds = INSPIRATION_CATEGORIES.map((item) => item.id).join(',');
const clientIds = PLAZA_CATEGORIES.map((item) => item.id).join(',');
check('前后端分类 id 完全一致', serverIds === clientIds, `服务端 ${serverIds} / 前端 ${clientIds}`);
check('分类数 = 6（全部 + 5 个可发布分类）', INSPIRATION_CATEGORIES.length === 6, String(INSPIRATION_CATEGORIES.length));
check('可发布默认分类 = 5（不含「全部」）', INSPIRATION_DEFAULT_CATEGORIES.length === 5);
check('可发布默认分类 id 一致', INSPIRATION_DEFAULT_CATEGORIES.map((i) => i.id).join(',') === DEFAULT_CATEGORIES.map((i) => i.id).join(','));
check('分类显示名逐项一致', INSPIRATION_DEFAULT_CATEGORIES.every((item, i) => item.label === DEFAULT_CATEGORIES[i].label));
check('前端常量文件零依赖（守卫用 node 直跑）', !/^\s*import\s/m.test(catsSrc));

// ===== 3. 分类校验（后台保存的唯一入口，安全边界）=====
const okCats = normalizeCategoryList([{ id: 'pet', label: '宠物用品' }, { id: 'home', label: '家居', enabled: false }]);
check('合法清单通过', okCats.ok === true && okCats.categories.length === 2);
check('未写 enabled 视为启用', okCats.ok && okCats.categories[0].enabled === true);
check('显式 false 保留停用', okCats.ok && okCats.categories[1].enabled === false);
check('标识自动转小写', normalizeCategoryList([{ id: 'PET', label: '宠物' }]).categories?.[0]?.id === 'pet');
check('拒绝保留标识 all', normalizeCategoryList([{ id: 'all', label: '全部' }]).ok === false);
check('拒绝非法标识（数字开头）', normalizeCategoryList([{ id: '1pet', label: '宠物' }]).ok === false);
check('拒绝非法标识（中文/空格）', normalizeCategoryList([{ id: '宠 物', label: '宠物' }]).ok === false);
check('拒绝重复标识', normalizeCategoryList([{ id: 'a1', label: 'A' }, { id: 'a1', label: 'B' }]).ok === false);
check('拒绝空名称', normalizeCategoryList([{ id: 'a1', label: '  ' }]).ok === false);
check('拒绝超长名称（不静默截断）', normalizeCategoryList([{ id: 'a1', label: '一二三四五六七八九十一二三' }]).ok === false);
check('拒绝全停用（用户端会没有分类）', normalizeCategoryList([{ id: 'a1', label: 'A', enabled: false }]).ok === false);
check('拒绝空清单', normalizeCategoryList([]).ok === false);
check('拒绝非数组', normalizeCategoryList({}).ok === false && normalizeCategoryList(null).ok === false);
check('分类数上限与后台提示一致', INSPIRATION_CATEGORY_MAX === 12, String(INSPIRATION_CATEGORY_MAX));
check('超上限被拒绝', normalizeCategoryList(
  Array.from({ length: INSPIRATION_CATEGORY_MAX + 1 }, (_, i) => ({ id: `c${i}x`, label: `分类${i}` })),
).ok === false);

// ===== 4. 分类真值在 KV，不再写死在代码里 =====
check('分类配置有独立 KV 键', INSPIRATION_SETTINGS_KEY === 'inspirationPlazaSettings');
check('读分类走 readCategories(KV)', inspirationSrc.includes('async function readCategories(KV)'));
check('发布分类白名单从 KV 现读', /readCategories\(KV\)\)\.filter\(/.test(inspirationSrc));
check('列表下发的分类含「全部」合成项', inspirationSrc.includes('return [ALL_CATEGORY, ...usable'));
check('分类 key 是「全部」的合成项常量', inspirationSrc.includes("export const ALL_CATEGORY = { id: 'all', label: '全部' }"));
check('删分类前检查是否还有作品', inspirationSrc.includes('INSPIRATION_CATEGORY_IN_USE'));
check('用户页分类不再读死常量', plazaSrc.includes('useInspirationCategories()') && !plazaSrc.includes('PLAZA_CATEGORIES'));
check('分类缓存有 inflight 去重（两个组件只发一次请求）', hookSrc.includes('if (inflight) return inflight'));
check('接口失败时回落到兜底清单', hookSrc.includes("import { PLAZA_CATEGORIES, categoryLabel }"));

// ===== 5. 容量与分页 =====
check('作品总数有硬上限（防 KV 无限膨胀）', INSPIRATION_MAX_ITEMS === 300, String(INSPIRATION_MAX_ITEMS));
check('单页上限有界', INSPIRATION_PAGE_MAX === 40, String(INSPIRATION_PAGE_MAX));
check('超出上限丢最旧（slice 保留前 N 条）', inspirationSrc.includes('.slice(0, INSPIRATION_MAX_ITEMS)'));
check('列表用游标而不是页码', inspirationSrc.includes('nextCursor') && inspirationSrc.includes("u.searchParams.get('cursor')"));
check('发布前查重（同一张图不重复入广场）', inspirationSrc.includes('INSPIRATION_DUPLICATE'));

// ===== 6. 服务端接线 =====
check('index.mjs 已 import 灵感广场处理器', /import \{ handleInspiration \} from '\.\/inspiration\.mjs'/.test(serverSrc));
check('index.mjs 已接入路由', serverSrc.includes('handleInspiration(req, res, u, { KV, readBody, requireUser, getSession, isAdminSession })'));
check('发布需登录（requireUser）', inspirationSrc.includes("requireUser(req, res, '未登录，无法发布到灵感广场')"));
check('删除校验归属（本人或管理员）', inspirationSrc.includes('isOwner') && inspirationSrc.includes('isAdminSession(session)'));
check('后台接口前缀已被同一处理器接管', inspirationSrc.includes("p.startsWith('/api/admin/inspiration/')"));
check('后台 5 个接口都过 needAdmin()',
  (inspirationSrc.match(/if \(!needAdmin\(\)\) return true;/g) || []).length === 5,
  String((inspirationSrc.match(/if \(!needAdmin\(\)\) return true;/g) || []).length));
check('后台接口存在：settings / items / update / delete',
  ['/api/admin/inspiration/settings', '/api/admin/inspiration/items', '/api/admin/inspiration/update', '/api/admin/inspiration/delete']
    .every((p) => inspirationSrc.includes(p)));
check('公开分类接口存在', inspirationSrc.includes("p === '/api/inspiration/categories'"));
check('后台列表能筛出「已删除分类」的孤儿作品', inspirationSrc.includes("wantedCategory === 'unknown'"));

// ===== 7. 前端结构：瀑布流 + 增量加载 =====
check('瀑布流用 CSS 多列实现', plazaSrc.includes('columns-2') && plazaSrc.includes('break-inside-avoid'));
check('图片懒加载', plazaSrc.includes('loading="lazy"'));
// ⚠️ 这里断言的是「滚动位置判断」而不是 IntersectionObserver ——
// 后者在"触发时正好有请求在飞"会永久丢事件（实测只加载到第 3 页就停），已弃用。
check('触底加载由滚动事件驱动', plazaSrc.includes("addEventListener('scroll'"));
check('提前 600px 预取', plazaSrc.includes('window.innerHeight + 600'));
check('加载完复查（视口没填满会续取）', plazaSrc.includes('[items.length, hasMore]'));
check('滚动加载不重复请求（防重入）', plazaSrc.includes('inflightRef'));
check('按 id 去重（游标翻页会因新增作品产生重叠）', plazaSrc.includes('seen.has(item.id)'));
check('切换分类/关键词会重置游标', plazaSrc.includes('cursorRef.current = 0'));
check('小屏不再依赖 hover（触屏可用）', plazaSrc.includes('opacity-100') && plazaSrc.includes('sm:group-hover:opacity-100'));
check('选中分类被后台删掉会回到「全部」', plazaSrc.includes("setCategory('all')"));

// ===== 8. 做同款 & 发布 =====
check('广场有「做同款」入口', plazaSrc.includes('做同款'));
check('做同款把提示词回调给页面', plazaSrc.includes('onUsePrompt?.(text)'));
check('页面接收回调并回填输入框', pageSrc.includes('<InspirationPlaza onUsePrompt={applyPrompt}') && pageSrc.includes("setPrompt(String(text || '')"));
check('页面挂载灵感广场组件', pageSrc.includes("from '../InspirationPlaza.jsx'"));
check('生成结果有「加入灵感广场」按钮', pageSrc.includes('加入灵感广场'));
check('发布调用 /api/inspiration/publish', pageSrc.includes("apiFetch('/api/inspiration/publish'"));
check('发布后让瀑布流刷新', pageSrc.includes('setPlazaToken'));
check('点赞走 /api/inspiration/like', plazaSrc.includes("apiFetch('/api/inspiration/like'"));
check('点赞失败会回滚', plazaSrc.includes('回滚'));
check('发布可选分类来自服务端（不再用死常量）',
  pageSrc.includes('{publishable.map((item) => (') && !pageSrc.includes('PUBLISH_CATEGORIES'));
check('发布按钮文案用动态分类名', pageSrc.includes('{labelOf(publishCategory)}'));

// ===== 9. 参数配置未被改版破坏（原有能力必须保留）=====
check('页面仍从服务端取模型/档位配置', pageSrc.includes("apiFetch('/api/image-gen/config')"));
check('页面仍提交 model/resolution/aspectRatio/images', pageSrc.includes('aspectRatio: aspect') && pageSrc.includes('model,') && pageSrc.includes('resolution,') && pageSrc.includes('images: toApiImages(refs)'));
check('页面仍处理 402 充值引导', pageSrc.includes('POINTS_INSUFFICIENT') && pageSrc.includes('openRechargeModal?.()'));

// ===== 10. 本轮页面调整（2026-10-28 第二轮）=====
check('输入卡已加宽（max-w-3xl → max-w-5xl）',
  /ig-card mx-auto max-w-5xl rounded-\[26px\]/.test(pageSrc) && !pageSrc.includes('max-w-3xl'));
check('已移除左下角「图片生成」胶囊', !pageSrc.includes('label="图片生成"'));
check('已移除余额点数显示', !pageSrc.includes('{points} 点') && !pageSrc.includes('Coins size={12}'));
check('输入框高度自适应（下限 4 行 / 封顶 8 行）',
  pageSrc.includes('const MIN_PROMPT_ROWS = 4')
  && pageSrc.includes('const MAX_PROMPT_ROWS = 8')
  && pageSrc.includes('lineHeight * MIN_PROMPT_ROWS + paddingY')
  && pageSrc.includes("el.style.height = 'auto'")
  && pageSrc.includes("el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'"));
check('已移除标题下的副标题', !pageSrc.includes('描述需求、上传参考图'));
check('自适应高度从 computedStyle 取行高（不写死 28px）',
  pageSrc.includes('parseFloat(style.lineHeight)') && pageSrc.includes('parseFloat(style.paddingTop)'));
check('窗口尺寸变化会重算高度', pageSrc.includes("window.addEventListener('resize', sync)"));
check('参数胶囊与生成按钮同一行（右栏 shrink-0 不再被折行）',
  pageSrc.includes('flex min-w-0 flex-1 flex-wrap items-center gap-2')
  && pageSrc.includes('flex shrink-0 items-center gap-2')
  && !pageSrc.includes('ml-auto flex items-center gap-3'));

// ===== 11. 后台管理页 =====
check('后台侧边栏有「灵感广场」', adminUiSrc.includes("{ label: '灵感广场'") && adminUiSrc.includes("href: '/admin/inspiration'"));
check('后台路由已注册', appSrc.includes("import('./pages/AdminInspiration.jsx')") && appSrc.includes('/admin/inspiration" element={<AdminInspiration />}'));
check('后台页面接了分类设置接口', adminPageSrc.includes("adminFetch('/api/admin/inspiration/settings'"));
check('后台能保存分类', adminPageSrc.includes("method: 'POST'") && adminPageSrc.includes('categories: draft.map'));
check('后台页面接了作品列表接口', adminPageSrc.includes('/api/admin/inspiration/items?'));
check('后台能改作品分类/提示词', adminPageSrc.includes("adminFetch('/api/admin/inspiration/update'"));
check('后台能删除作品', adminPageSrc.includes("adminFetch('/api/admin/inspiration/delete'"));
check('分类顺序用上下箭头调整', adminPageSrc.includes('moveCat(index, -1)') && adminPageSrc.includes('moveCat(index, 1)'));
check('分类标识规则与服务端一致（前端先挡一次）', adminPageSrc.includes('/^[a-z][a-z0-9_-]{1,23}$/'));
check('保存分类后让前台缓存失效', adminPageSrc.includes('invalidateInspirationCategories()'));
check('删除作品前二次确认', adminPageSrc.includes('window.confirm'));
check('后台作者信息只显示尾号（不铺全量 userId）', adminPageSrc.includes('item.userId.slice(0, 6)'));

if (failures.length) {
  console.log(`\n[FAIL] ${failures.length}/${pass + failures.length} 项不通过：`);
  for (const item of failures) console.log('  ·', item);
  process.exit(1);
}
console.log(`\n[OK] inspiration-plaza 契约 ${pass}/${pass} 项全部通过`);
