import { useMemo } from 'react';
import { useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

export default function CategoryPage() {
  const { params } = useRouter();
  const state = useLoad(() => getPublicContent(), []);
  const entries = useMemo(() => {
    if (!state.data) return [];
    const type = params.type;
    const category = params.category;
    const all = [
      ...(type !== 'workflow' ? state.data.agents.map((item) => ({ item, type: 'agent' as const })) : []),
      ...(type !== 'agent' ? state.data.workflows.map((item) => ({ item, type: 'workflow' as const })) : []),
    ];
    return category ? all.filter(({ item }) => item.category === category) : all;
  }, [state.data, params.type, params.category]);
  return <View className='page'>
    <Text className='page-title'>{decodeURIComponent(params.title || '全部应用')}</Text>
    <Text className='page-subtitle'>当前上架的智能体和工作流</Text>
    <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && entries.length === 0} onRetry={state.reload} />
    <View className='section'>{entries.map(({ item, type }) => <ContentCard item={item} type={type} key={`${type}-${item.id}`} />)}</View>
  </View>;
}
