import { useMemo } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';

export default function DetailPage() {
  const { pageStyle } = useThemePage();
  const { params } = useRouter();
  const state = useLoad(() => getPublicContent(), []);
  const item = useMemo(() => {
    const list = params.type === 'workflow' ? state.data?.workflows : state.data?.agents;
    return list?.find((entry) => entry.id === params.id);
  }, [state.data, params.id, params.type]);
  return <View className='page' style={pageStyle}>
    <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && !item} onRetry={state.reload} />
    {item && <>
      <Text className='page-title'>{item.name}</Text>
      <Text className='page-subtitle'>{params.type === 'workflow' ? 'AI 工作流' : 'AI 智能体'}</Text>
      <View className='card section'><Text className='card-desc'>{item.description || '暂无简介'}</Text><View className='tag-row'>{(item.tags || []).map((tag) => <Text className='tag' key={tag}>{tag}</Text>)}</View></View>
      {item.opening && <View className='card'><Text className='card-title'>使用说明</Text><Text className='card-desc'>{item.opening}</Text></View>}
      <Button className='primary-button' onClick={() => Taro.navigateTo({ url: params.type === 'workflow' ? `/pages/workflow/index?id=${encodeURIComponent(item.id)}` : `/pages/chat/index?id=${encodeURIComponent(item.id)}` })}>{params.type === 'workflow' ? '配置并运行' : '开始对话'}</Button>
      <Text className='muted'>运行记录、算力消耗和资产均与网站账号保持一致。</Text>
    </>}
  </View>;
}
