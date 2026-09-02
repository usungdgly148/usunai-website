import Taro, { useRouter } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { Input, Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState(String(router.params.q || ''));
  const state = useLoad(() => getPublicContent(), []);
  const entries = useMemo(() => {
    if (!state.data || !query.trim()) return [];
    const normalized = query.trim().toLowerCase();
    return [
      ...state.data.agents.map((item) => ({ item, type: 'agent' as const })),
      ...state.data.workflows.map((item) => ({ item, type: 'workflow' as const })),
    ].filter(({ item }) => `${item.name} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(normalized));
  }, [state.data, query]);

  return <View className='page'>
    <Text className='page-title'>全局搜索</Text>
    <View className='search-box'>
      <Input
        className='search-input'
        value={query}
        autoFocus
        confirmType='search'
        placeholder='输入关键词搜索智能体和工作流...'
        onInput={(event) => setQuery(event.detail.value)}
        onConfirm={() => Taro.hideKeyboard()}
      />
    </View>
    <PageState loading={state.loading} error={state.error} empty={!!query && !state.loading && !state.error && entries.length === 0} onRetry={state.reload} />
    <View className='section'>{entries.map(({ item, type }) => <ContentCard item={item} type={type} key={`${type}-${item.id}`} />)}</View>
  </View>;
}
