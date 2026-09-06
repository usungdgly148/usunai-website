import { Button, Text, View } from '@tarojs/components';

export function PageState({ loading, error, empty, onRetry }: { loading?: boolean; error?: string; empty?: boolean; onRetry?: () => void }) {
  if (loading) return <View className='state state-skeleton'><t-skeleton theme='paragraph' loading /></View>;
  if (error) return <View className='state'><Text className='state-title'>暂时无法加载</Text><Text className='muted'>{error}</Text>{onRetry && <Button className='secondary-button' onClick={onRetry}>重新加载</Button>}</View>;
  if (empty) return <View className='state state-empty'><t-empty description='这里还没有内容，稍后再来看看吧。' /></View>;
  return null;
}
