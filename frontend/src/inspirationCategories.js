// 灵感广场分类 —— 前端**兜底副本**。
//
// ⚠️ 真值在服务端 KV（`inspirationPlazaSettings`，后台「灵感广场」页可增删改序），
//    运行时以接口下发的清单为准（见 `useInspirationCategories.js`）；这里的常量只在
//    「接口还没回来 / 请求失败」时兜底，保证页面不会出现一个 chip 都没有的空条。
// ⚠️ 本文件**不准 import 任何东西**：守卫脚本 `scripts/check-inspiration-plaza.mjs`
//    直接用 node 跑它来比对前后端清单，仓库根目录没有 node_modules，引入 react 会直接跑不起来。

// 与 server/inspiration.mjs 的 INSPIRATION_DEFAULT_CATEGORIES 逐项一致（守卫会比对）。
export const DEFAULT_CATEGORIES = [
  { id: 'ecommerce', label: '电商营销' },
  { id: 'festival', label: '热点节日' },
  { id: 'season', label: '时令节气' },
  { id: 'poster', label: '海报设计' },
  { id: 'ui', label: 'UI设计' },
];

export const ALL_CATEGORY = { id: 'all', label: '全部' };

/** 广场 chips 兜底：含「全部」合成项。 */
export const PLAZA_CATEGORIES = [ALL_CATEGORY, ...DEFAULT_CATEGORIES];

/** 发布弹窗兜底：不含「全部」（「全部」只用于筛选，不可发布）。 */
export const PUBLISH_CATEGORIES = DEFAULT_CATEGORIES;

/**
 * 取分类显示名。找不到（分类被后台删了 / 老数据挂着已删分类）时回落成 id 本身，
 * 不要显示成空白 —— 至少让人看得出是哪个分类。
 */
export function categoryLabel(id, list) {
  const key = String(id || '');
  const found = (Array.isArray(list) ? list : PLAZA_CATEGORIES).find((item) => item.id === key);
  return found ? found.label : key;
}
