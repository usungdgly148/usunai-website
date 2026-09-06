import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { LayoutBlocks } from '../../components/layout-blocks';
import { PageState } from '../../components/page-state';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { useLoad } from '../../hooks/use-load';
import { getMiniappLayout, getPublicContent } from '../../services/api';
import type { PublicContent } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

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

// 内容接口在审核/网络异常时的兜底：保证首页骨架（搜索/分类/快捷入口）始终可渲染，
// 避免出现"内容加载失败 → 整页空白 → 审核拒绝"的死循环。
const EMPTY_CONTENT: PublicContent = {
  agents: [],
  workflows: [],
  categories: [],
  categoryGroups: [],
  banners: [],
  announcements: [],
  recommended: [],
};

export default function HomePage() {
  const { pageStyle } = useThemePage();
  const state = useLoad(async () => {
    // 布局接口有 DEFAULT_LAYOUTS 兜底，正常不会失败。
    const layout = await getMiniappLayout('home', true);
    // 内容接口失败时降级为空数据，让页面骨架仍可渲染。
    let content: PublicContent = EMPTY_CONTENT;
    let contentError = '';
    try {
      content = normalizeContent(await getPublicContent());
    } catch (reason) {
      contentError = reason instanceof Error ? reason.message : '内容加载失败，请稍后重试';
    }
    return { layout, content, contentError };
  }, []);

  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  return <View className='page mini-home-page' style={pageStyle}>
    <PageState loading={state.loading} />
    {state.data && <LayoutBlocks layout={state.data.layout} content={state.data.content} />}
    {/* 内容加载失败时显示轻量提示，不遮挡页面骨架 */}
    {state.data?.contentError && (
      <View className='mini-home-error-tip'>
        <Text className='mini-home-error-tip-text'>{state.data.contentError}</Text>
      </View>
    )}
    <MiniappTabBar active='home' />
  </View>;
}
