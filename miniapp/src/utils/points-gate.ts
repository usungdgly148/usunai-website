import Taro from '@tarojs/taro';
import { getMe } from '../services/api';
import type { UserProfile } from '../types';

/**
 * 「算力不足」门禁（小程序侧）。
 *
 * 分工与 utils/phone-gate.ts、utils/vip-gate.ts 完全一致：**服务端才是闸门**
 * （`server/index.mjs` 的 `/api/coze/chat` 回 402、工作流后台任务失败时把原因写进
 * `task.error`），这里只负责「别让用户只看到一句干巴巴的文字，而是直接给出可点击的去处」。
 *
 * 为什么要做：新用户是**静默登录即注册**，号上一分算力都没有。以前点发送后只在
 * 对话气泡里回一句「调用失败：算力不足，请先充值」、输入框上方再挂一条红字 ——
 * 两处都是**死的文字**，既不能点，也没告诉用户「去哪儿充值」。
 *
 * ⚠️ 判定口径不要在这里重写：
 *   · 预判只读服务端算好的 `profile.points`，且**只在明确 `<= 0` 时拦**；
 *   · 拿不到档案 / 老服务端不给 `points` → 一律放行，交给服务端那道 402 兜底。
 *     宁可漏拦，也不要因为一次取档案失败把还能用的用户挡在门外。
 */

/** 充值落地页（非 tabBar 页，从任意内容页 navigateTo 均可）。 */
const RECHARGE_PAGE = '/pages/recharge/index';

/**
 * 「算力不足」的识别信号，三个都要认 —— 它们分别对应三种真实回来方式：
 *   · `statusCode === 402`：对话被服务端拒绝（`{ error: '算力不足，请先充值' }`，服务端**没给错误码**，
 *     所以状态码是目前最稳的机器可读信号）；
 *   · `code === 'POINTS_INSUFFICIENT'`：日后服务端补上错误码时的正式契约（提前认下，免得到时漏判）；
 *   · 文案含「算力不足」：SSE **流内**报错（「算力不足，本次结果未计入记录，请充值后再试」）
 *     与工作流**后台任务**失败（写进 `task.error` 的字符串）都只有文案，没有状态码。
 * 三个信号任一命中即判为算力不足 —— 换码、换文案、换通道都不会漏。
 */
const INSUFFICIENT_POINTS_CODE = 'POINTS_INSUFFICIENT';
const INSUFFICIENT_POINTS_TEXT = '算力不足';

/**
 * 同一时刻只允许一个「算力不足」弹窗在飞。
 *
 * 为什么需要：发送按钮在**预检期间并不置 `sending`**（`sending` 要等真正开始请求才置位），
 * 所以用户连点两下会让两条预检同时走到 `Taro.showModal`，叠出两个一模一样的弹窗、
 * 甚至叠两次 `navigateTo`。用一个模块级 promise 把并发调用收敛成同一个结果。
 */
let inFlightPrompt: Promise<boolean> | null = null;

/** 判断一个错误/任务原因是不是「算力不足」（见上面的三信号说明）。 */
export function isPointsInsufficient(reason: unknown): boolean {
  if (!reason) return false;
  if (typeof reason === 'string') return reason.includes(INSUFFICIENT_POINTS_TEXT);
  const error = reason as { code?: unknown; statusCode?: unknown; message?: unknown };
  if (String(error.code || '') === INSUFFICIENT_POINTS_CODE) return true;
  if (Number(error.statusCode) === 402) return true;
  return String(error.message || '').includes(INSUFFICIENT_POINTS_TEXT);
}

/**
 * 弹窗正文。
 *
 * ⚠️ 知道余额就把余额念出来（「当前算力余额 0 点」比「余额不足」更让用户确认自己不是被误拦），
 * 不知道就只说不足 —— **绝不编一个数字**。
 */
export function pointsInsufficientContent(points?: number): string {
  // ⚠️ 必须用 typeof 卡一道，不能只写 Number.isFinite(Number(points))：
  // `Number(null)` / `Number('')` / `Number([])` 全都是 **0**，会把「余额未知」静默念成「余额 0 点」，
  // 那正是这句文案最不该犯的错（用户会以为系统算错了）。
  const balance = typeof points === 'number' && Number.isFinite(points) ? points : null;
  if (balance !== null && balance <= 0) {
    return `当前算力余额 ${balance} 点，充值后可继续使用。`;
  }
  return '当前算力余额不足，充值后可继续使用。';
}

