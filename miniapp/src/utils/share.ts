import Taro from '@tarojs/taro';
import type { ShareSettings } from '../types';
import { toMiniappUrl } from './entity-visual';

/**
 * 小程序「转发给朋友 / 分享到朋友圈」的标题、落地路径与配图。
 *
 * ⚠️ 页面里必须**自己写** `useShareAppMessage(...)` / `useShareTimeline(...)`，不能只在别处包一层：
 * Taro 4 是**逐页扫源码**来决定要不要给这一页注册原生转发能力的
 * （`@tarojs/plugin-framework-react/dist/index.js` 的 `addConfig()`：在页面源码的 AST 里匹配
 * `useShareAppMessage` / `useShareTimeline` 这两个**调用名**，命中才给该页注入
 * `component.enableShareAppMessage = true`）。
 * 页面源码里没有这个调用 → 该页不会注册原生 `onShareAppMessage` → 右上角菜单永远显示
 * 「当前页面不可转发 / 不可分享」，而且**不报错、不警告**。把 hook 封成 `useMiniappShare()`
 * 再让页面调用同样无效（名字对不上）。
 * 所以：hook 调用留在各页，本文件只提供「标题 + 路径 + 配图」这一份取值来源，避免 18 个页面各写一套。
 *
 * 取值优先级（2026-09-13 起）：后台「小程序设置 → 分享设置」配的三项 > 内置默认。
 * 配的三项随 `/api/miniapp/v1/content` 下发并缓存在本地（见 services/api.ts 的 applyShareSettings），
 * 这里在**渲染期**同步读缓存 —— 分享回调不能发请求（微信不给异步的机会），
 * 所以值必须提前落在本地；后台改了配置，用户下次进入小程序（内容缓存 TTL 5 分钟）自动生效。
 */

/** 品牌名，用来补齐标题后缀。 */
const BRAND = '友尚AI';

/** 兜底落地页：解析不出当前页面时落回首页。 */
export const SHARE_HOME_PATH = '/pages/home/index';

/** 缺省标题：页面没给语境名、后台也没配标题时用。 */
const DEFAULT_TITLE = `${BRAND} · 装修家居建材 AI 获客平台`;

/** 后台分享设置在本地的缓存键（只有本文件读写）。 */
const SHARE_CACHE_KEY = 'usunai_miniapp_share_v1';

/** 与 server/miniapp-share.mjs 的上限保持一致：超长值直接丢弃，不把脏值送进分享卡片。 */
const TITLE_MAX = 60;
const PATH_MAX = 200;
const IMAGE_MAX = 500;

/**
 * 配图只认 https 外链与本站图床（`/api/blob/serve?…`）。
 * ⚠️ 不收小程序包内相对路径（微信文档示例的 `/images/share.png` 就是这种）：包内没有那个
 * 文件时卡片会显示一张破图且不报错；而 `toMiniappUrl` 还会把它拼成站点地址（必然 404）。
 */
const SHARE_IMAGE_RE = /^(?:https?:\/\/|\/api\/blob\/serve\?)/i;

const EMPTY_SETTINGS: ShareSettings = { title: '', path: '', imageUrl: '' };

export interface ShareTarget {
  /** 页面语境名（智能体名 / 工作流名 / 分类名等）。留空则用缺省标题。 */
  title?: string;
}

export interface ShareAppPayload {
  title: string;
  path: string;
  /** 5:4 配图；未配置时不带这个字段，交回微信「截取当前页面」。 */
  imageUrl?: string;
}

export interface ShareTimelinePayload {
  title: string;
  /** 朋友圈固定打开当前页面，只能带 query（改不了路径）。 */
  query: string;
  imageUrl?: string;
}

export interface SharePayloads {
  /** 右上角「转发给朋友」 */
  app: ShareAppPayload;
  /** 右上角「分享到朋友圈」 */
  timeline: ShareTimelinePayload;
}

/** 只接受本小程序内的页面路径，避免后台手滑写进一个点开就白屏的地址。 */
function isPagePath(value: string): boolean {
  return /^\/pages\/[a-z0-9-]+\/index(\?[^\s#]*)?$/.test(value);
}

function normalizeSettings(raw?: Partial<ShareSettings> | null): ShareSettings {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const path = text(source.path, PATH_MAX);
  const imageUrl = text(source.imageUrl, IMAGE_MAX);
  return {
    title: text(source.title, TITLE_MAX),
    path: isPagePath(path) ? path : '',
    imageUrl: SHARE_IMAGE_RE.test(imageUrl) ? imageUrl : '',
  };
}

/**
 * 服务端下发的分享设置落本地缓存。由 services/api.ts 在拉到 /content 后调用。
 *
 * ⚠️ 传空/非对象（旧版服务端根本不带这个字段）时**直接返回、不清缓存**：
 * 否则服务端回滚一版，用户本地已生效的配置就会被清空、退化成内置默认。
 */
export function applyShareSettings(raw?: Partial<ShareSettings> | null): void {
  if (!raw || typeof raw !== 'object') return;
  try {
    Taro.setStorageSync(SHARE_CACHE_KEY, { savedAt: Date.now(), data: normalizeSettings(raw) });
  } catch {
    // 写存储失败（配额满等）不该影响内容加载：本次会话回退内置默认即可。
  }
}

function readShareSettings(): ShareSettings {
  try {
    const cached = Taro.getStorageSync<{ data?: Partial<ShareSettings> }>(SHARE_CACHE_KEY);
    return normalizeSettings(cached?.data);
  } catch {
    return EMPTY_SETTINGS;
  }
}

/**
 * 当前页面的路径与 query。后台没配固定落地页时，转发就落回「用户正在看的这一页」——
 * 所见即所分享，这样详情页 / 分类页分享出去的对象（`?id=`/`?category=`）不会被丢掉。
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
  const settings = readShareSettings();

  // 标题：后台配了就用全局标题；没配则按语境拼（详情页「<智能体名> · 友尚AI」）。
  const title = settings.title || shareTitle(target.title);

  // 落地页：后台配了固定路径就用它 —— 这才是「转发整个小程序名片」的形态；
  // 配的路径自带 query 时按其原文使用，不再叠加当前页的 query（那属于当前页，叠上去是错的）。
  const appPath = settings.path || (query ? `${path}?${query}` : path);

  // 配图：本站上传图是 `/api/blob/serve?key=…` 相对地址，必须补全成绝对地址，
  // 否则分享卡片加载不出来（与头像 / banner 同一套补全逻辑）。
  const imageUrl = toMiniappUrl(settings.imageUrl);

  return {
    // 未配图时**不带** imageUrl 字段：交给微信「截取当前页面」，与以前的行为一致。
    app: imageUrl ? { title, path: appPath, imageUrl } : { title, path: appPath },
    // 朋友圈固定打开当前页面，后台配的路径对它无效 —— 这里只沿用当前页的 query。
    timeline: imageUrl ? { title, query, imageUrl } : { title, query },
  };
}
