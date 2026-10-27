// 灵感广场的分类。**必须与 server/inspiration.mjs 的 INSPIRATION_CATEGORIES 保持一致**。
// 为什么要副本：发布弹窗可能在广场列表还没请求回来时就被打开（用户生成完立刻发布），
// 不能依赖接口下发。服务端对未知分类会回落到 poster，所以即便这里多一项也不会写坏数据。
// ⚠️ 改这里时同步改服务端，否则会出现「前端能选、筛选却筛不到」。
export const PLAZA_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'ecommerce', label: '电商营销' },
  { id: 'festival', label: '热点节日' },
  { id: 'season', label: '时令节气' },
  { id: 'poster', label: '海报设计' },
  { id: 'ui', label: 'UI设计' },
];

/** 发布时可选分类（排除「全部」）。 */
export const PUBLISH_CATEGORIES = PLAZA_CATEGORIES.filter((item) => item.id !== 'all');

export const categoryLabel = (id) => (PLAZA_CATEGORIES.find((item) => item.id === id) || {}).label || '海报设计';
