import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { SearchBar, gotoGlobalSearch } from '../../components/search-bar';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import type { ContentItem } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

function matchesCategory(item: ContentItem, category: string) {
  if (!category || category.toLowerCase() === 'all') return true;
  return String(item.category || '') === category;
}

function matchesKeyword(item: ContentItem, normalized: string) {
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

export default function CategoryPage() {
  const { pageStyle } = useThemePage();
  const { params } = useRouter();
  const title = decodeURIComponent(params.title || '分类工具');
  const category = params.category || '';
  const type = params.type || '';
  const [keyword, setKeyword] = useState('');
  const state = useLoad(getPublicContent, []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  const normalized = keyword.trim().toLowerCase();
  const showAgents = type !== 'workflow';
  const showWorkflows = type !== 'agent';

  const { agents, workflows } = useMemo(() => {
    const allAgents = (state.data?.agents || []).filter((item) => matchesCategory(item, category));
    const allWorkflows = (state.data?.workflows || []).filter((item) => matchesCategory(item, category));
    return {
      agents: allAgents.filter((item) => matchesKeyword(item, normalized)),
      workflows: allWorkflows.filter((item) => matchesKeyword(item, normalized)),
    };
  }, [state.data, category, normalized]);

  const totalAll = (showAgents ? (state.data?.agents || []).filter((i) => matchesCategory(i, category)).length : 0)
    + (showWorkflows ? (state.data?.workflows || []).filter((i) => matchesCategory(i, category)).length : 0);
  const totalShown = (showAgents ? agents.length : 0) + (showWorkflows ? workflows.length : 0);
  const hasKeyword = normalized.length > 0;
  const filteredEmpty = hasKeyword && !state.loading && !state.error && totalShown === 0 && state.data;

  return (
    <View className='page mini-home-page mini-category-page' style={pageStyle}>
      <View className='mini-page-topbar'>
        <Text className='mini-page-heading'>{title}</Text>
        <Text className='mini-page-caption'>
          {hasKeyword ? `匹配 ${totalShown} / ${totalAll} 个工具` : `共 ${totalAll} 个工具`}
        </Text>
      </View>
      <SearchBar
        className='mini-category-search'
        value={keyword}
        onInput={setKeyword}
        onSubmit={() => gotoGlobalSearch(keyword)}
        onTapIcon={() => gotoGlobalSearch(keyword)}
        onClear={() => setKeyword('')}
        placeholder='在本分类中搜索 / 点搜索全站查找'
      />
      <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
      {state.data && (
        <View className='mini-category-tools'>
          {showAgents && agents.length > 0 && (
            <View className='mini-category-tool-section'>
              <Text className='section-title'>智能体</Text>
              <View className='mini-content-grid'>
                {agents.map((item) => <ContentCard key={`agent-${item.id}`} item={item} type='agent' />)}
              </View>
            </View>
          )}
          {showWorkflows && workflows.length > 0 && (
            <View className='mini-category-tool-section'>
              <Text className='section-title'>工作流</Text>
              <View className='mini-content-grid'>
                {workflows.map((item) => <ContentCard key={`workflow-${item.id}`} item={item} type='workflow' />)}
              </View>
            </View>
          )}
          {filteredEmpty && (
            <View className='mini-category-filtered-empty'>
              <Text>本分类下没有匹配「{keyword.trim()}」的工具，点输入框右侧放大镜可全站搜索</Text>
            </View>
          )}
          {!hasKeyword && totalShown === 0 && (
            <View className='mini-category-empty'>
              <Text>该分类暂时还没有可用工具</Text>
            </View>
          )}
        </View>
      )}
      <MiniappTabBar active={type === 'workflow' ? 'workflows' : 'agents'} />
    </View>
  );
}
