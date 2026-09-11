import Taro from '@tarojs/taro';
import type { MiniLinkValue } from '../types';

/**
 * 底部导航那三个「一级页」。App 用的是自定义 TabBar（`components/miniapp-tab-bar`），
 * 跳它们时走 reLaunch —— 否则会在页面上再叠一层同名页面，返回手势会变得很怪。
 * ⚠️ 改 app.config.ts 的页面或 TabBar 时，这里要一起看。
 */
const RELAUNCH_PAGES = new Set(['/pages/home/index', '/pages/category/index', '/pages/profile/index']);

const WEBVIEW_PAGE = '/pages/webview/index';

function webviewUrl(url: string) {
  return `${WEBVIEW_PAGE}?url=${encodeURIComponent(url)}`;
}

/**
 * 把后台配置的链接值解析成可以直接 Taro.navigateTo 的 url。
 * 返回 '' 表示「没有跳转」，调用方直接忽略即可（绝不会拼出打不开的地址）。
 *
 * 兼容两种形态：
 *  - 对象（新）：{ kind: 'agent' | 'workflow' | 'page' | 'category' | 'external' | 'none', ... }
 *  - 字符串（旧，不迁移）：'/pages/xxx' 或 'https://...'
 */
export function resolveLink(link: MiniLinkValue | null | undefined): string {
  if (!link) return '';

  if (typeof link === 'string') {
    const raw = link.trim();
    if (!raw) return '';
    if (raw.startsWith('/pages/')) return raw;
    if (/^https:\/\//i.test(raw)) return webviewUrl(raw);
    return '';
  }

  if (typeof link !== 'object') return '';

  switch (link.kind) {
    case 'agent':
      return link.id ? `/pages/chat/index?id=${encodeURIComponent(link.id)}` : '';
    case 'workflow':
      return link.id ? `/pages/workflow/index?id=${encodeURIComponent(link.id)}` : '';
    case 'page':
      return link.path && link.path.startsWith('/pages/') ? link.path : '';
    case 'category':
      return link.key ? `/pages/category/index?category=${encodeURIComponent(link.key)}` : '';
    case 'external':
      return link.url && /^https:\/\//i.test(link.url) ? webviewUrl(link.url) : '';
    default:
      return '';
  }
}

/** 解析并跳转；没有可跳目标时什么都不做。 */
export function navigateLink(link: MiniLinkValue | null | undefined): void {
  const url = resolveLink(link);
  if (!url) return;
  const path = url.split('?')[0];
  if (RELAUNCH_PAGES.has(path)) void Taro.reLaunch({ url });
  else void Taro.navigateTo({ url });
}

/**
 * 链接是不是「还没配好」：给了对象但缺少必要字段（例如选了「智能体」却没选具体哪一个）。
 * 后台保存前会拦，小程序这边遇到就当没配，避免跳到空页。
 */
export function isIncompleteLink(link: MiniLinkValue | null | undefined): boolean {
  if (!link || typeof link !== 'object') return false;
  if (link.kind === 'none') return false;
  return !resolveLink(link);
}
