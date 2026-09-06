/**
 * 主题 hook：
 *  - useThemePage(): 页面级。返回 { themeStyle }（深色时 CSS 变量覆盖串，直接内联到页面根
 *    View 的 style 上即可让整页换肤），并在页面 onShow 时同步原生导航栏 / 下拉背景。
 *  - useThemeStyle(): 通用组件级。仅订阅主题变化并返回 { themeStyle }（页面组件内部使用）。
 */
import { useEffect, useReducer } from 'react';
import { useDidShow } from '@tarojs/taro';
import { applyNavbar, subscribeTheme, themePageStyle } from '../utils/theme';

export function useThemeStyle() {
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  useEffect(() => subscribeTheme(forceRender), []);
  return { pageStyle: themePageStyle() };
}

export function useThemePage() {
  const style = useThemeStyle();
  // 页面每次展示都同步原生导航栏 / 下拉背景（其它页面切主题后返回时也会走到这里）。
  useDidShow(() => {
    applyNavbar();
  });
  return style;
}
