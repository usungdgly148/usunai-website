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

/**
 * 卡片白色蒙版的默认浓度（%，0 = 不蒙版，100 = 全白）。后台没配时用它。
 *
 * 🔴 为什么是 20 而不是 30（2026-11-18 实测定的）：现网卡片渐变本身就很浅
 *    （#DBEAFE→#FFFFFF 这类），30% 白一压几乎全成白底，色调只剩一点痕迹；
 *    20% 还能清楚分辨粉/米黄/浅蓝/浅绿，同时明显柔化。主人上一轮刚因「渐变被刷白」否决过一版，
 *    默认值宁可保守 —— 要更淡让管理员自己在后台往上拉。
 */
export const CARD_MASK_OPACITY_DEFAULT = 20;

/**
 * 解析后台配置的「卡片蒙版透明度」。
 *
 * ⚠️ 与角度同一个坑：**0 是合法值**（= 不要蒙版），不能写成 `Number(x) || 30`，
 *    否则管理员把滑块拉到 0 会被悄悄换回 30%，表现为「蒙版关不掉」。
 * ⚠️ 只接受 number / string，其余（数组、对象、布尔）一律回落默认值 —— 防脏数据。
 * 返回值恒为 0–100 的整数（超出范围按边界夹紧，不报错）。
 */
export function resolveMaskOpacity(value) {
  if (value === null || value === undefined || value === '') return CARD_MASK_OPACITY_DEFAULT;
  if (typeof value !== 'number' && typeof value !== 'string') return CARD_MASK_OPACITY_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return CARD_MASK_OPACITY_DEFAULT;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 白色蒙版层（叠在渐变之上）。浓度 0 时返回空串 —— 调用方据此决定要不要拼。
 * 两层都用同一个颜色，等价于「平铺一层半透明白」。
 */
export function maskOverlayCss(opacity) {
  const alpha = resolveMaskOpacity(opacity) / 100;
  if (alpha <= 0) return '';
  return 'linear-gradient(rgba(255,255,255,' + alpha + '), rgba(255,255,255,' + alpha + '))';
}

/**
 * 卡片最终 `background`：白色蒙版 + 渐变。
 *
 * 为什么要蒙版（2026-11-18 主人要求）：后台能配很饱和的渐变，直接铺满整张卡颜色偏重；
 * 压一层白既保留色相又降饱和度。**只是叠加，不替换** —— 渐变的方向/角度/色值原样保留。
 *
 * ⚠️ 蒙版必须写在渐变**前面**（CSS 多背景里前者在上层）。
 * @param bg      已算好的渐变（gradientCss 或分类主题 header）
 * @param opacity 0–100
 */
export function cardSurfaceCss(bg, opacity) {
  const mask = maskOverlayCss(opacity);
  return mask ? mask + ', ' + bg : bg;
}
