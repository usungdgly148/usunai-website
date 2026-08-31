import { useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { LayoutBlocks } from '../../components/layout-blocks';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getMiniappLayout, getPublicContent } from '../../services/api';

export default function CategoryPage() {
  const { params } = useRouter();
  const state = useLoad(async () => {
    const [content, layout] = await Promise.all([getPublicContent(), getMiniappLayout('category')]);
    return { content, layout };
  }, []);
  return <View className='page'>
    <Text className='page-title'>{decodeURIComponent(params.title || '全部应用')}</Text>
    <Text className='page-subtitle'>当前上架的智能体和工作流</Text>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <LayoutBlocks layout={state.data.layout} content={state.data.content} category={params.category || ''} type={params.type || ''} />}
  </View>;
}
