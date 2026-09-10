/**
 * 智能体 / 工作流的头像视觉取值：URL 补全 + 图标字形兜底。
 *
 * 背景：后端 `icon` 字段是 lucide 图标名（FileText / Video / UserCircle …）而**不是**图片地址，
 * 且大量实体没有自定义 `avatar`（线上 32 个智能体里 18 个是空串）。若直接 `avatar || icon`
 * 传给图片组件，会拼出 `https://www.usunai.top/FileText` 这种死链 → 表现为「头像不显示」。
 *
 * 所以统一在这里判定：有真头像用图，没有则退化成「图标字形 + 品牌渐变底」的色块头像。
 * 列表卡片（content-card）、对话页页头/消息体、工作流页页头共用同一套取值。
 */
import type { ContentItem } from '../types';

export const WEB_ORIGIN = 'https://www.usunai.top';

/** 兜底色块：icon → 单字符字形 */
export const ICON_GLYPHS: Record<string, string> = {
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
  Archive: '▤',
  Workflow: '▦',
  Zap: '⚡',
};

/** 兜底色块：iconColor（形如 bg-blue-600）→ 纯色渐变底 */
export const ICON_BACKGROUNDS: Record<string, string> = {
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

/** 相对路径（/api/blob/serve?...）补全为小程序可加载的绝对地址；已是绝对/data/blob 地址原样返回 */
export function toMiniappUrl(value?: string) {
  if (!value || /^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value || '';
  return `${WEB_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

/** 头像走服务端缩图，43KB 原图压到 ~5KB（列表卡片一直这么做，对话页也跟上） */
export function toAvatarUrl(value?: string) {
  const url = toMiniappUrl(value);
  if (!url || !url.includes('/api/blob/serve')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}format=webp&w=164&h=164`;
}

export type EntityAvatar = {
  /** 可直接给 <Image src> 的地址；空串表示该实体没有可用头像 */
  url: string;
  /** 无头像时渲染的单字符字形 */
  glyph: string;
  /** 无头像时的色块底（CSS background 值） */
  background: string;
};

/** 统一的头像取值：优先真头像，缺省退化为「字形 + 渐变底色块」 */
export function resolveEntityAvatar(
  item?: Partial<ContentItem> | null,
  fallbackType: 'agent' | 'workflow' = 'agent',
): EntityAvatar {
  const url = toAvatarUrl(item?.avatar);
  const glyph = ICON_GLYPHS[item?.icon || ''] || (item?.name || '').trim().slice(0, 1) || (fallbackType === 'agent' ? 'AI' : '流');
  const background = ICON_BACKGROUNDS[item?.iconColor || ''] || ICON_BACKGROUNDS['bg-blue-600'];
  return { url, glyph, background };
}
