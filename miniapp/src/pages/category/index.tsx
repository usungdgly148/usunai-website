import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import type { ContentItem } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

function matchesCategory(item: ContentItem, category: string) {
  if (!category || category.toLowerCase() === 'all') return true;
  return String(item.category || '') === category;
}

export default function CategoryPage() {
  const { pageStyle } = useThemePage();
  const { params } = useRouter();
  const title = decodeURIComponent(params.title || '分类工具');
  const category = params.category || '';
  const type = params.type || '';
  const state = useLoad(getPublicContent, []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });
  const agents = (state.data?.agents || []).filter((item) => matchesCategory(item, category));
  const workflows = (state.data?.workflows || []).filter((item) => matchesCategory(item, category));
  const showAgents = type !== 'workflow';
  const showWorkflows = type !== 'agent';
  const total = (showAgents ? agents.length : 0) + (showWorkflows ? workflows.length : 0);

  return <View className='page mini-home-page mini-category-page' style={pageStyle}>
    <View className='mini-page-topbar'><Text className='mini-page-heading'>{title}</Text><Text className='mini-page-caption'>共 {total} 个工具</Text></View>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <View className='mini-category-tools'>
      {showAgents && agents.length > 0 && <View className='mini-category-tool-section'>
        <Text className='section-title'>智能体</Text>
        <View className='mini-content-grid'>{agents.map((item) => <ContentCard key={`agent-${item.id}`} item={item} type='agent' />)}</View>
      </View>}
      {showWorkflows && workflows.length > 0 && <View className='mini-category-tool-section'>
        <Text className='section-title'>工作流</Text>
        <View className='mini-content-grid'>{workflows.map((item) => <ContentCard key={`workflow-${item.id}`} item={item} type='workflow' />)}</View>
      </View>}
      {total === 0 && <View className='mini-category-empty'><Text>该分类暂时还没有可用工具</Text></View>}
    </View>}
    <MiniappTabBar active={type === 'workflow' ? 'workflows' : 'agents'} />
  </View>;
}
