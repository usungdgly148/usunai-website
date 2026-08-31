import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getMe, isBindingRequired } from '../../services/api';

const validDate = (value: string | null) => value ? new Date(value).toLocaleDateString('zh-CN') : '未设置';

export default function ProfilePage() {
  const state = useLoad(() => getMe(), []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });
  return <View className='page'>
    <Text className='page-title'>个人中心</Text><Text className='page-subtitle'>余额、有效期和个人记录均来自网站同一账户。</Text>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    {state.data && <>
      <View className='card section'><Text className='card-title'>{state.data.nickname || state.data.name || '微信用户'}</Text><Text className='muted'>用户 ID：{state.data.id}</Text><View className='stat-row'><View className='stat'><Text className='stat-value'>{state.data.points}</Text><Text className='muted'>剩余算力</Text></View><View className='stat'><Text className='stat-value'>{validDate(state.data.validTo)}</Text><Text className='muted'>有效期</Text></View></View></View>
      {isBindingRequired() && <View className='card'><Text className='card-title'>绑定已有网站账号</Text><Text className='card-desc'>完成验证后可查看原有余额、资产和历史记录。</Text><Button className='primary-button' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>去绑定</Button></View>}
      <View className='nav-grid'>
        <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/compute/index' })}>算力记录</View>
        <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/assets/index' })}>我的资产</View>
        <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/orders/index' })}>订单记录</View>
        <View className='nav-card' onClick={() => Taro.navigateTo({ url: '/pages/home/index' })}>返回首页</View>
      </View>
    </>}
  </View>;
}
