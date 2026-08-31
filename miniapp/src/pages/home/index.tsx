import { useMemo } from 'react';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Input, Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

export default function HomePage() {
  const state = useLoad(() => getPublicContent(), []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });
  const featured = useMemo(() => {
    if (!state.data) return [];
    const all = [...state.data.agents.map((item) => ({ item, type: 'agent' as const })), ...state.data.workflows.map((item) => ({ item, type: 'workflow' as const }))];
    const ordered = state.data.recommended.map((id) => all.find((entry) => entry.item.id === id)).filter(Boolean) as typeof all;
    return (ordered.length ? ordered : all).slice(0, 8);
  }, [state.data]);
  return <View className='page'>
    <Text className='page-title'>友尚AI</Text>
    <Text className='page-subtitle'>让每一个问题，都能找到合适的 AI 工具。</Text>
    <View className='search-box' onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}>
      <Input className='search-input' disabled placeholder='搜索智能体或工作流' />
    </View>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <>
      <View className='section'>
        <View className='section-title'><Text>场景分类</Text><Text className='muted'>{state.data.categories.length} 个</Text></View>
        <View className='chip-row'>{state.data.categories.map((category) => <Text className='chip' key={category.id} onClick={() => Taro.navigateTo({ url: `/pages/category/index?category=${encodeURIComponent(category.key || category.id)}&title=${encodeURIComponent(category.label || category.name || '分类')}` })}>{category.label || category.name}</Text>)}</View>
      </View>
      <View className='section'>
        <View className='section-title'><Text>热门推荐</Text><Text className='muted'>{featured.length} 个</Text></View>
        {featured.map(({ item, type }) => <ContentCard item={item} type={type} key={`${type}-${item.id}`} />)}
      </View>
      <View className='section'>
        <View className='section-title'><Text>快捷入口</Text></View>
        <View className='nav-grid'>
          <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/category/index?type=agent&title=AI智能体' })}>AI 智能体</View>
          <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/category/index?type=workflow&title=AI工作流' })}>AI 工作流</View>
          <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}>个人中心</View>
          <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/compute/index' })}>算力记录</View>
        </View>
      </View>
    </>}
  </View>;
}
