import Taro from '@tarojs/taro';
import { Image, Input, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import { ContentCard } from './content-card';
import type { ContentItem, MiniappLayout, MiniappLayoutBlock, PublicContent } from '../types';

const titles: Record<MiniappLayoutBlock['type'], string> = {
  carousel: '精选推荐', announcements: '公告', search: '搜索', categories: '场景分类',
  'featured-agents': '推荐智能体', 'featured-workflows': '推荐工作流', 'quick-links': '快捷入口', spacer: '',
};

function blockStyle(block: MiniappLayoutBlock) {
  return {
    marginBottom: `${Math.max(0, Number(block.spacing) || 0)}px`,
    backgroundColor: block.backgroundColor || undefined,
    color: block.textColor || undefined,
  };
}

function internalNavigate(url: string) {
  if (url.startsWith('/pages/')) void Taro.navigateTo({ url });
  else if (/^https:\/\//i.test(url)) void Taro.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
}

function recommendedIds(content: PublicContent) { return new Set(content.recommended || []); }
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

export function LayoutBlocks({ layout, content, category = '', type = '' }: { layout: MiniappLayout; content: PublicContent; category?: string; type?: string }) {
  return <>{layout.blocks.filter(block => block.visible !== false).map(block => {
    const style = blockStyle(block);
    const heading = block.title || titles[block.type];
    if (block.type === 'spacer') return <View key={block.id} style={{ height: `${Math.max(0, Number(block.spacing) || 24)}px` }} />;
    if (block.type === 'carousel') {
      if (!content.banners.length) return null;
      return <View key={block.id} className='layout-block' style={style}><Swiper className='layout-swiper' autoplay circular indicatorDots>{content.banners.slice(0, block.limit || 8).map((banner, index) => <SwiperItem key={String(banner.id || index)} onClick={() => internalNavigate(String(banner.link || banner.linkUrl || block.link || ''))}><Image className='layout-banner' mode='aspectFill' src={String(banner.image || banner.imageUrl || block.image || '')} /><Text className='layout-banner-title'>{String(banner.title || '')}</Text></SwiperItem>)}</Swiper></View>;
    }
    if (block.type === 'announcements') {
      if (!content.announcements.length) return null;
      return <View key={block.id} className='section layout-block' style={style}><View className='section-title'><Text>{heading}</Text></View>{content.announcements.slice(0, block.limit || 3).map((item, index) => <View className='announcement-row' key={String(item.id || index)}><Text>{String(item.title || item.content || '')}</Text></View>)}</View>;
    }
    if (block.type === 'search') return <View key={block.id} className='layout-block' style={style} onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}><View className='search-box'><Input className='search-input' disabled placeholder={heading || '搜索智能体或工作流'} /></View></View>;
    if (block.type === 'categories') return <View key={block.id} className='section layout-block' style={style}><View className='section-title'><Text>{heading}</Text><Text className='muted'>{content.categories.length} 个</Text></View><View className='chip-row'>{content.categories.slice(0, block.limit || 12).map(item => <Text className='chip' key={item.id} onClick={() => Taro.navigateTo({ url: `/pages/category/index?category=${encodeURIComponent(item.key || item.id)}&title=${encodeURIComponent(item.label || item.name || '分类')}` })}>{item.label || item.name}</Text>)}</View></View>;
    if (block.type === 'featured-agents') {
      if (type === 'workflow') return null;
      const items = filtered(content.agents, block, content, category);
      if (!items.length) return null;
      return <View key={block.id} className='section layout-block' style={style}><View className='section-title'><Text>{heading}</Text><Text className='muted'>{items.length} 个</Text></View>{items.map(item => <ContentCard item={item} type='agent' key={item.id} />)}</View>;
    }
    if (block.type === 'featured-workflows') {
      if (type === 'agent') return null;
      const items = filtered(content.workflows, block, content, category);
      if (!items.length) return null;
      return <View key={block.id} className='section layout-block' style={style}><View className='section-title'><Text>{heading}</Text><Text className='muted'>{items.length} 个</Text></View>{items.map(item => <ContentCard item={item} type='workflow' key={item.id} />)}</View>;
    }
    if (block.type === 'quick-links') return <View key={block.id} className='section layout-block' style={style}><View className='section-title'><Text>{heading}</Text></View><View className='nav-grid'><View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/category/index?type=agent&title=AI智能体' })}>AI 智能体</View><View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/category/index?type=workflow&title=AI工作流' })}>AI 工作流</View><View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}>个人中心</View><View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/compute/index' })}>算力记录</View></View></View>;
    return null;
  })}</>;
}
