import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import type { ContentItem } from '../types';

export function ContentCard({ item, type }: { item: ContentItem; type: 'agent' | 'workflow' }) {
  const tags = (item.tags || []).filter(Boolean).slice(0, 2);
  const fallback = type === 'agent' ? 'AI' : '流';
  const description = item.description || (type === 'agent'
    ? 'AI 智能助手，为你完成创作与获客任务'
    : '一键运行工作流，快速完成内容生产');
  const operationPath = type === 'agent' ? '/pages/chat/index' : '/pages/workflow/index';

  return <View
    className='card mini-content-card'
    onClick={() => Taro.navigateTo({ url: `${operationPath}?id=${encodeURIComponent(item.id)}` })}
  >
    <View className='mini-content-card-cover'>
      <Text className='mini-content-card-kind'>{type === 'agent' ? '智能体' : '工作流'}</Text>
      {item.avatar
        ? <Image className='mini-content-card-avatar' mode='aspectFill' src={item.avatar} />
        : <Text className='mini-content-card-fallback'>{fallback}</Text>}
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
