import Taro from '@tarojs/taro';
import { View } from '@tarojs/components';

export type TabKey = 'home' | 'agents' | 'workflows' | 'assets' | 'profile';

const tabs: Array<{ key: TabKey; label: string; url: string }> = [
  { key: 'home', label: '首页', url: '/pages/home/index' },
  { key: 'agents', label: '智能体', url: '/pages/category/index?type=agent&title=AI%E6%99%BA%E8%83%BD%E4%BD%93' },
  { key: 'workflows', label: '工作流', url: '/pages/category/index?type=workflow&title=AI%E5%B7%A5%E4%BD%9C%E6%B5%81' },
  { key: 'assets', label: '资产', url: '/pages/assets/index' },
  { key: 'profile', label: '我的', url: '/pages/profile/index' },
];

/**
 * 底部导航栏（自绘 · 极简 iOS 毛玻璃 + AI 科技感胶囊）。
 *
 * 视觉：半透明白色毛玻璃底板 + 极细白色边框 + 柔和悬浮阴影 + 5 等分，
 * 当前项为「蓝紫渐变图标 + 蓝色短指示线」。
 *
 * ⚠️ 图标实现说明（踩坑记录，勿改回内联 SVG）：
 * 微信小程序 WXML 只渲染已注册的内置组件，Taro 生成的 dist/base.wxml 里没有
 * svg / path / rect / linearGradient 等模板，所以「内联 <svg> 图标」会被**静默丢弃**，
 * 表现就是——胶囊容器正常显示，但里面只剩文字、图标全没了。
 * 因此图标走 CSS background-image + base64 内联 SVG data URI，
 * 由 src/styles/tab-icons.scss 提供（脚本 scripts/gen-tab-icons.js 生成）。
 */
export function MiniappTabBar({ active }: { active: TabKey }) {
  const jump = (key: TabKey) => {
    if (key === active) return;
    const tab = tabs.find((t) => t.key === key);
    if (tab) void Taro.reLaunch({ url: tab.url });
  };
  return (
    <>
      {/* 占位：让页面底部留出胶囊 + 安全区高度，避免内容被悬浮胶囊遮住 */}
      <View className='mini-tab-bar-spacer' />
      <View className='mini-tab-bar'>
        <View className='mini-tab-bar-inner'>
          {tabs.map((tab) => {
            const isActive = tab.key === active;
            return (
              <View
                key={tab.key}
                className={`mini-tab-item ${isActive ? 'mini-tab-item-active' : ''}`}
                hoverClass='mini-tab-item-hover'
                onClick={() => jump(tab.key)}
              >
                <View className={`mini-tab-icon mini-tab-icon-${tab.key}`} />
                <View className='mini-tab-label'>{tab.label}</View>
                <View className='mini-tab-indicator' />
              </View>
            );
          })}
        </View>
      </View>
    </>
  );
}
