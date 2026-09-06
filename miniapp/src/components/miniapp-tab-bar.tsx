import Taro from '@tarojs/taro';
import { Text } from '@tarojs/components';

export type TabKey = 'home' | 'agents' | 'workflows' | 'assets' | 'profile';

const tabs: Array<{ key: TabKey; label: string; url: string }> = [
  { key: 'home', label: '首页', url: '/pages/home/index' },
  { key: 'agents', label: '智能体', url: '/pages/category/index?type=agent&title=AI%E6%99%BA%E8%83%BD%E4%BD%93' },
  { key: 'workflows', label: '工作流', url: '/pages/category/index?type=workflow&title=AI%E5%B7%A5%E4%BD%9C%E6%B5%81' },
  { key: 'assets', label: '资产', url: '/pages/assets/index' },
  { key: 'profile', label: '我的', url: '/pages/profile/index' },
];

/**
 * 底部导航栏（TDesign t-tab-bar）。
 * 说明：TDesign 图标字体走远程 CDN，微信小程序 @font-face 不支持网络字体，
 * 故采用「圆角悬浮 + 纯文本」形态（shape=round / theme=normal），规避图标字体不可用问题。
 */
export function MiniappTabBar({ active }: { active: TabKey }) {
  const jump = (value?: unknown) => {
    if (value === active) return;
    const tab = tabs.find((item) => item.key === value);
    if (tab) void Taro.reLaunch({ url: tab.url });
  };
  return (
    <t-tab-bar value={active} theme='normal' shape='round' split={false} fixed onChange={(e: { detail?: { value?: unknown } }) => jump(e.detail?.value)}>
      {tabs.map((tab) => (
        <t-tab-bar-item key={tab.key} value={tab.key} ariaLabel={tab.label}>
          <Text>{tab.label}</Text>
        </t-tab-bar-item>
      ))}
    </t-tab-bar>
  );
}
