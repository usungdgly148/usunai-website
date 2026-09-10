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
