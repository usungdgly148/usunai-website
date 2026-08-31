import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { LayoutBlocks } from '../../components/layout-blocks';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getMiniappLayout, getPublicContent } from '../../services/api';

export default function HomePage() {
  const state = useLoad(async () => {
    const [content, layout] = await Promise.all([getPublicContent(), getMiniappLayout('home')]);
    return { content, layout };
  }, []);
  usePullDownRefresh(async () => {
    try {
      const [content, layout] = await Promise.all([getPublicContent(true), getMiniappLayout('home', true)]);
      void content; void layout; await state.reload();
    } finally { Taro.stopPullDownRefresh(); }
  });
  return <View className='page'>
    <Text className='page-title'>友尚AI</Text>
    <Text className='page-subtitle'>让每一个问题，都能找到合适的 AI 工具。</Text>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <LayoutBlocks layout={state.data.layout} content={state.data.content} />}
  </View>;
}