/**
 * 弹窗引导去充值。
 *
 * @param points 已知余额；`<= 0` 时正文会把它念出来，未知则不念
 * @returns true = 用户选择去充值（已跳转）；false = 用户放弃（或已有弹窗在飞）
 */
export async function promptRecharge(points?: number): Promise<boolean> {
  if (inFlightPrompt) return inFlightPrompt;
  const task = (async () => {
    const res = await Taro.showModal({
      title: '算力不足',
      content: pointsInsufficientContent(points),
      confirmText: '去充值',
      cancelText: '再想想',
      confirmColor: '#305CE0',
    });
    if (!res.confirm) return false;
    try {
      await Taro.navigateTo({ url: RECHARGE_PAGE });
    } catch {
      // 页面栈满（小程序上限 10 层）时 navigateTo 会失败 —— 退一步用 redirectTo，
      // 至少别让用户点完「去充值」什么都没发生。
      try { await Taro.redirectTo({ url: RECHARGE_PAGE }); } catch { /* 两条路都失败就不再骚扰用户 */ }
    }
    return true;
  })();
  inFlightPrompt = task;
  try { return await task; } finally { if (inFlightPrompt === task) inFlightPrompt = null; }
}

/**
 * 使用消耗算力的功能（智能体对话 / 工作流任务）前的预检：
 * 余额明确为 0（或负数）时弹窗引导充值。
 *
 * ⚠️ 与 ensurePhoneBound / ensureVipAccess 一样**失败即放行**：拿不到档案（未登录 / 网络抖动）时不在客户端拦，
 * 交给服务端 402 给出准确结果；`points` 缺失（老服务端）同样放行。
 *
 * ⚠️ 正文不点实体名称（主人 2026-09-17 定的文案），所以这里不再收 item ——
 * 别为了「以后可能要用」留一个没人读的入参。
 *
 * @param profile 已有档案时直接传入，省掉一次 getMe()（调用页三道门禁共用一份档案）
 * @returns true = 放行；false = 已拦截（弹窗已展示或已跳转充值页）
 */
export async function ensureEnoughPoints(profile?: UserProfile | null): Promise<boolean> {
  if (profile && Number(profile.points) > 0) return true;
  let current = profile || null;
  if (!current) {
    try {
      current = await getMe();
    } catch {
      return true;
    }
  }
  // ⚠️ getMe() 可能**正常返回 null**（无会话 / 未登录），不是抛错。这不是「没有算力」，
  // 而是「问不到」——同样放行，交给服务端那道 402。少了这一行就是 null.points 抛 TypeError，
  // 而调用方的 passGates 没有 try/catch，用户看到的是「点了发送、什么都没发生」。
  if (!current) return true;
  // 只在**明确**没有算力时拦。`points > 0` 可能是「不够本次消耗」，那只有服务端算得出，
  // 由 402 兜底；`points` 缺失（undefined / NaN）同样放行。
  const points = Number(current.points);
  if (!Number.isFinite(points) || points > 0) return true;
  await promptRecharge(points);
  return false;
}

/**
 * 服务端已经判定「算力不足」时的统一处理：弹窗 + 给气泡一句人话。
 *
 * 调用方拿到它返回的 true 后**不要再把服务端原文塞进界面**（那正是要替换掉的「纯文字提示」）。
 *
 * @param points 手上已知的余额；这条路径通常**不知道**（服务端只回了一句文案）→ 不传即不念数字
 * @returns true = 已按算力不足处理（弹窗已展示）
 */
export async function handlePointsInsufficient(reason: unknown, points?: number): Promise<boolean> {
  if (!isPointsInsufficient(reason)) return false;
  await promptRecharge(points);
  return true;
}

/** 算力不足时替代服务端原文的说明文案（气泡 / 任务卡片用）。 */
export function pointsInsufficientHint(kind: 'chat' | 'workflow'): string {
  return kind === 'chat'
    ? '算力不足，本次回复未生成。充值后点「重新生成」即可继续。'
    : '算力不足，本次运行未执行。充值后可回到本页重新提交。';
}
