import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { PageState } from '../../components/page-state';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { SearchBar } from '../../components/search-bar';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import type { ContentItem } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

function matchesQuery(item: ContentItem, normalized: string) {
  if (!normalized) return true;
  const haystack = [
    item.name,
    item.description || '',
    item.desc || '',
    item.category || '',
    (item.tags || []).join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(normalized);
}

export default function SearchPage() {
  const { pageStyle } = useThemePage();
  const router = useRouter();
  // Taro 4 的 useRouter 不会自动 decodeURL，所以小程序的 `?q=中文` 拿到的是 %E5%... 形式，
  // 这里防御性解析一次；非法编码时退回到原值。
  const initialQuery = (() => {
    const raw = String(router.params.q || '');
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  const [query, setQuery] = useState(initialQuery);
  const state = useLoad(() => getPublicContent(), []);

  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  const normalized = query.trim().toLowerCase();
  const hasQuery = normalized.length > 0;

  const { matchedAgents, matchedWorkflows } = useMemo(() => {
    if (!state.data) return { matchedAgents: [], matchedWorkflows: [] };
    return {
      matchedAgents: state.data.agents.filter((item) => matchesQuery(item, normalized)),
      matchedWorkflows: state.data.workflows.filter((item) => matchesQuery(item, normalized)),
    };
  }, [state.data, normalized]);

  const total = matchedAgents.length + matchedWorkflows.length;
  const showResults = state.data && (hasQuery ? true : true);

  return (
    <View className='page mini-search-page' style={pageStyle}>
      <View className='mini-page-topbar'>
        <Text className='mini-page-heading'>全局搜索</Text>
        <Text className='mini-page-caption'>
          {hasQuery ? `共匹配 ${total} 个工具` : '搜索智能体和工作流'}
        </Text>
      </View>
      <SearchBar
        className='mini-search-page-bar'
        value={query}
        onInput={setQuery}
        autoFocus={!hasQuery}
        placeholder='输入关键词搜索智能体和工作流'
      />
      <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
      {showResults && hasQuery && (
        <View className='mini-search-results'>
          {matchedAgents.length > 0 && (
            <View className='mini-search-group'>
              <View className='mini-search-group-head'>
                <Text className='mini-search-group-title'>智能体</Text>
                <Text className='mini-search-group-count'>{matchedAgents.length} 个</Text>
              </View>
              <View className='mini-content-grid'>
                {matchedAgents.map((item) => (
                  <ContentCard key={`agent-${item.id}`} item={item} type='agent' />
                ))}
              </View>
            </View>
          )}
          {matchedWorkflows.length > 0 && (
            <View className='mini-search-group'>
              <View className='mini-search-group-head'>
                <Text className='mini-search-group-title'>工作流</Text>
                <Text className='mini-search-group-count'>{matchedWorkflows.length} 个</Text>
              </View>
              <View className='mini-content-grid'>
                {matchedWorkflows.map((item) => (
                  <ContentCard key={`workflow-${item.id}`} item={item} type='workflow' />
                ))}
              </View>
            </View>
          )}
          {total === 0 && (
            <View className='mini-search-empty'>
              <Text className='mini-search-empty-icon'>🔍</Text>
              <Text className='mini-search-empty-title'>没有匹配「{query.trim()}」的工具</Text>
              <Text className='mini-search-empty-hint'>试试用「小红书」「文案」「获客」等更短的关键词</Text>
            </View>
          )}
        </View>
      )}
      {showResults && !hasQuery && state.data && (
        <View className='mini-search-tip'>
          <Text className='mini-search-tip-text'>输入关键词开始全站搜索</Text>
        </View>
      )}
      <MiniappTabBar active='home' />
    </View>
  );
}
