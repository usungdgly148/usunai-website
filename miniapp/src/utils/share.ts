import Taro from '@tarojs/taro';

/**
 * 小程序「转发给朋友 / 分享到朋友圈」的标题与落地路径。
 *
 * ⚠️ 页面里必须**自己写** `useShareAppMessage(...)` / `useShareTimeline(...)`，不能只在别处包一层：
 * Taro 4 是**逐页扫源码**来决定要不要给这一页注册原生转发能力的
 * （`@tarojs/plugin-framework-react/dist/index.js` 的 `addConfig()`：在页面源码的 AST 里匹配
 * `useShareAppMessage` / `useShareTimeline` 这两个**调用名**，命中才给该页注入
 * `component.enableShareAppMessage = true`）。
 * 页面源码里没有这个调用 → 该页不会注册原生 `onShareAppMessage` → 右上角菜单永远显示
 * 「当前页面不可转发 / 不可分享」，而且**不报错、不警告**。把 hook 封成 `useMiniappShare()`
 * 再让页面调用同样无效（名字对不上）。
 * 所以：hook 调用留在各页，本文件只提供「标题 + 路径」这一份文案来源，避免 19 个页面各写一套。
 */

/** 品牌名，用来补齐标题后缀。 */
const BRAND = '友尚AI';

/** 兜底落地页：解析不出当前页面时落回首页。 */
export const SHARE_HOME_PATH = '/pages/home/index';

/** 缺省标题：页面没给语境名时用。 */
const DEFAULT_TITLE = `${BRAND} · 装修家居建材 AI 获客平台`;

export interface ShareTarget {
  /** 页面语境名（智能体名 / 工作流名 / 分类名等）。留空则用缺省标题。 */
  title?: string;
}

export interface SharePayloads {
  /** 右上角「转发给朋友」 */
  app: { title: string; path: string };
  /** 右上角「分享到朋友圈」：朋友圈固定打开当前页面，只能带 query */
  timeline: { title: string; query: string };
}

/**
 * 当前页面的路径与 query。转发默认就落回「用户正在看的这一页」——所见即所分享，
 * 这样详情页 / 分类页分享出去的对象（`?id=`/`?category=`）不会被丢掉。
 */
function currentLocation(): { path: string; query: string } {
  try {
    const router = Taro.getCurrentInstance()?.router;
    const path = String(router?.path || '');
    if (!path.startsWith('/pages/')) return { path: SHARE_HOME_PATH, query: '' };
    const query = Object.entries(router?.params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');
    return { path, query };
  } catch {
    return { path: SHARE_HOME_PATH, query: '' };
  }
}

function shareTitle(title?: string): string {
  const name = String(title || '').trim();
  return name ? `${name} · ${BRAND}` : DEFAULT_TITLE;
}

/**
 * 一次拿到两种分享载荷；页面里紧接着 `useShareAppMessage` / `useShareTimeline` 调用即可：
 *
 * ```tsx
 * const share = shareTargets({ title: agent?.name });
 * useShareAppMessage(() => share.app);
 * useShareTimeline(() => share.timeline);
 * ```
 *
 * ⚠️ 必须在**渲染期**调用（所以它读的是当次渲染的 router）：`onShareAppMessage` 的触发时机
 * 由微信决定，那时 `Taro.getCurrentInstance().router` 未必还在（切后台/隐藏会置空）。
 */
export function shareTargets(target: ShareTarget = {}): SharePayloads {
  const { path, query } = currentLocation();
  return {
    app: { title: shareTitle(target.title), path: query ? `${path}?${query}` : path },
    timeline: { title: shareTitle(target.title), query },
  };
}
