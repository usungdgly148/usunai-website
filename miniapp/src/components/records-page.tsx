import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { usePagedRecords } from '../hooks/use-paged-records';
import { PageState } from './page-state';
import { RecordList } from './record-list';

export function RecordsPage({ title, subtitle, path, kind }: {
  title: string;
  subtitle: string;
  path: 'assets' | 'compute-records' | 'orders';
  kind: 'compute' | 'asset' | 'order';
}) {
  const state = usePagedRecords(path);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });
  return <View className='page'>
    <Text className='page-title'>{title}</Text>
    <Text className='page-subtitle'>{subtitle}</Text>
    <View className='section'>
      <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.items.length === 0} onRetry={state.reload} />
      {!state.loading && <RecordList items={state.items} kind={kind} />}
      {state.hasMore && <View className='load-more' onClick={state.loadMore}>{state.loadingMore ? '正在加载…' : '加载更多'}</View>}
    </View>
  </View>;
}
