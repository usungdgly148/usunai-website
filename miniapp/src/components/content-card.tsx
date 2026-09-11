import { Image, Text, View } from '@tarojs/components';
import type { ContentItem, MiniLinkValue } from '../types';
import { resolveEntityAvatar } from '../utils/entity-visual';
import { navigateLink, resolveLink } from '../utils/link';

const GRADIENT_PRESETS: Record<string, { from: string; to: string }> = {
  'bg-blue-600': { from: '#DBEAFE', to: '#FFFFFF' },
  'bg-rose-600': { from: '#FFE4E6', to: '#FFFFFF' },
  'bg-green-600': { from: '#DCFCE7', to: '#FFFFFF' },
  'bg-emerald-600': { from: '#D1FAE5', to: '#FFFFFF' },
  'bg-amber-600': { from: '#FEF3C7', to: '#FFFFFF' },
  'bg-violet-600': { from: '#EDE9FE', to: '#FFFFFF' },
  'bg-slate-700': { from: '#F1F5F9', to: '#FFFFFF' },
  'bg-cyan-600': { from: '#CFFAFE', to: '#FFFFFF' },
  'bg-teal-600': { from: '#CCFBF1', to: '#FFFFFF' },
  'bg-lime-600': { from: '#ECFCCB', to: '#FFFFFF' },
  'bg-purple-600': { from: '#F3E8FF', to: '#FFFFFF' },
  'bg-indigo-600': { from: '#E0E7FF', to: '#FFFFFF' },
  'bg-red-600': { from: '#FEE2E2', to: '#FFFFFF' },
};

const CATEGORY_BACKGROUNDS: Record<string, string> = {
  'short-video': 'linear-gradient(135deg, #FFF1F0 0%, #FFFFFF 100%)',
  private: 'linear-gradient(135deg, #1E293B 0%, #334155 70%, #475569 100%)',
  geo: 'linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 100%)',
};

function getCoverBackground(item: ContentItem) {
  const preset = GRADIENT_PRESETS[item.iconColor || ''] || GRADIENT_PRESETS['bg-blue-600'];
  const hasCustomGradient = Boolean(item.gradientFrom || item.gradientTo);
  const from = item.gradientFrom || preset.from;
  const to = item.gradientTo || preset.to;
  const angle = Number(item.gradientAngle) || 30;
  if (hasCustomGradient) return `linear-gradient(${angle}deg, ${from}, ${to})`;
  if (item.category && CATEGORY_BACKGROUNDS[item.category]) return CATEGORY_BACKGROUNDS[item.category];
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

export function ContentCard({ item, type, variant = 'cover', link }: {
  item: ContentItem;
  type: 'agent' | 'workflow';
  variant?: 'cover' | 'compact';
  /**
   * 后台在「小程序设计」里给这张卡单独配的跳转（首页推荐区用）。
   * 不传 / 配了但解析不出目标 → 保持原行为：打开这个智能体 / 工作流自身。
   */
  link?: MiniLinkValue;
}) {
  const tags = (item.tags || []).filter(Boolean).slice(0, 2);
  const description = item.description || item.desc || (type === 'agent'
    ? 'AI 智能助手，为你完成创作与获客任务'
    : '一键运行工作流，快速完成内容生产');
  const operationPath = type === 'agent' ? '/pages/chat/index' : '/pages/workflow/index';
  // 头像取值：有真头像用图，没有则退化成图标字形色块（后端 icon 是图标名不是地址）
  const { url: avatarUrl, glyph: fallback, background: fallbackBackground } = resolveEntityAvatar(item, type);
  const fallbackStyle = { background: fallbackBackground };

  const handleOpen = () => {
    // 拼成默认地址后统一交给 navigateLink —— 一条路径，不会出现「配了链接却不走 reLaunch 判定」的分叉
    const fallbackTarget = `${operationPath}?id=${encodeURIComponent(item.id)}`;
    navigateLink(resolveLink(link) || fallbackTarget);
  };

  // 紧凑样式：左圆形头像 + 右名称/简介。用于首页「热门智能体/工作流」section。
  // 背景统一为毛玻璃大圆角（由 .mini-content-card--compact 的 CSS 变量控制，浅/深色自适应），
  // 不再按 item 的 iconColor 渐变着色。
  if (variant === 'compact') {
    return <View
      className='card mini-content-card mini-content-card--compact'
      hoverClass='mini-content-card-hover'
      onClick={handleOpen}
    >
      <View className='mini-content-card-compact-avatar'>
        {avatarUrl
          ? <Image className='mini-content-card-compact-img' mode='aspectFill' src={avatarUrl} lazyLoad webp />
          : <Text className='mini-content-card-compact-img mini-content-card-compact-fallback' style={fallbackStyle}>{fallback}</Text>}
      </View>
      <View className='mini-content-card-compact-body'>
        <Text className='mini-content-card-compact-name'>{item.name}</Text>
        <Text className='mini-content-card-compact-desc'>{description}</Text>
      </View>
    </View>;
  }

  return <View
    className='card mini-content-card'
    onClick={handleOpen}
  >
    <View className='mini-content-card-cover' style={{ background: getCoverBackground(item) }}>
      <Text className='mini-content-card-kind'>{type === 'agent' ? '智能体' : '工作流'}</Text>
      {avatarUrl
        ? <Image className='mini-content-card-avatar' mode='aspectFill' src={avatarUrl} lazyLoad webp />
        : <Text className='mini-content-card-fallback' style={fallbackStyle}>{fallback}</Text>}
    </View>
    <Text className='card-title'>{item.name}</Text>
    <Text className='card-desc'>{description}</Text>
    <View className='mini-content-card-footer'>
      <View className='tag-row'>
        {tags.length ? tags.map(tag => <Text className='tag' key={tag}>{tag}</Text>) : <Text className='tag'>立即体验</Text>}
      </View>
      <Text className='mini-content-card-uses'>{item.uses ? `${item.uses} 人在用` : ''}</Text>
    </View>
  </View>;
}
