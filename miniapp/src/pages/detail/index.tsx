import { useMemo } from 'react';
import { useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

export default function DetailPage() {
  const { params } = useRouter();
  const state = useLoad(() => getPublicContent(), []);
  const item = useMemo(() => {
    const list = params.type === 'workflow' ? state.data?.workflows : state.data?.agents;
    return list?.find((entry) => entry.id === params.id);
  }, [state.data, params.id, params.type]);
  return <View className='page'>
    <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && !item} onRetry={state.reload} />
    {item && <>
      <Text className='page-title'>{item.name}</Text>
      <Text className='page-subtitle'>{params.type === 'workflow' ? 'AI 工作流' : 'AI 智能体'}</Text>
      <View className='card section'><Text className='card-desc'>{item.description || '暂无简介'}</Text><View className='tag-row'>{(item.tags || []).map((tag) => <Text className='tag' key={tag}>{tag}</Text>)}</View></View>
      {item.opening && <View className='card'><Text className='card-title'>使用说明</Text><Text className='card-desc'>{item.opening}</Text></View>}
      <Button className='primary-button' disabled>运行功能将在下一阶段开放</Button>
      <Text className='muted'>本阶段先完成内容浏览和账号数据一致性，AI 对话与工作流运行将在阶段四接入现有服务端扣费与任务体系。</Text>
    </>}
  </View>;
}
