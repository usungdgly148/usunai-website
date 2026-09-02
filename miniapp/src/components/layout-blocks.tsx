import Taro from '@tarojs/taro';
import { Image, Input, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { ContentCard } from './content-card';
import type { ContentItem, MiniappLayout, MiniappLayoutBlock, PublicContent } from '../types';

const titles: Record<MiniappLayoutBlock['type'], string> = {
  carousel: '精选推荐',
  announcements: '公告通知',
  search: '搜索工具',
  categories: '快捷分类',
  'featured-agents': '热门智能体',
  'featured-workflows': '热门工作流',
  'quick-links': '快捷入口',
  spacer: '',
};

function blockStyle(block: MiniappLayoutBlock) {
  return {
    marginBottom: `${Math.max(0, Number(block.spacing) || 0)}px`,
    backgroundColor: block.backgroundColor || undefined,
    color: block.textColor || undefined,
  };
}

function internalNavigate(url: string) {
  if (!url) return;
  if (url.startsWith('/pages/')) void Taro.navigateTo({ url });
  else if (/^https:\/\//i.test(url)) void Taro.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
}

function recommendedIds(content: PublicContent) {
  return new Set(content.recommended || []);
}

function categoryRef(item: { id: string; key?: string }) {
  return String(item.key || item.id || '');
}

function isAllCategory(item: { id: string; key?: string; name?: string; label?: string }) {
  const key = categoryRef(item).toLowerCase();
  const name = String(item.label || item.name || '').trim();
  return key === 'all' || name === '全部';
}

function filtered(items: ContentItem[], block: MiniappLayoutBlock, content: PublicContent, category?: string) {
  let result = items;
  if (block.dataSource === 'recommended') {
    const ids = recommendedIds(content);
    const recommended = result.filter(item => ids.has(item.id));
    if (recommended.length) result = recommended;
  }
  if ((block.dataSource === 'current-category' || category) && category) result = result.filter(item => item.category === category);
  return result.slice(0, Math.max(1, Math.min(24, Number(block.limit) || 8)));
}

function SectionTitle({ title, count, onMore }: { title: string; count?: number; onMore?: () => void }) {
  return <View className='section-title mini-section-title'>
    <View><Text className='mini-section-eyebrow'>友尚 AI</Text><Text className='mini-section-heading'>{title}</Text></View>
    {typeof count === 'number' && <Text className='mini-section-more' onClick={onMore}>{count} 个应用 →</Text>}
  </View>;
}

function SearchBlock({ block, className, style }: { block: MiniappLayoutBlock; className: string; style: Record<string, string | undefined> }) {
  const [keyword, setKeyword] = useState('');
  const openSearch = () => {
    const query = keyword.trim();
    void Taro.navigateTo({ url: `/pages/search/index${query ? `?q=${encodeURIComponent(query)}` : ''}` });
  };

  return <View className={`${className} mini-search-wrap`} style={style}>
    <View className='search-box mini-search-box'>
      <Text className='mini-search-icon' onClick={openSearch}>⌕</Text>
      <Input
        className='search-input'
        value={keyword}
        placeholder='输入关键词搜索智能体和工作流...'
        confirmType='search'
        onInput={event => setKeyword(event.detail.value)}
        onConfirm={openSearch}
      />
    </View>
  </View>;
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
        link: String(banner.link || banner.linkUrl || block.link || ''),
      })).filter((slide) => slide.image);
      if (!slides.length) return null;
      return <View key={block.id} className={className} style={style}>
        <Swiper className='layout-swiper mini-hero-swiper' autoplay circular indicatorDots indicatorColor='rgba(255,255,255,.45)' indicatorActiveColor='#ffffff'>
          {slides.slice(0, block.limit || 8).map((slide, index) => <SwiperItem key={`${slide.image}-${index}`} onClick={() => internalNavigate(slide.link || block.link || '')}>
            <Image className='layout-banner mini-hero-image' mode='aspectFill' src={slide.image} />
            <View className='mini-hero-shade' />
            <View className='mini-hero-copy'>
              <Text className='mini-hero-kicker'>{slide.subtitle || '友尚 AI 智能获客'}</Text>
              <Text className='layout-banner-title'>{slide.title || '让每一个问题，都有合适的 AI 工具'}</Text>
            </View>
          </SwiperItem>)}
        </Swiper>
      </View>;
    }
    if (block.type === 'announcements') {
      const latest = content.announcements[0];
      if (!latest) return null;
      return <View key={block.id} className={`section ${className} mini-announcement-card`} style={style} onClick={() => Taro.navigateTo({ url: '/pages/announcements/index' })}>
        <Text className='mini-announcement-badge'>📣 公告</Text>
        <View className='mini-announcement-marquee'><Text className='announcement-row'>{String(latest.title || latest.content || '')}</Text></View>
        <Text className='mini-announcement-arrow'>›</Text>
      </View>;
    }
    if (block.type === 'search') return <SearchBlock key={block.id} block={block} className={className} style={style} />;
    if (block.type === 'categories') return <View key={block.id} className={`section ${className}`} style={style}>
      <SectionTitle title={heading} count={content.categories.filter((item) => !isAllCategory(item)).length} />
      <View className='mini-category-nav'>{content.categories.filter((item) => !isAllCategory(item)).slice(0, block.limit || 12).map((item) => {
        const title = item.label || item.name || '分类';
        const destination = String(item.miniappLink || `/pages/category/index?category=${encodeURIComponent(item.key || item.id)}&title=${encodeURIComponent(title)}`);
        const image = block.categoryImages?.[categoryRef(item)] || item.miniappImage || '';
        return <View className='mini-category-item' key={item.id} onClick={() => internalNavigate(destination)}>
          {image
            ? <Image className='mini-category-picture' src={image} mode='aspectFill' />
            : <View className='mini-category-fallback' style={{ backgroundColor: item.color || undefined }} />}
          <View className='mini-category-cover'><Text className='mini-category-label'>{title}</Text><Text className='mini-category-go'>→</Text></View>
        </View>;
      })}</View>
    </View>;
    if (block.type === 'featured-agents') {
      if (type === 'workflow') return null;
      const items = filtered(content.agents, block, content, category);
      if (!items.length) return null;
      return <View key={block.id} className={`section ${className}`} style={style}>
        <SectionTitle title={heading} count={items.length} onMore={() => Taro.navigateTo({ url: '/pages/category/index?type=agent&title=AI智能体' })} />
        <View className='mini-content-grid'>{items.map(item => <ContentCard item={item} type='agent' key={item.id} />)}</View>
      </View>;
    }
    if (block.type === 'featured-workflows') {
      if (type === 'agent') return null;
      const items = filtered(content.workflows, block, content, category);
      if (!items.length) return null;
      return <View key={block.id} className={`section ${className}`} style={style}>
        <SectionTitle title={heading} count={items.length} onMore={() => Taro.navigateTo({ url: '/pages/category/index?type=workflow&title=AI工作流' })} />
        <View className='mini-content-grid'>{items.map(item => <ContentCard item={item} type='workflow' key={item.id} />)}</View>
      </View>;
    }
    // 底部导航已承担快捷入口职责，首页不重复展示旧的快捷入口区。
    if (block.type === 'quick-links') return null;
    return null;
  })}</>;
}
