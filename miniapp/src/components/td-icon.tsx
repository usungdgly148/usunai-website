import { Text } from '@tarojs/components';

/**
 * TDesign 图标（本地子集字体渲染，微信离线可用）。
 * 码点来自 tdesign-miniprogram 0.4.3 iconfont（icon/icon.wxss），
 * 子集字体已 base64 内联在 app.scss 的 @font-face('td-icons') 中。
 * 用法：<TdIcon name='time' />，尺寸/颜色继承外部样式（font-size/color）。
 */
const GLYPHS: Record<string, string> = {
  add: '\uE00D',
  'info-circle': '\uE49F',
  close: '\uE224',
  'play-circle': '\uE6A5',
  'pause-circle': '\uE676',
  'play': '\uE6AA',
  send: '\uE723',
  time: '\uE834',
  /** 「加入资产库」：t-chat-actionbar 的 iconMap 不含自定义动作，图标由本组件自绘 */
  'bookmark-add': '\uE0CD',
  /** 工作流页头「去历史记录」（对应网页版 SubHeader 的 MessageSquare） */
  chat: '\uE1B6',
  /** 工作流页头「回配置参数」（对应网页版 SubHeader 的 SlidersHorizontal） */
  'control-platform': '\uE26D',
  /** 历史记录卡片：运行完成 / 复制结果 / 图片计数 / 视频计数 */
  'check-circle': '\uE1B8',
  copy: '\uE273',
  image: '\uE498',
  video: '\uE8EF',
};

export function TdIcon({ name, className = '' }: { name: keyof typeof GLYPHS | string; className?: string }) {
  const glyph = GLYPHS[name] || '';
  if (!glyph) return null;
  return <Text className={`td-icon ${className}`}>{glyph}</Text>;
}

export default TdIcon;
