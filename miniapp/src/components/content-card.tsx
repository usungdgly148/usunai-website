import { Image, Text, View } from '@tarojs/components';
import type { ContentItem, MiniLinkValue } from '../types';
import { resolveEntityAvatar } from '../utils/entity-visual';
import { navigateLink, resolveLink } from '../utils/link';

/*
 * ⚠️ 本文件与网页端 `frontend/src/components.jsx` 的 `AgentCard` 是**同一套视觉规范的两份实现**
 *    （小程序包不能 import 前端源码）。改规则时两边都要改，且**语义必须一致**：
 *    渐变优先级（自定义 > 分类主题）、角度 0° 合法、白蒙版默认 20%、深色类目不压蒙版。
 */

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

/**
 * 卡片白色蒙版的默认浓度（%）。
 * 🔴 必须与网页端 `cardGradient.js` 的 `CARD_MASK_OPACITY_DEFAULT` 保持一致（20，不是 30）。
 */
const CARD_MASK_OPACITY_DEFAULT = 20;

/**
 * 解析渐变角度。
 * 🔴 绝不写 `Number(x) || 30` —— 0° 是合法角度（后台预设里就有），0 是 falsy 会被悄悄换成 30°。
 *    这是网页端 2026-09-18 线上报障的根因，小程序这边此前一直带着同一个 bug。
 */
function resolveGradientAngle(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 30;
  if (typeof value !== 'number' && typeof value !== 'string') return 30;
  const n = Number(value);
  return Number.isFinite(n) ? n : 30;
}

/**
 * 解析白蒙版浓度。卡片的「0 = 不蒙版」是合法值，同样不能用 `|| 20` 兜底。
 * 返回值恒为 0–100 的整数（越界按边界夹紧，不报错）。
 */
function resolveMaskOpacity(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return CARD_MASK_OPACITY_DEFAULT;
  if (typeof value !== 'number' && typeof value !== 'string') return CARD_MASK_OPACITY_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return CARD_MASK_OPACITY_DEFAULT;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 白色蒙版层（叠在渐变之上）；浓度 0 时返回空串。 */
function maskOverlayCss(opacity: number | string | null | undefined): string {
  const alpha = resolveMaskOpacity(opacity) / 100;
  if (alpha <= 0) return '';
  return `linear-gradient(rgba(255,255,255,${alpha}), rgba(255,255,255,${alpha}))`;
}

/** 这张卡是否用了分类主题（= 没配自定义渐变）。深色判定必须以「真正生效的那层背景」为准。 */
function usesCategoryTheme(item: ContentItem): boolean {
  return !(item.gradientFrom || item.gradientTo);
}

function buildGradient(item: ContentItem): string {
  const preset = GRADIENT_PRESETS[item.iconColor || ''] || GRADIENT_PRESETS['bg-blue-600'];
  const from = item.gradientFrom || preset.from;
  const to = item.gradientTo || preset.to;
  const angle = resolveGradientAngle(item.gradientAngle);
  // 自定义渐变优先于分类主题：后台给这张卡单独配过颜色/角度就必须生效，
  // 分类主题只在没配时兜底（顺序与网页端 `hasCustomGradient(item) ? null : theme` 一致）
  if (!usesCategoryTheme(item)) return `linear-gradient(${angle}deg, ${from}, ${to})`;
  if (item.category && CATEGORY_BACKGROUNDS[item.category]) return CATEGORY_BACKGROUNDS[item.category];
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

/** `9999` → `9999`、`29000` → `2.9万`，与网页端 formatCount 同口径（只影响展示）。 */
function formatUses(n?: number): string {
  const num = Number(n) || 0;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
  return String(num);
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
  // ⚠️ 卡片左下角的文字标签已于 2026-11-18 按主人要求整体移除（智能体卡 / 工作流卡一律不带标签）。
  //    `item.tags` 仍是详情页与实体头部的数据源（`inner-ui.tsx` / `pages/detail`），只删卡片这里的展示。
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

  /*
   * 2026-11-18 卡片改版（与网页端 AgentCard 同构）：
   *   ① 取消「158px 渐变封面 + 居中大头像」的版式 —— 改为「渐变铺满整张卡 + 左上角小图标块」，
   *      这正是网页端 2026-11-17/18 两轮改版后的形态。
   *   ② 图标块 56px（网页端 31px；小程序设计宽 750rpx，1px = 1rpx，两列卡片约 338rpx 宽，
   *      按「图标块 ≈ 2× 名称字号」的同一比例取 56，与网页 31 : 16 的关系一致）。
   *   ③ 名称 / 描述各定高 2 行 —— 与网页端 `h-[39px]` / `h-[21px]` 同一个目的：
   *      有的卡一行、有的两行，不定高同页就会出现多种高度。
   *   ④ 深色类目（private 主题）不压白蒙版、标题/描述/人数整体翻白，否则深底黑字读不出来。
   *   ⑤ 底行只保留「N 人在用」（左下角文字标签已按主人要求移除，两类卡一致）。
   */
  const themed = usesCategoryTheme(item);
  const isDark = themed && item.category === 'private';
  // 白蒙版只叠加、不替换：蒙版层写在渐变**前面**（CSS 多背景里前者在上层）。
  // 深色类目不压蒙版 —— 白蒙版会把深色卡提亮成灰，白字立刻掉对比度。
  const mask = isDark ? '' : maskOverlayCss(item.maskOpacity);
  const surfaceBg = mask ? `${mask}, ${buildGradient(item)}` : buildGradient(item);

  return <View
    className={`card mini-content-card${isDark ? ' mini-content-card--dark' : ''}`}
    hoverClass='mini-content-card-hover'
    style={{ background: surfaceBg }}
    onClick={handleOpen}
  >
    <View className='mini-content-card-head'>
      <View className='mini-content-card-tile'>
        {avatarUrl
          ? <Image className='mini-content-card-tile-img' mode='aspectFill' src={avatarUrl} lazyLoad webp />
          : <Text className='mini-content-card-tile-glyph' style={fallbackStyle}>{fallback}</Text>}
      </View>
      {item.vip ? <Text className='mini-content-card-vip'>VIP</Text> : null}
    </View>
    <Text className='card-title'>{item.name}</Text>
    <Text className='card-desc'>{description}</Text>
    <View className='mini-content-card-footer'>
      <Text className='mini-content-card-uses'>{item.uses ? `${formatUses(item.uses)} 人在用` : ''}</Text>
    </View>
  </View>;
}
