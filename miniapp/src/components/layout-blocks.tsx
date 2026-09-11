import Taro from '@tarojs/taro';
import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { ContentCard } from './content-card';
import { SearchBar, gotoGlobalSearch } from './search-bar';
import { API_BASE } from '../services/api';
import { navigateLink, resolveLink } from '../utils/link';
import { ANN_SEEN_EVENT, announcementTime, getAnnouncementSeen, sortAnnouncements, type Announcement } from '../services/announcements';
import type { ContentItem, MiniappLayout, MiniappLayoutBlock, PublicContent } from '../types';

function absoluteImageUrl(value: string) {
  const source = String(value || '').trim();
  if (!source || /^(?:https?:)?\/\//i.test(source) || /^data:/i.test(source)) return source;
  return source.startsWith('/') ? `${API_BASE.replace(/\/+$/, '')}${source}` : source;
}

function optimizedImageUrl(source: string, width: number, height: number) {
  if (!source.includes('/api/blob/serve?')) return source;
  const separator = source.includes('?') ? '&' : '?';
  return `${source}${separator}format=webp&w=${width}&h=${height}`;
}

export function ResilientImage({
  src,
  className,
  width,
  height,
  lazyLoad = false,
}: {
  src: string;
  className: string;
  width: number;
  height: number;
  lazyLoad?: boolean;
}) {
  const original = absoluteImageUrl(src);
  const preferred = optimizedImageUrl(original, width, height);
  const [current, setCurrent] = useState(preferred);

  useEffect(() => setCurrent(preferred), [preferred]);
  if (!original) return null;

  return <Image
    className={className}
    mode='aspectFill'
    src={current}
    webp
    lazyLoad={lazyLoad}
    onError={() => {
      if (current !== original) setCurrent(original);
    }}
  />;
}

/** 区块默认标题。⚠️ 后台属性面板会把它当占位提示显示，改这里要同步 AdminMiniappDesign.jsx 的 DEFAULT_TITLES。 */
export const titles: Record<MiniappLayoutBlock['type'], string> = {
  carousel: '精选推荐',
  announcements: '公告通知',
  search: '搜索工具',
  categories: '快捷分类',
  'featured-agents': '热门智能体',
  'featured-workflows': '热门工作流',
  spacer: '',
};

/** 「更多」入口的文案：没配就是「更多>>」，显式关掉就是空串（SectionTitle 见空串就不渲染）。 */
function moreLabel(block: MiniappLayoutBlock) {
  if (block.showMore === false) return '';
  return block.moreText || '更多>>';
}

function blockStyle(block: MiniappLayoutBlock) {
  return {
    marginBottom: `${Math.max(0, Number(block.spacing) || 0)}px`,
    backgroundColor: block.backgroundColor || undefined,
    color: block.textColor || undefined,
  };
}

function categoryRef(item: { id: string; key?: string }) {
  return String(item.key || item.id || '');
}

function isAllCategory(item: { id: string; key?: string; name?: string; label?: string }) {
  const key = categoryRef(item).toLowerCase();
  const name = String(item.label || item.name || '').trim();
  return key === 'all' || name === '全部';
}

/**
 * 网页版首页「热门智能体」的数据口径：按后台 recommended 数组顺序，
 * 从已上架智能体 + 工作流里取推荐 id（智能体/工作流混排）。
 * 小程序首页热门区只取前 6，热门二级页展示全部（对齐网页版）。
 * 返回 null 表示该 id 未上架（跳过）。
 */
export function recommendedEntries(content: PublicContent): Array<{ item: ContentItem; kind: 'agent' | 'workflow' }> {
  const agents = new Map((content.agents || []).map(item => [item.id, item]));
  const workflows = new Map((content.workflows || []).map(item => [item.id, item]));
  return (content.recommended || [])
    .map(id => {
      const agent = agents.get(id);
      if (agent) return { item: agent, kind: 'agent' as const };
      const workflow = workflows.get(id);
      if (workflow) return { item: workflow, kind: 'workflow' as const };
      return null;
    })
    .filter((entry): entry is { item: ContentItem; kind: 'agent' | 'workflow' } => !!entry);
}

/**
 * 推荐区（热门智能体 / 热门工作流）取数。
 *
 * 以前这里有两个「配了没反应」：
 *   - 「展示数量」被硬编码 `Math.min(6, limit)` 卡在 6，后台改多大都只显示 6 条；
 *   - 「数据源」这条分支压根没读过，不管选什么都不影响。
 * 现在两者都真的生效：`all` = 全部已上架（按 sortOrder），其余 = 推荐位（网页版同源，按 recommended
 * 数组顺序；智能体块保持「智能体工作流混排」的原有口径）。推荐位为空时回落全部，避免整块消失。
 *
 * ⚠️ 后台「小程序设计」的「每张卡片的跳转」面板直接 import 这个函数来列出会显示的卡片，
 *    所以它的口径就是唯一事实来源 —— 不要在前端另写一份。
 */
export function featuredEntries(content: PublicContent, block: MiniappLayoutBlock, kind: 'agent' | 'workflow', category?: string) {
  const limit = Math.max(1, Math.min(24, Number(block.limit) || 6));
  const recommended = recommendedEntries(content);
  let items = block.dataSource === 'all' || !recommended.length
    ? (kind === 'agent' ? content.agents : content.workflows).map(item => ({ item, kind }))
    : recommended;
  if (kind === 'workflow') items = items.filter(entry => entry.kind === 'workflow');
  if (category) items = items.filter(entry => entry.item.category === category);
  return items.slice(0, limit);
}

function SectionTitle({ title, more, onMore, headingClass }: { title: string; more?: string; onMore?: () => void; headingClass?: string }) {
  return <View className='section-title mini-section-title'>
    <Text className={headingClass || 'mini-block-heading'}>{title}</Text>
    {onMore && more && <Text className='mini-section-more' onClick={onMore}>{more}</Text>}
  </View>;
}

function SearchBlock({ block, className, style }: { block: MiniappLayoutBlock; className: string; style: Record<string, string | undefined> }) {
  const [keyword, setKeyword] = useState('');
  // 搜索块的点击目标可配：配了跳配的，没配就保持原行为（进全局搜索页）
  const submit = () => {
    if (resolveLink(block.link)) navigateLink(block.link);
    else gotoGlobalSearch(keyword);
  };
  return <SearchBar
    className={`${className} mini-searchbar-block`}
    style={style}
    value={keyword}
    onInput={setKeyword}
    onTapIcon={submit}
    onSubmit={submit}
    onClear={() => setKeyword('')}
    placeholder={block.searchPlaceholder || '输入关键词搜索智能体和工作流'}
  />;
}

/** 首页公告通知栏：左侧固定铃铛（有未读显示红点）+ 右侧跑马灯，点击默认进公告列表二级页 */
function AnnouncementBar({ announcements, onTap }: { announcements: Announcement[]; onTap: () => void }) {
  const [seen, setSeen] = useState(() => getAnnouncementSeen());
  // 列表页标记已读后会广播事件，首页监听后刷新红点状态（返回首页时红点消失）
  useEffect(() => {
    const refresh = () => setSeen(getAnnouncementSeen());
    Taro.eventCenter.on(ANN_SEEN_EVENT, refresh);
    return () => { Taro.eventCenter.off(ANN_SEEN_EVENT, refresh); };
  }, []);
  const latest = sortAnnouncements(announcements)[0];
  if (!latest) return null;
  const newest = announcementTime(latest);
  const hasUnread = !!newest && newest > seen;
  const marqueeText = String(latest.title || latest.content || '');
  return (
    <View className='mini-announce-bar' onClick={onTap}>
      <View className='mini-announce-bell'>
        <View className='ui-icon-bell mini-announce-bell-icon' />
        {hasUnread && <View className='mini-announce-dot' />}
      </View>
      <View className='mini-announce-marquee'>
        {/* 两段相同文字 + translateX(-50%) 实现无缝跑马灯 */}
        <Text className='mini-announce-marquee-inner'>{marqueeText}{marqueeText ? '\u3000\u3000' : ''}{marqueeText}</Text>
      </View>
    </View>
  );
}

export function LayoutBlocks({ layout, content, category = '', type = '' }: { layout: MiniappLayout; content: PublicContent; category?: string; type?: string }) {
  return <>{layout.blocks.filter(block => block.visible !== false).map(block => {
    const style = blockStyle(block);
    const heading = block.title || titles[block.type];
    const className = `layout-block layout-block-${block.type} ${layout.page === 'home' ? 'layout-block-home' : ''}`;
    if (block.type === 'spacer') return <View key={block.id} style={{ height: `${Math.max(0, Number(block.spacing) || 24)}px` }} />;
    if (block.type === 'carousel') {
      const configuredSlides = (block.slides || []).filter((slide) => slide.image);
      const slides = configuredSlides.length ? configuredSlides : content.banners.map((banner) => ({
        image: String(banner.image || banner.imageUrl || block.image || ''),
        title: String(banner.title || ''),
        subtitle: String(banner.subtitle || ''),
        link: (banner.link || banner.linkUrl || block.link || '') as string,
      })).filter((slide) => slide.image);
      if (!slides.length) return null;
      return <View key={block.id} className={className} style={style}>
        <Swiper className='layout-swiper mini-hero-swiper' autoplay circular indicatorDots indicatorColor='rgba(255,255,255,.45)' indicatorActiveColor='#ffffff'>
          {slides.slice(0, block.limit || 8).map((slide, index) => <SwiperItem key={`${slide.image}-${index}`} onClick={() => navigateLink(slide.link || block.link)}>
            <ResilientImage className='layout-banner mini-hero-image' src={slide.image} width={1200} height={675} lazyLoad={index > 0} />
          </SwiperItem>)}
        </Swiper>
      </View>;
    }
    if (block.type === 'announcements') {
      if (!content.announcements?.length) return null;
      return <View key={block.id} className={`section ${className}`} style={style}>
        <AnnouncementBar announcements={content.announcements} onTap={() => navigateLink(block.link || '/pages/announcements/index')} />
      </View>;
    }
    if (block.type === 'search') return <SearchBlock key={block.id} block={block} className={className} style={style} />;
    if (block.type === 'categories') return <View key={block.id} className={`section ${className}`} style={style}>
      <SectionTitle
        title={heading}
        more={moreLabel(block)}
        onMore={() => navigateLink(block.link || `/pages/category/index?title=${encodeURIComponent('全部分类')}`)}
      />
      <View className='mini-category-nav'>{content.categories.filter((item) => !isAllCategory(item)).slice(0, block.limit || 12).map((item) => {
        const title = item.label || item.name || '分类';
        // 优先级：后台给这张卡单独配的跳转 → 分类自带的 miniappLink → 默认进该分类列表页
        const destination = block.categoryLinks?.[categoryRef(item)]
          || item.miniappLink
          || `/pages/category/index?category=${encodeURIComponent(item.key || item.id)}&title=${encodeURIComponent(title)}`;
        const image = block.categoryImages?.[categoryRef(item)] || item.miniappImage || '';
        return <View className='mini-category-item' key={item.id} onClick={() => navigateLink(destination)}>
          {image
            ? <ResilientImage className='mini-category-picture' src={image} width={640} height={480} lazyLoad />
            : <View className='mini-category-fallback' style={{ backgroundColor: item.color || undefined }} />}
          <View className='mini-category-cover'><Text className='mini-category-label'>{title}</Text></View>
        </View>;
      })}</View>
    </View>;
    if (block.type === 'featured-agents') {
      if (type === 'workflow') return null;
      const items = featuredEntries(content, block, 'agent', category);
      if (!items.length) return null;
      return <View key={block.id} className={`section ${className}`} style={style}>
        <SectionTitle title={heading} more={moreLabel(block)} onMore={() => navigateLink(block.link || '/pages/hot/index?type=agent')} />
        <View className='mini-content-list'>{items.map(entry => <ContentCard item={entry.item} type={entry.kind} variant='compact' key={entry.item.id} link={block.cardLinks?.[entry.item.id]} />)}</View>
      </View>;
    }
    if (block.type === 'featured-workflows') {
      if (type === 'agent') return null;
      const items = featuredEntries(content, block, 'workflow', category);
      if (!items.length) return null;
      return <View key={block.id} className={`section ${className}`} style={style}>
        <SectionTitle title={heading} more={moreLabel(block)} onMore={() => navigateLink(block.link || '/pages/hot/index?type=workflow')} />
        <View className='mini-content-list'>{items.map(entry => <ContentCard item={entry.item} type={entry.kind} variant='compact' key={entry.item.id} link={block.cardLinks?.[entry.item.id]} />)}</View>
      </View>;
    }
    return null;
  })}</>;
}
