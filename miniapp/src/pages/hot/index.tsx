import Taro, { usePullDownRefresh, useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { recommendedEntries } from '../../components/layout-blocks';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';
import { shareTargets } from '../../utils/share';

/**
 * 热门推荐二级页：展示后台 recommended 全部推荐（智能体 + 工作流混排，
 * 顺序与网页版首页「热门智能体」区块完全一致）。首页热门区「更多>>」进入。
 */
export default function HotPage() {
  const { pageStyle } = useThemePage();
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets();
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);
  const { params } = useRouter();
  // type=workflow 入口只展示推荐中的工作流（预留 featured-workflows 区块）；默认全部混排
  const type = params.type === 'workflow' ? 'workflow' : 'all';
  const [keyword, setKeyword] = useState('');
  const state = useLoad(getPublicContent, []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: type === 'workflow' ? '热门工作流' : '热门智能体' });
  }, [type]);

  const entries = useMemo(() => {
    const recommended = recommendedEntries(state.data || ({} as never));
    const filteredList = type === 'workflow' ? recommended.filter(entry => entry.kind === 'workflow') : recommended;
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return filteredList;
    return filteredList.filter(({ item }) => [
      item.name, item.description || '', item.desc || '', (item.tags || []).join(' '),
    ].join(' ').toLowerCase().includes(normalized));
  }, [state.data, type, keyword]);

  const heading = type === 'workflow' ? '热门工作流' : '热门智能体';
  const subtitle = type === 'workflow'
    ? `推荐的工作流 · 共 ${entries.length} 个`
    : `后台推荐的智能体与工作流 · 共 ${entries.length} 个`;

  return <View className='page mini-home-page mini-hot-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>{heading}</Text>
      <Text className='mini-page-caption'>{subtitle}</Text>
    </View>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && (
      entries.length
        ? <View className='mini-content-list'>{entries.map(entry => (
          <ContentCard item={entry.item} type={entry.kind} variant='compact' key={entry.item.id} />
        ))}</View>
        : <View className='mini-hot-empty'><Text>还没有上架内容，请稍后再来～</Text></View>
    )}
  </View>;
}
