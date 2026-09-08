import Taro from '@tarojs/taro';

/**
 * 公告通知通用逻辑（首页铃铛红点 + 公告列表页共用）。
 * 与网页端同源：按发布时间倒序，取最新一条时间与「最近已读时间」比较判断未读；
 * 查看后把最新时间写入本地存储（等价于网页端 localStorage 的 clone_ann_last_seen）。
 */

export type Announcement = Record<string, unknown>;

/** 已读标记的本地存储 key（等价网页端 clone_ann_last_seen） */
const ANN_SEEN_KEY = 'usunai_miniapp_ann_seen';
/** 首页铃铛红点刷新事件（列表页标记已读后广播，首页监听后重新读取已读状态） */
export const ANN_SEEN_EVENT = 'usunai-miniapp-ann-seen';

/** 公告发布时间（优先 publishedAt，回退 createdAt/updatedAt/startAt） */
export function announcementTime(item?: Announcement | null): string {
  if (!item) return '';
  return String(item.publishedAt || item.createdAt || item.updatedAt || item.startAt || '');
}

/** 按发布时间倒序（最新在前），与网页端一致 */
export function sortAnnouncements(list: Announcement[]): Announcement[] {
  return [...list].sort((a, b) => {
    const ta = Date.parse(announcementTime(a)) || 0;
    const tb = Date.parse(announcementTime(b)) || 0;
    return tb - ta;
  });
}

/** 最新一条公告的发布时间（ISO 字符串，无公告返回空串） */
export function latestAnnouncementTime(list: Announcement[]): string {
  return announcementTime(sortAnnouncements(list)[0]);
}

/** 读取「最近已读」的最新公告时间 */
export function getAnnouncementSeen(): string {
  return Taro.getStorageSync<string>(ANN_SEEN_KEY) || '';
}

/** 标记已读：把最新公告时间写入本地存储 */
export function markAnnouncementsSeen(list: Announcement[]): void {
  const newest = latestAnnouncementTime(list);
  if (newest) Taro.setStorageSync(ANN_SEEN_KEY, newest);
}

/** 是否有未读公告（最新公告时间晚于已读时间） */
export function hasUnreadAnnouncements(list: Announcement[]): boolean {
  const newest = latestAnnouncementTime(list);
  if (!newest) return false;
  return newest > (getAnnouncementSeen() || '');
}
