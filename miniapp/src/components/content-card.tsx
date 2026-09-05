import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import type { ContentItem } from '../types';

const WEB_ORIGIN = 'https://www.usunai.top';

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

const ICON_BACKGROUNDS: Record<string, string> = {
  'bg-blue-600': 'linear-gradient(135deg, #2563eb, #1d4ed8)',
  'bg-rose-600': 'linear-gradient(135deg, #e11d48, #be123c)',
  'bg-green-600': 'linear-gradient(135deg, #16a34a, #15803d)',
  'bg-emerald-600': 'linear-gradient(135deg, #059669, #047857)',
  'bg-amber-600': 'linear-gradient(135deg, #d97706, #b45309)',
  'bg-violet-600': 'linear-gradient(135deg, #7c3aed, #6d28d9)',
  'bg-slate-700': 'linear-gradient(135deg, #334155, #1e293b)',
  'bg-cyan-600': 'linear-gradient(135deg, #0891b2, #0e7490)',
  'bg-teal-600': 'linear-gradient(135deg, #0d9488, #0f766e)',
  'bg-lime-600': 'linear-gradient(135deg, #65a30d, #4d7c0f)',
  'bg-purple-600': 'linear-gradient(135deg, #9333ea, #7e22ce)',
  'bg-indigo-600': 'linear-gradient(135deg, #4f46e5, #4338ca)',
  'bg-red-600': 'linear-gradient(135deg, #dc2626, #b91c1c)',
};

const ICON_GLYPHS: Record<string, string> = {
  Home: '⌂',
  FileText: '▤',
  File: '▤',
  Video: '▶',
  BookOpen: '▰',
  Radio: '◉',
  Image: '▧',
  Clapperboard: '▰',
  MessageCircle: '◌',
  MessageSquare: '◌',
  Search: '⌕',
  Briefcase: '▣',
  ShoppingBag: '▱',
  LayoutGrid: '▦',
  History: '↶',
  Settings: '⚙',
  HelpCircle: '?',
  Grid3X3: '▦',
  Bell: '♧',
  User: '♙',
  Bot: '♙',
  Sparkles: '✦',
  CreditCard: '▤',
  Ticket: '▱',
  Receipt: '▤',
  Flag: '⚑',
  Star: '☆',
  Users: '♙',
  Mic: '♬',
  Calendar: '▣',
  CalendarDays: '▣',
  Target: '◎',
  Handshake: '♧',
  Crown: '♕',
  UserCircle: '◉',
  Lightbulb: '◌',
  Flame: '♨',
  Copy: '▣',
  Hammer: '⚒',
  Boxes: '▦',
  DoorOpen: '▯',
  Layers: '▱',
  Square: '□',
  Droplets: '♧',
  Sofa: '▰',
  PenTool: '✎',
  HardHat: '⌂',
  FileCheck: '▤',
  BadgeCheck: '✦',
};

function toMiniappUrl(value?: string) {
  if (!value || /^https?:\/\//i.test(value)) return value || '';
  return `${WEB_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

function toAvatarUrl(value?: string) {
  const url = toMiniappUrl(value);
  if (!url || !url.includes('/api/blob/serve')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}format=webp&w=164&h=164`;
}

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

export function ContentCard({ item, type }: { item: ContentItem; type: 'agent' | 'workflow' }) {
  const tags = (item.tags || []).filter(Boolean).slice(0, 2);
  const fallback = ICON_GLYPHS[item.icon || ''] || (type === 'agent' ? 'AI' : '流');
  const description = item.description || item.desc || (type === 'agent'
    ? 'AI 智能助手，为你完成创作与获客任务'
    : '一键运行工作流，快速完成内容生产');
  const operationPath = type === 'agent' ? '/pages/chat/index' : '/pages/workflow/index';
  const avatarUrl = toAvatarUrl(item.avatar);
  const fallbackStyle = { background: ICON_BACKGROUNDS[item.iconColor || ''] || ICON_BACKGROUNDS['bg-blue-600'] };

  return <View
    className='card mini-content-card'
    onClick={() => Taro.navigateTo({ url: `${operationPath}?id=${encodeURIComponent(item.id)}` })}
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
