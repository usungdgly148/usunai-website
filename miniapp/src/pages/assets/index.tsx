import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { RecordList } from '../../components/record-list';
import { usePagedRecords } from '../../hooks/use-paged-records';

const tabs = ['任务', '文案', '图片', '视频', '音频', '图文'];

export default function AssetsPage() {
  const state = usePagedRecords('assets');
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });
  return <View className='page mini-assets-page'>
    <View className='mini-page-topbar'><Text className='mini-page-heading'>我的资产</Text><Text className='mini-page-caption'>保存每一次值得复用的创作结果</Text></View>
    <ScrollView className='mini-asset-tabs' scrollX enableFlex><View className='mini-asset-tab-row'>{tabs.map((label, index) => <Text className={`mini-asset-tab ${index === 0 ? 'mini-asset-tab-active' : ''}`} key={label}>{label}</Text>)}</View></ScrollView>
    <View className='mini-asset-panel'>
      <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && state.items.length === 0} onRetry={state.reload} />
      {!state.loading && <RecordList items={state.items} kind='asset' />}
      {state.hasMore && <View className='load-more' onClick={state.loadMore}>{state.loadingMore ? '正在加载…' : '加载更多'}</View>}
    </View>
    <MiniappTabBar active='assets' />
  </View>;
}
