import { useMemo, useState } from 'react';
import { Input, Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

export default function SearchPage() {
  const [query, setQuery] = useState('');
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
    <Text className='page-title'>搜索</Text>
    <View className='search-box'><Input className='search-input' value={query} autoFocus placeholder='输入名称、用途或标签' onInput={(event) => setQuery(event.detail.value)} /></View>
    <PageState loading={state.loading} error={state.error} empty={!!query && !state.loading && !state.error && entries.length === 0} onRetry={state.reload} />
    <View className='section'>{entries.map(({ item, type }) => <ContentCard item={item} type={type} key={`${type}-${item.id}`} />)}</View>
  </View>;
}
