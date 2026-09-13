import Taro from '@tarojs/taro';
import { getMe } from '../services/api';
import type { ContentItem, UserProfile } from '../types';

/**
 * VIP 专享门禁（小程序侧）。
 *
 * 分工：**服务端才是闸门**（server/miniapp-runtime.mjs 与 server/index.mjs 都会回 403 VIP_REQUIRED），
 * 这里只负责「让用户在点下去的那一刻就看到弹窗 + 一键去升级」，避免白白发一次请求、
 * 也避免用户只看到一句干巴巴的失败提示而不知道去哪儿升级。
 *
 * ⚠️ 判定口径不要在这里重写：只读服务端算好的 `profile.vipAccess`
 * （判定口径唯一实现在 server/plan-access.mjs，试用中 / 已过期 / 无套餐一律 false）。
 */

/** 引导升级的落地页：算力充值页（非 tabBar 页，从任意内容页 navigateTo 均可）。 */
const RECHARGE_PAGE = '/pages/recharge/index';

/**
 * 弹窗引导升级套餐。
 * @returns true = 用户选择去升级（已跳转）；false = 用户放弃
 */
export async function promptUpgrade(name?: string): Promise<boolean> {
  const label = String(name || '').trim();
  const res = await Taro.showModal({
    title: 'VIP 专享内容',
    content: `${label ? `「${label}」` : '该内容'}为 VIP 专享，当前「免费试用」套餐无法使用。\n升级为更高权益套餐后即可使用。`,
    confirmText: '去升级',
    cancelText: '暂不升级',
    confirmColor: '#305CE0',
  });
  if (!res.confirm) return false;
  void Taro.navigateTo({ url: RECHARGE_PAGE });
  return true;
}

/**
 * 使用某个智能体/工作流前的门禁：命中 VIP 专享且当前无资格时弹窗引导升级。
 *
 * @returns true = 放行（可以继续发送/提交）；false = 已拦截（弹窗已展示或已跳转升级）
 */
export async function ensureVipAccess(item?: Pick<ContentItem, 'vip' | 'name'> | null): Promise<boolean> {
  if (!item || item.vip !== true) return true;
  let profile: UserProfile | null = null;
  try {
    profile = await getMe();
  } catch {
    // 拿不到档案（未登录 / 网络异常）时不在这里拦：交给服务端闸门给出准确结果，
    // 否则会在登录态异常时把用户挡在一个说不出原因的弹窗上。
    return true;
  }
  if (profile.vipAccess !== false) return true;
  await promptUpgrade(item.name);
  return false;
}
