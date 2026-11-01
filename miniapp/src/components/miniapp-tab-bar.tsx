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
 * 底部导航栏（自绘 · 固定贴底铺满宽度）。
 *
 * 视觉（2026-11-02 主人指定，参考图：抖音底部栏）：
 * 白底贴底、左右无留白、无圆角，顶部一条 1px 分隔线与页面内容切分；
 * 5 等分，每项「图标在上、文字在下」竖排；
 * 未选中 = 线条描边图标 + 灰蓝文字；选中 = **实心图标** + 蓝色文字（图文同色同步切换）。
 *
 * ⚠️ 历史沿革：改造前是 iOS Liquid Glass 悬浮胶囊（左右 margin + 999rpx 圆角 + 玻璃渐变
 * + backdrop-filter + 选中态玻璃气泡）。贴底后这些全部没有意义（底下就是页面底色，模糊
 * 等于白耗性能），已整体移除；`.mini-tab-bubble` 气泡层也随之删掉，别再按旧结构加回来。
 *
 * ⚠️ 图标实现说明（踩坑记录，勿改回内联 SVG）：
 * 微信小程序 WXML 只渲染已注册的内置组件，Taro 生成的 dist/base.wxml 里没有
 * svg / path / rect / linearGradient 等模板，所以「内联 <svg> 图标」会被**静默丢弃**，
 * 表现就是——容器正常显示，但里面只剩文字、图标全没了。
 * 因此图标走 CSS background-image + base64 内联 PNG data URI，
 * 由 src/styles/tab-icons.scss 提供（脚本 scripts/gen-tab-icons.js 生成，含线条/实心两套）。
 */
export function MiniappTabBar({ active }: { active: TabKey }) {
  const jump = (key: TabKey) => {
    if (key === active) return;
    const tab = tabs.find((t) => t.key === key);
    if (tab) void Taro.reLaunch({ url: tab.url });
  };
  return (
    <>
      {/* 占位：贴底栏是 fixed，用它把页面内容顶上去，避免最后一段被栏体盖住 */}
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
              </View>
            );
          })}
        </View>
      </View>
    </>
  );
}
