/**
 * 全局主题（浅色 / 深色 / 跟随系统）。
 *
 * 实现方式：
 *  - 用户选择持久化在 storage（THEME_KEY），并提供模块级缓存 + 订阅广播，
 *    使同一个小程序页面栈内的所有页面在切换时同步重渲染。
 *  - 每个页面在顶层渲染 <PageMeta pageStyle={themePageStyle()} />：深色时把一套
 *    --mini-* 暗色 CSS 变量内联到 page 元素上，覆盖 app.scss 中的浅色默认值。
 *  - 原生导航栏 / 下拉背景不受 CSS 变量控制，需在页面 onShow 时调用 applyNavbar()。
 */
import Taro from '@tarojs/taro';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'mini_theme_mode';

const NAV_BAR: Record<ResolvedTheme, { frontColor: string; backgroundColor: string }> = {
  light: { frontColor: '#000000', backgroundColor: '#f4f7fb' },
  dark: { frontColor: '#ffffff', backgroundColor: '#0e1622' },
};
const PAGE_BG: Record<ResolvedTheme, string> = { light: '#f4f7fb', dark: '#0e1622' };

/**
 * 暗色 token 覆盖集。key 必须与 app.scss page{} 中的语义变量一一对应，
 * 深色时以 pageStyle 内联覆盖浅色默认值。
 */
const DARK_VARS: Record<string, string> = {
  '--mini-page': '#0e1622',
  '--mini-page-grad-1': '#0f1a2b',
  '--mini-page-grad-2': '#0d1623',
  '--mini-surface': '#172133',
  '--mini-glass': 'rgba(26, 38, 60, .85)',
  '--mini-soft': '#202c3f',
  '--mini-ink': '#e8eef7',
  '--mini-text-2': '#aebdd2',
  '--mini-subtle': '#8ba0ba',
  '--mini-subtle-2': '#6d7f98',
  '--mini-primary': '#4a7dff',
  '--mini-primary-strong': '#7ca4ff',
  '--mini-primary-soft': '#1c2a44',
  '--mini-primary-pale': '#101a2e',
  '--mini-primary-border': '#2c4370',
  '--mini-line': '#26344e',
  '--mini-line-strong': '#31425f',
  '--mini-line-faint': '#1f2b40',
  '--mini-danger': '#ff7080',
  '--mini-danger-soft': 'rgba(216, 50, 72, .16)',
  '--mini-success': '#56c27a',
  '--mini-success-soft': 'rgba(47, 138, 76, .16)',
  '--mini-warn': '#e0a93d',
  '--mini-warn-soft': 'rgba(196, 140, 30, .18)',
  '--mini-accent': '#9b86f5',
  '--mini-accent-soft': 'rgba(116, 73, 216, .16)',
  '--mini-active': '#3b71ef',
  '--mini-membership-bg': 'linear-gradient(135deg, #22304d, #1a2740)',
  '--mini-hero': '#141f36',
  '--mini-cover-a': '#13203a',
  '--mini-cover-b': '#101c33',
  '--mini-shadow': '0 16px 42px rgba(0, 0, 0, .35)',
  '--mini-shadow-sm': '0 8px 24px rgba(0, 0, 0, .25)',
  /* TDesign 组件变量：让其内置容器/文字/边框随暗色走（组件内部大量 var(--td-*)） */
  '--td-bg-color-container': 'var(--mini-surface)',
  '--td-bg-color-container-hover': 'var(--mini-soft)',
  '--td-bg-color-container-active': 'var(--mini-soft)',
  '--td-bg-color-secondarycontainer': 'var(--mini-soft)',
  '--td-bg-color-component': 'var(--mini-soft)',
  '--td-bg-color-component-hover': 'var(--mini-line-faint)',
  '--td-bg-color-page': 'var(--mini-page)',
  '--td-text-color-primary': 'var(--mini-ink)',
  '--td-text-color-secondary': 'var(--mini-text-2)',
  '--td-text-color-placeholder': 'var(--mini-subtle-2)',
  '--td-text-color-disabled': 'var(--mini-subtle-2)',
  '--td-text-color-link': 'var(--mini-primary-strong)',
  '--td-border-level-1-color': 'var(--mini-line)',
  '--td-border-level-2-color': 'var(--mini-line-faint)',
  '--td-error-color-6': 'var(--mini-danger)',
  '--td-gray-color-1': '#1e293d',
  '--td-gray-color-2': 'rgba(255, 255, 255, .5)',
  '--td-gray-color-3': 'rgba(255, 255, 255, .35)',
  '--td-gray-color-4': 'rgba(255, 255, 255, .22)',
  '--td-tab-bar-bg-color': 'rgba(23, 33, 51, .94)',
  '--td-tab-bar-border-color': 'var(--mini-line-faint)',
  '--td-tab-bar-round-shadow': '0 8px 24px rgba(0, 0, 0, .3)',
};

type ThemeListener = () => void;
const listeners = new Set<ThemeListener>();

function emitThemeChange() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A failing listener must not break theme switching.
    }
  });
}

export function subscribeTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSystemTheme(): ResolvedTheme {
  try {
    const info = Taro.getSystemInfoSync() as unknown as { theme?: string };
    return info.theme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function readMode(): ThemeMode {
  try {
    const value = Taro.getStorageSync<string>(THEME_KEY);
    return value === 'dark' || value === 'auto' ? value : 'light';
  } catch {
    return 'light';
  }
}

export function setMode(mode: ThemeMode) {
  try {
    Taro.setStorageSync(THEME_KEY, mode);
  } catch {
    // Persisting the preference is best-effort.
  }
  emitThemeChange();
}

export function resolveTheme(mode?: ThemeMode): ResolvedTheme {
  const current = mode ?? readMode();
  return current === 'auto' ? getSystemTheme() : current;
}

/** 深色时为 page 元素生成 CSS 变量覆盖串（PageMeta.pageStyle 使用）。 */
export function themePageStyle(): string {
  if (resolveTheme() !== 'dark') return '';
  return Object.entries(DARK_VARS)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

/** 同步原生导航栏 / 下拉背景颜色（page-meta 无法控制原生 chrome）。 */
export function applyNavbar() {
  const theme = resolveTheme();
  try {
    Taro.setNavigationBarColor({ ...NAV_BAR[theme] });
  } catch {
    // 非微信环境（如 H5 预览）忽略。
  }
  try {
    Taro.setBackgroundColor({ backgroundColor: PAGE_BG[theme] });
  } catch {
    // ignore
  }
  try {
    Taro.setBackgroundTextStyle({ textStyle: theme === 'dark' ? 'light' : 'dark' });
  } catch {
    // ignore
  }
}

/** 监听系统深浅色切换：仅「跟随系统」模式下触发全局重渲染。App 启动时调用一次。 */
export function listenSystemTheme() {
  try {
    const api = Taro.onThemeChange as unknown;
    if (typeof api !== 'function') return;
    (api as (callback: () => void) => void)(() => {
      if (readMode() === 'auto') emitThemeChange();
    });
  } catch {
    // 旧基础库无 onThemeChange，忽略。
  }
}
