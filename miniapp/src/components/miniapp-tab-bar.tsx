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
 * 之前使用 TDesign t-tab-bar，因 TDesign 图标字体走远程 CDN，微信小程序
 * @font-face 不支持网络字体导致图标不可用，所以改为「纯文本」形态。
 * 现进一步改为完全自绘：内联 22px 线性 SVG 图标 + 毛玻璃胶囊容器，
 * 视觉风格「半透明白色毛玻璃底板 + 极细白色边框 + 柔和悬浮阴影 + 5 等分」，
 * 当前项「蓝紫渐变图标 + 蓝色短指示线」。
 */

const STROKE = 1.8;

type IconProps = { active: boolean };

// 每个图标的 <linearGradient> id 互不冲突（同一时刻只有 1 个 active）。
const GRAD_STOPS = (
  <>
    <stop offset='0%' stopColor='#3b82f6' />
    <stop offset='100%' stopColor='#8b5cf6' />
  </>
);
const strokeOf = (active: boolean, gid: string) => (active ? `url(#${gid})` : 'currentColor');

function HomeIcon({ active }: IconProps) {
  const gid = 'tab-grad-home';
  return (
    <svg className='mini-tab-svg' width='22' height='22' viewBox='0 0 22 22' fill='none' aria-hidden='true'>
      {active && <defs><linearGradient id={gid} x1='0' y1='0' x2='22' y2='22' gradientUnits='userSpaceOnUse'>{GRAD_STOPS}</linearGradient></defs>}
      <path d='M2.5 10.2 L11 3 L19.5 10.2 V18.5 a1 1 0 0 1 -1 1 H3.5 a1 1 0 0 1 -1 -1 Z' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' strokeLinejoin='round' fill='none' />
      <path d='M8 19.5 V13 H14 V19.5' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' strokeLinejoin='round' fill='none' />
    </svg>
  );
}

function AgentIcon({ active }: IconProps) {
  const gid = 'tab-grad-agent';
  return (
    <svg className='mini-tab-svg' width='22' height='22' viewBox='0 0 22 22' fill='none' aria-hidden='true'>
      {active && <defs><linearGradient id={gid} x1='0' y1='0' x2='22' y2='22' gradientUnits='userSpaceOnUse'>{GRAD_STOPS}</linearGradient></defs>}
      {/* 芯片主体 */}
      <rect x='5' y='5' width='12' height='12' rx='2' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
      {/* 上下左右各 2 根引脚 */}
      <path d='M8.5 3 V5 M13.5 3 V5 M8.5 17 V19 M13.5 17 V19' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' />
      <path d='M3 8.5 H5 M3 13.5 H5 M17 8.5 H19 M17 13.5 H19' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' />
      {/* 内核（代表 AI 处理单元） */}
      <rect x='9' y='9' width='4' height='4' rx='0.6' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
    </svg>
  );
}

function WorkflowIcon({ active }: IconProps) {
  const gid = 'tab-grad-workflow';
  return (
    <svg className='mini-tab-svg' width='22' height='22' viewBox='0 0 22 22' fill='none' aria-hidden='true'>
      {active && <defs><linearGradient id={gid} x1='0' y1='0' x2='22' y2='22' gradientUnits='userSpaceOnUse'>{GRAD_STOPS}</linearGradient></defs>}
      {/* 公文包 */}
      <rect x='3' y='7' width='16' height='12' rx='2' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
      <path d='M8 7 V5.5 a1 1 0 0 1 1 -1 H13 a1 1 0 0 1 1 1 V7' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' strokeLinejoin='round' fill='none' />
      <path d='M3 12.5 H19' stroke={strokeOf(active, gid)} strokeWidth={STROKE} />
    </svg>
  );
}

function AssetIcon({ active }: IconProps) {
  const gid = 'tab-grad-asset';
  return (
    <svg className='mini-tab-svg' width='22' height='22' viewBox='0 0 22 22' fill='none' aria-hidden='true'>
      {active && <defs><linearGradient id={gid} x1='0' y1='0' x2='22' y2='22' gradientUnits='userSpaceOnUse'>{GRAD_STOPS}</linearGradient></defs>}
      {/* 数据库（3 层圆柱） */}
      <ellipse cx='11' cy='5' rx='7' ry='2.2' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
      <path d='M4 5 V10.5 a7 2.2 0 0 0 14 0 V5' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
      <path d='M4 10.5 V16 a7 2.2 0 0 0 14 0 V10.5' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
    </svg>
  );
}

function ProfileIcon({ active }: IconProps) {
  const gid = 'tab-grad-profile';
  return (
    <svg className='mini-tab-svg' width='22' height='22' viewBox='0 0 22 22' fill='none' aria-hidden='true'>
      {active && <defs><linearGradient id={gid} x1='0' y1='0' x2='22' y2='22' gradientUnits='userSpaceOnUse'>{GRAD_STOPS}</linearGradient></defs>}
      <circle cx='11' cy='8' r='3.5' stroke={strokeOf(active, gid)} strokeWidth={STROKE} fill='none' />
      <path d='M4 19.5 a7 7 0 0 1 14 0' stroke={strokeOf(active, gid)} strokeWidth={STROKE} strokeLinecap='round' fill='none' />
    </svg>
  );
}

const ICONS: Record<TabKey, (p: IconProps) => JSX.Element> = {
  home: HomeIcon,
  agents: AgentIcon,
  workflows: WorkflowIcon,
  assets: AssetIcon,
  profile: ProfileIcon,
};

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
            const Icon = ICONS[tab.key];
            const isActive = tab.key === active;
            return (
              <View
                key={tab.key}
                className={`mini-tab-item ${isActive ? 'mini-tab-item-active' : ''}`}
                hoverClass='mini-tab-item-hover'
                onClick={() => jump(tab.key)}
              >
                <View className='mini-tab-icon'>
                  <Icon active={isActive} />
                </View>
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
