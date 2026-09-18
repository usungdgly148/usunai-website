/**
 * 卡片渐变 —— 唯一实现。
 *
 * 消费方（必须全部走这里，不要再各写一份）：
 *   1. 网页卡片      frontend/src/components.jsx 的 AgentCard（智能体 + 工作流共用）
 *   2. 后台渐变预览  frontend/src/pages/AdminAgentEdit.jsx
 *   3. 后台渐变预览  frontend/src/pages/AdminWorkflowEdit.jsx
 *
 * 为什么不各写一份：2026-09-18 线上报障「有些卡片渐变颜色和角度不生效」，
 * 根因就是三处各写各的 —— 卡片被分类主题整段覆盖、预览却只看自定义，管理员看到的是假象。
 * 现在把「角度取值」与「渐变字符串」收敛成单点，预览与线上卡片在构造上一致。
 *
 * ⚠️ 小程序端是另一份实现（miniapp/src/components/content-card.tsx，小程序包不能 import 前端源码），
 *    改规则时两边都要改，且**语义必须一致**。
 */

/** 后台没填角度时的默认值（与后台 UI 提示「默认 30°」一致）。 */
export const GRADIENT_ANGLE_DEFAULT = 30;

/**
 * 这张卡是否配过自定义渐变。
 * 只要起始色或结束色任一个有值，就认为管理员为这张卡专门配过。
 */
export function hasCustomGradient(item) {
  return Boolean(item && (item.gradientFrom || item.gradientTo));
}

/**
 * 解析渐变角度。
 *
 * 🔴 **绝不要写成 `Number(x) || 30`** —— 0 是合法角度（后台预设里就有 0°），
 *    但 0 是 falsy，`|| 30` 会把管理员选的 0° 悄悄换成 30°，表现为「角度不生效」。
 *    只有 null / undefined / 空串 / 非数值 才回落到默认值。
 *
 * ⚠️ 必须限定 `number | string` 两种类型，不能直接 `Number(x)` 一把梭：
 *    `Number([])` 是 0、`Number([5])` 是 5、`Number(true)` 是 1 —— 脏数据会变成合法角度。
 *    （这是回归脚本 check-card-gradient 当场抓出来的边界。）
 */
export function resolveGradientAngle(value) {
  if (value === null || value === undefined || value === '') return GRADIENT_ANGLE_DEFAULT;
  if (typeof value !== 'number' && typeof value !== 'string') return GRADIENT_ANGLE_DEFAULT;
  const n = Number(value);
  return Number.isFinite(n) ? n : GRADIENT_ANGLE_DEFAULT;
}

/**
 * 生成最终用于 CSS `background` 的渐变字符串。
 * @param item       含 gradientFrom / gradientTo / gradientAngle 的记录（后台预览直接传 form）
 * @param fallbackFrom 起始色缺省值
 * @param fallbackTo   结束色缺省值
 */
export function gradientCss(item, fallbackFrom, fallbackTo) {
  const from = (item && item.gradientFrom) || fallbackFrom;
  const to = (item && item.gradientTo) || fallbackTo;
  const angle = resolveGradientAngle(item && item.gradientAngle);
  return 'linear-gradient(' + angle + 'deg, ' + from + ', ' + to + ')';
}
