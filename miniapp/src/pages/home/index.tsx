import { View } from '@tarojs/components';
import { LayoutBlocks } from '../../components/layout-blocks';
import { PageState } from '../../components/page-state';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { useLoad } from '../../hooks/use-load';
import { getMiniappLayout, getPublicContent } from '../../services/api';
import type { PublicContent } from '../../types';

function normalizeContent(content: PublicContent): PublicContent {
  return {
    ...content,
    agents: Array.isArray(content?.agents) ? content.agents : [],
    workflows: Array.isArray(content?.workflows) ? content.workflows : [],
    categories: Array.isArray(content?.categories) ? content.categories : [],
    categoryGroups: Array.isArray(content?.categoryGroups) ? content.categoryGroups : [],
    banners: Array.isArray(content?.banners) ? content.banners : [],
    announcements: Array.isArray(content?.announcements) ? content.announcements : [],
    recommended: Array.isArray(content?.recommended) ? content.recommended : [],
  };
}

export default function HomePage() {
  const state = useLoad(async () => {
    const [content, layout] = await Promise.all([getPublicContent(), getMiniappLayout('home', true)]);
    return { content: normalizeContent(content), layout };
  }, []);

  return <View className='page mini-home-page'>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <LayoutBlocks layout={state.data.layout} content={state.data.content} />}
    <MiniappTabBar active='home' />
  </View>;
}
