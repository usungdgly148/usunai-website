// 套餐权益判定：免费试用识别、试用限购、VIP 专享门禁、套餐有效期补丁。
//
// ⚠️ 这里是「免费试用」与「VIP 专享」两套规则的**唯一实现**。
// 服务端 3 条发货/调整路径（虚拟支付发货、微信支付 notify、后台手动调整）与全部运行入口
// （小程序 /agents/:id/chat、/workflows/:id/tasks，网页 /api/coze/chat、/api/coze/workflow-run）
// 都必须调用本模块，禁止在各自文件里另写一套判定 —— 否则两端口径必然漂移。
//
// 判定链路的既有基础（勿重复造）：
//   · resolveMaxPlanValidity —— 套餐有效期「不叠加时长、取更晚到期日、永久优先」的唯一实现；
//   · user.membership.plan —— 记的是**胜出者**的套餐名，所以「当前生效套餐」直接读它；
//   · getPlanValidity(user) —— 由 planValidFrom + planValidDays 推出 { expired, validTo }。

import { resolveMaxPlanValidity } from './plan-validity.mjs';

/**
 * 试用套餐的名称兜底规则。
 * 线上「免费试用」套餐没有专门的标记字段，且历史 membership.plan 里存的就是这个中文名，
 * 所以开关之外必须保留按名兜底，否则存量数据全部判不出来。
 */
const TRIAL_PLAN_PATTERN = /试用/;

/** 被「试用套餐每用户限购一次」拦下时的错误码（小程序按码弹窗，不用猜文案）。 */
export const TRIAL_ALREADY_PURCHASED_CODE = 'TRIAL_ALREADY_PURCHASED';
export const TRIAL_ALREADY_PURCHASED_MESSAGE = '「免费试用」套餐每位用户仅限购买一次，请选择其它套餐。';

/** 命中 VIP 专享门禁时的错误码。 */
export const VIP_REQUIRED_CODE = 'VIP_REQUIRED';

/** VIP 专享门禁的提示文案（带内容名，小程序/网页共用，避免两端各写一版）。 */
export function vipRequiredMessage(name) {
  const label = String(name || '').trim();
  return `${label ? `「${label}」` : '该内容'}为 VIP 专享，当前「免费试用」套餐无法使用，请升级为更高权益套餐后再试。`;
}

/** 是否试用套餐：后台「试用套餐」开关优先，未勾选时按名称含「试用」兜底。 */
export function isTrialPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  if (pkg.trial === true) return true;
  return TRIAL_PLAN_PATTERN.test(String(pkg.name || ''));
}

/** 套餐名是否试用套餐（判定存量 membership.plan 用）。 */
export function isTrialPlanName(name) {
  return TRIAL_PLAN_PATTERN.test(String(name || ''));
}

/**
 * 该用户是否已经用过试用资格（「免费试用」每用户限购一次的硬判定）。
 *
 * 认两个信号，缺一不可：
 *   ① `trialPurchased` —— 本功能上线后由 buildPlanPatch 置位，最权威；
 *   ② 当前生效套餐就是试用套餐 —— 兼容上线前已买过试用、但那时还没有 trialPurchased 字段的老数据。
 *      （含后台手动发放试用套餐的情况：资格按人一次，发过就不能再买。）
 */
export function hasUsedTrial(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.trialPurchased === true) return true;
  const membership = user.membership && typeof user.membership === 'object' ? user.membership : null;
  if (!membership) return false;
  if (membership.trial === true) return true;
  return isTrialPlanName(membership.plan);
}

/**
 * 是否具备使用「VIP 专享」内容的资格。
 *
 * 口径（2026-09-12 与主人确认）：只有**生效中的、非试用的更高档套餐**才放行；
 * 试用中 / 已过期 / 从未买过套餐 一律无资格 —— 这三类都会走到「升级更高权益套餐」的引导。
 *
 * @param mergedUser 合并后的用户档案（reg + user），读 membership.plan
 * @param validity   getPlanValidity(mergedUser) 的结果，只有 expired 被用到
 */
export function hasVipAccess(mergedUser, validity) {
  const membership = mergedUser && typeof mergedUser.membership === 'object' && mergedUser.membership
    ? mergedUser.membership
    : null;
  const plan = membership && typeof membership.plan === 'string' ? membership.plan.trim() : '';
  // 没有任何生效套餐记录 → 不是付费用户
  if (!plan) return false;
  // 当前生效的就是试用套餐 → 无资格（已过期的试用同样无资格，需重新升级）
  if (membership.trial === true || isTrialPlanName(plan)) return false;
  // 更高档套餐但已过期 → 无资格
  return !(validity && validity.expired === true);
}

/**
 * 构造套餐有效期补丁（发货 / 后台调整三处共用）。
 *
 * 相对原来三处各自复制的写法，这里多做了一件事：**试用标记**。
 *   · `trialPurchased`（用户级布尔）= 该用户已经用过试用资格，是「限购一次」的权威凭证；
 *     只要本次套餐是试用套餐就置位，与有效期胜负无关（买了试用才算用过，被更高档套餐压过也算用过）。
 *   · `membership.trial` = 胜出的套餐是不是试用套餐，供 hasVipAccess 免去名字匹配。
 *
 * @returns {{ patch: object, trial: boolean, winner: string }}
 *   patch 可直接塞进 userPatch（字段白名单见 kv-local.js 的 kvAdminAdjustPoints）
 */
export function buildPlanPatch(existingUser, { packageName, validDays, validFrom, packageTrial = false, fallbackStart }) {
  const name = String(packageName || '');
  const trial = packageTrial === true || isTrialPlanName(name);
  const patch = {};
  // 试用资格按人一次：抢在有效期判定之前置位，避免被「更高档套餐胜出」的分支漏掉。
  if (trial) patch.trialPurchased = true;

  // ⚠️ 用「有没有 validDays」判断是否涉及有效期，**绝不能**写成 `validDays > 0`：
  //   0 是「长期有效」档（至尊卡），漏掉它会让永久档买家拿不到 membership，
  //   于是依旧按旧套餐（如免费试用）判定，被挡在 VIP 专享门外 —— 花了钱反而用不了。
  //   字段整体缺失才是「该套餐不涉及有效期」（老套餐），此时保持原值。
  if (validDays === null || validDays === undefined) return { patch, trial, winner: 'preserve' };
  const days = Number(validDays);
  if (!Number.isFinite(days) || days < 0) return { patch, trial, winner: 'preserve' };

  const resolved = resolveMaxPlanValidity(existingUser, { validFrom, validDays: days, fallbackStart });
  patch.planValidFrom = resolved.planValidFrom;
  patch.planValidDays = resolved.planValidDays;
  if (resolved.winner === 'incoming' && resolved.planValidFrom) {
    const resolvedDays = Number(resolved.planValidDays);
    const startMs = new Date(resolved.planValidFrom).getTime();
    const expireAt = resolvedDays === 0
      ? '长期有效'
      : Number.isFinite(startMs) && resolvedDays > 0
        ? new Date(startMs + resolvedDays * 86400000).toISOString().slice(0, 10)
        : '';
    if (expireAt) patch.membership = { plan: name, expireAt, trial };
  }
  return { patch, trial, winner: resolved.winner };
}
