import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import type { ContentItem } from '../types';

export function ContentCard({ item, type }: { item: ContentItem; type: 'agent' | 'workflow' }) {
  return (
    <View className='card' onClick={() => Taro.navigateTo({ url: `/pages/detail/index?type=${type}&id=${encodeURIComponent(item.id)}` })}>
      <Text className='card-title'>{item.name}</Text>
      <Text className='card-desc'>{item.description || (type === 'agent' ? 'AI 智能体' : 'AI 工作流')}</Text>
      <View className='tag-row'>
        {(item.tags || []).slice(0, 3).map((tag) => <Text className='tag' key={tag}>{tag}</Text>)}
      </View>
    </View>
  );
}
