/**
 * 软键盘高度订阅。
 *
 * 场景：对话页是 `height:100vh + overflow:hidden` 的 flex 布局，软键盘弹起时不会让位，
 * 输入框下方的加号 / 发送按钮 / 免责提示会被键盘盖住 —— 需要按键盘高度把页面收窄。
 *
 * 注：与 `requestVirtualPayment` 同理，Taro 不保证把较新的 wx 接口都挂出来，
 * 故优先取 Taro.onKeyboardHeightChange，取不到时退回 globalThis.wx 原生接口。
 */
import Taro from '@tarojs/taro';

type KeyboardHandler = (result: { height?: number }) => void;
type KeyboardBridge = {
  onKeyboardHeightChange?: (callback: KeyboardHandler) => void;
  offKeyboardHeightChange?: (callback?: KeyboardHandler) => void;
};

function resolveKeyboardBridge(): KeyboardBridge | null {
  const taroScope = Taro as unknown as KeyboardBridge;
  if (typeof taroScope.onKeyboardHeightChange === 'function') return taroScope;
  const globalScope = (typeof globalThis === 'undefined' ? undefined : globalThis) as unknown as { wx?: KeyboardBridge };
  const api = globalScope && globalScope.wx ? globalScope.wx : undefined;
  return api && typeof api.onKeyboardHeightChange === 'function' ? api : null;
}

/** 订阅软键盘高度变化；返回取消订阅函数（环境不支持时为空函数，调用方直接 useEffect 返回即可） */
export function subscribeKeyboardHeight(handler: KeyboardHandler) {
  const bridge = resolveKeyboardBridge();
  if (!bridge?.onKeyboardHeightChange) return () => {};
  bridge.onKeyboardHeightChange(handler);
  return () => {
    try { bridge.offKeyboardHeightChange?.(handler); } catch { /* 旧基础库可能没有 off，忽略 */ }
  };
}

/**
 * 当前窗口高度（px）。
 * 用途：iOS 上键盘是浮层，窗口高度不变；Android 部分版本键盘会把 webview 直接压缩，
 * 此时窗口高度已经少了键盘那一截，再按键盘高度让位就是重复让位（输入框会飘到半空）。
 */
export function readWindowHeight() {
  try {
    const taroScope = Taro as unknown as { getWindowInfo?: () => { windowHeight?: number } };
    const info = typeof taroScope.getWindowInfo === 'function' ? taroScope.getWindowInfo() : Taro.getSystemInfoSync();
    return Number((info as { windowHeight?: number } | undefined)?.windowHeight) || 0;
  } catch {
    return 0;
  }
}

/**
 * 键盘避让高度订阅：回调参数是「页面还要额外让位多少 px」。
 *
 * - iOS（键盘是浮层）：= 键盘高度，页面按它收窄即可。
 * - Android 部分版本（键盘把 webview 压缩）：窗口高度已经少了键盘那一截 → 返回 0，避免重复让位。
 *
 * 对话页与工作流配置页共用同一套判定，避免两边各写一份、其中一边漏了 Android 处理。
 */
export function subscribeKeyboardOffset(handler: (offset: number) => void) {
  /** 键盘弹起前的窗口高度基准（Android 压缩判定的参照） */
  let baseWindowHeight = 0;
  return subscribeKeyboardHeight((result) => {
    const height = Math.max(0, Number(result?.height) || 0);
    const windowHeight = readWindowHeight();
    if (height <= 0) {
      if (windowHeight > 0) baseWindowHeight = windowHeight;
      handler(0);
      return;
    }
    if (!baseWindowHeight && windowHeight > 0) baseWindowHeight = windowHeight;
    const resizedByKeyboard = baseWindowHeight > 0 && windowHeight > 0 && baseWindowHeight - windowHeight > 60;
    handler(resizedByKeyboard ? 0 : height);
  });
}
