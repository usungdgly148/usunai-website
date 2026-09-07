import { Button, Text, View } from '@tarojs/components';

export function PageState({
  loading, error, empty, onRetry, loginFallback, onGoLogin,
}: {
  loading?: boolean; error?: string; empty?: boolean; onRetry?: () => void;
  /** 错误由「未登录」导致：显示去登录引导（需要登录的页面在登出态传入） */
  loginFallback?: boolean; onGoLogin?: () => void;
}) {
  if (loading) return <View className='state state-skeleton'><t-skeleton theme='paragraph' loading /></View>;
  if (error) return (
    <View className='state'>
      <Text className='state-title'>{loginFallback ? '请先登录' : '暂时无法加载'}</Text>
      <Text className='muted'>{loginFallback ? '登录后可查看算力、资产与使用记录' : error}</Text>
      {loginFallback && onGoLogin
        ? <Button className='primary-button' onClick={onGoLogin}>去登录</Button>
        : onRetry && <Button className='secondary-button' onClick={onRetry}>重新加载</Button>}
    </View>
  );
  if (empty) return <View className='state state-empty'><t-empty description='这里还没有内容，稍后再来看看吧。' /></View>;
  return null;
}
