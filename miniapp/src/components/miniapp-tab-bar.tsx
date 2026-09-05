import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';

type TabKey = 'home' | 'agents' | 'inspire' | 'assets' | 'profile';

const tabs: Array<{ key: TabKey; label: string; icon: string; url: string }> = [
  { key: 'home', label: '首页', icon: '⌂', url: '/pages/home/index' },
  { key: 'agents', label: '智能体', icon: '◎', url: '/pages/category/index?type=agent&title=AI智能体' },
  { key: 'inspire', label: '发现', icon: '✦', url: '/pages/search/index' },
  { key: 'assets', label: '资产', icon: '▣', url: '/pages/assets/index' },
  { key: 'profile', label: '我的', icon: '○', url: '/pages/profile/index' },
];

export function MiniappTabBar({ active }: { active: TabKey }) {
  return <View className='mini-tabbar'>
    {tabs.map(tab => <View
      key={tab.key}
      className={`mini-tabbar-item ${active === tab.key ? 'mini-tabbar-item-active' : ''}`}
      onClick={() => active !== tab.key && void Taro.reLaunch({ url: tab.url })}
    >
      <Text className='mini-tabbar-icon'>{tab.icon}</Text>
      <Text className='mini-tabbar-label'>{tab.label}</Text>
    </View>)}
  </View>;
}
