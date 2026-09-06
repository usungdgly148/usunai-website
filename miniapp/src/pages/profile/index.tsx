import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getMe, isBindingRequired } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';
import { type ThemeMode, readMode, resolveTheme, setMode } from '../../utils/theme';

const validDate = (value: string | null) => value ? new Date(value).toLocaleDateString('zh-CN') : '有效期未设置';

const shortcuts = [
  { icon: '▣', label: '我的资产', url: '/pages/assets/index' },
  { icon: 'ϟ', label: '算力充值', url: '/pages/compute/index' },
  { icon: '◉', label: '订单记录', url: '/pages/orders/index' },
  { icon: '◎', label: 'AI工具', url: '/pages/category/index?type=agent&title=AI智能体' },
];

const links = [
  { label: '我的资产', url: '/pages/assets/index' },
  { label: '算力记录', url: '/pages/compute/index' },
  { label: '订单记录', url: '/pages/orders/index' },
  { label: '使用协议', url: '/pages/webview/index?url=https%3A%2F%2Fwww.usunai.top%2Flegal-agreements' },
  { label: '隐私政策', url: '/pages/webview/index?url=https%3A%2F%2Fwww.usunai.top%2Flegal-agreements' },
];

const MODE_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '浅色', hint: '始终使用明亮外观' },
  { value: 'dark', label: '深色', hint: '界面使用暗黑配色，夜间更护眼' },
  { value: 'auto', label: '跟随系统', hint: '随微信系统深浅色自动切换' },
];

const modeLabel = (mode: ThemeMode) => MODE_OPTIONS.find((item) => item.value === mode)?.label || '浅色';

export default function ProfilePage() {
  const { pageStyle } = useThemePage();
  const state = useLoad(() => getMe(), []);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readMode());
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  const pickMode = (mode: ThemeMode) => {
    setMode(mode);
    setThemeMode(mode);
    setShowThemeSheet(false);
  };

  return <View className='page mini-profile-page' style={pageStyle}>
    <View className='mini-page-topbar'><Text className='mini-page-heading'>我的</Text><Text className='mini-page-caption'>账户、算力与创作资产</Text></View>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
    <View className='mini-settings-list mini-settings-list--theme'>
      <View className='mini-settings-row' onClick={() => setShowThemeSheet(true)}>
        <Text>深色模式</Text>
        <View className='mini-settings-pick'>
          <Text className='mini-settings-current'>{themeMode === 'auto' ? '跟随系统' : modeLabel(themeMode)}</Text>
          <Text className='mini-settings-arrow'>›</Text>
        </View>
      </View>
    </View>
    {state.data && <>
      <View className='mini-profile-head'>
        <View className='mini-profile-avatar'><Text>{String(state.data.nickname || state.data.name || '友').slice(0, 1)}</Text></View>
        <View><Text className='mini-profile-name'>{state.data.nickname || state.data.name || '微信用户'}</Text><Text className='muted'>用户 ID：{state.data.id}</Text></View>
      </View>
      <View className='mini-membership-card'>
        <View><Text className='mini-membership-kicker'>我的算力</Text><Text className='mini-membership-title'>可用点数</Text><Text className='mini-membership-desc'>有效期至 {validDate(state.data.validTo)}</Text></View>
        <View className='mini-membership-points'><Text>{state.data.points}</Text><Text>点</Text></View>
      </View>
      {isBindingRequired() && <View className='mini-bind-card'><View><Text className='mini-bind-title'>绑定已有网站账号</Text><Text className='mini-bind-desc'>同步已有算力、资产和历史记录</Text></View><Button className='mini-bind-button' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>去绑定</Button></View>}
      <View className='mini-profile-shortcuts'>{shortcuts.map(item => <View className='mini-profile-shortcut' key={item.label} onClick={() => Taro.navigateTo({ url: item.url })}><Text className='mini-profile-shortcut-icon'>{item.icon}</Text><Text>{item.label}</Text></View>)}</View>
      <View className='mini-settings-list'>{links.map(item => <View className='mini-settings-row' key={item.label} onClick={() => Taro.navigateTo({ url: item.url })}><Text>{item.label}</Text><Text className='mini-settings-arrow'>›</Text></View>)}</View>
    </>}
    <MiniappTabBar active='profile' />
    <t-popup
      visible={showThemeSheet}
      placement='bottom'
      showOverlay
      closeOnOverlayClick
      onVisibleChange={(event: { detail?: { visible?: boolean } }) => {
        if (!event.detail?.visible) setShowThemeSheet(false);
      }}
    >
      <View className='theme-sheet'>
        <View className='theme-sheet-grab' />
        <Text className='theme-sheet-title'>外观模式</Text>
        {MODE_OPTIONS.map((option) => (
          <View
            key={option.value}
            className={`theme-sheet-row ${themeMode === option.value ? 'theme-sheet-row-active' : ''}`}
            onClick={() => pickMode(option.value)}
          >
            <View className='theme-sheet-option'>
              <Text className='theme-sheet-label'>{option.label}</Text>
              <Text className='theme-sheet-hint'>{option.hint}</Text>
            </View>
            {themeMode === option.value && <Text className='theme-sheet-check'>✓</Text>}
          </View>
        ))}
        <Text className='theme-sheet-foot'>当前界面为{modeLabel(resolveTheme(themeMode))}外观{themeMode === 'auto' ? '（跟随系统）' : ''}，选择后立即生效</Text>
      </View>
    </t-popup>
  </View>;
}
