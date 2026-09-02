import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { View } from '@tarojs/components';
import { LayoutBlocks } from '../../components/layout-blocks';
import { PageState } from '../../components/page-state';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { useLoad } from '../../hooks/use-load';
import { getMiniappLayout, getPublicContent } from '../../services/api';

export default function HomePage() {
  const state = useLoad(async () => {
    const [content, layout] = await Promise.all([getPublicContent(), getMiniappLayout('home')]);
    return { content, layout };
  }, []);

  usePullDownRefresh(async () => {
    try {
      await Promise.all([getPublicContent(true), getMiniappLayout('home', true)]);
      await state.reload();
    } finally {
      Taro.stopPullDownRefresh();
    }
  });

  return <View className='page mini-home-page'>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <LayoutBlocks layout={state.data.layout} content={state.data.content} />}
    <MiniappTabBar active='home' />
  </View>;
}
