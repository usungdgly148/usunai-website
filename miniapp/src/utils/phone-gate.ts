import Taro from '@tarojs/taro';
import { getMe } from '../services/api';
import type { UserProfile } from '../types';

/**
 * 「绑定手机号」门禁（小程序侧）。
 *
 * 分工与 utils/vip-gate.ts 完全一致：**服务端才是闸门**
 * （server/miniapp-api.mjs 的充值下单、server/miniapp-runtime.mjs 的对话与工作流
 * 都会回 403 PHONE_BIND_REQUIRED），这里只负责「让用户在点下去的那一刻就看到弹窗 +
 * 一键去绑定」，避免白白发一次请求、也避免用户只看到一句失败提示而不知道去哪儿补。
 *
 * ⚠️ 判定口径不要在这里重写：只读服务端算好的 `profile.phoneBound`
 * （口径唯一实现在 server/plan-access.mjs 的 hasPhoneBound，只看 reg_.phone，
 * 不看微信身份的 bindingState —— 后者是「有没有绑到已有网站账号」，另一回事）。
 *
 * 为什么要有这道门禁：小程序是**静默登录即注册**，新用户拿到一个零资产占位账号，
 * 连手机号都没有。充值和使用付费功能之前先把账号补完整，付款与售后才有可触达的身份。
 */

/** 补手机号落地页（非 tabBar 页，从任意内容页 navigateTo 均可）。 */
const BIND_PHONE_PAGE = '/pages/bind/index';

/**
 * 弹窗引导去绑定手机号。
 * @returns true = 用户选择去绑定（已跳转）；false = 用户放弃
 */
export async function promptBindPhone(): Promise<boolean> {
  const res = await Taro.showModal({
    title: '请先绑定手机号',
    content: '充值、以及使用 AI 智能体与工作流之前，需要先绑定手机号。',
    confirmText: '去绑定',
    cancelText: '暂不绑定',
    confirmColor: '#305CE0',
  });
  if (!res.confirm) return false;
  void Taro.navigateTo({ url: BIND_PHONE_PAGE });
  return true;
}

/**
 * 使用付费功能（充值 / 对话 / 工作流）前的门禁：未绑手机号时弹窗引导绑定。
 *
 * @param profile 已有档案时直接传入，省掉一次 getMe()
 * @returns true = 放行；false = 已拦截（弹窗已展示或已跳转绑定页）
 */
export async function ensurePhoneBound(profile?: UserProfile | null): Promise<boolean> {
  let current = profile || null;
  if (!current) {
    try {
      current = await getMe();
    } catch {
      // 拿不到档案（未登录 / 网络异常）时不在这里拦：交给服务端闸门给出准确结果，
      // 否则会在登录态异常时把用户挡在一个说不出原因的弹窗上。
      return true;
    }
  }
  // 只有明确拿到 false 才拦。老服务端不下发 phoneBound（undefined）→ 放行，
  // 由服务端那道 403 兜底，绝不会因为版本差把已绑号的用户误拦在门外。
  if (current.phoneBound !== false) return true;
  await promptBindPhone();
  return false;
}
