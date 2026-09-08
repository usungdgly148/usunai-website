import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getMe, isBindingRequired, isLoggedOut, loginWithWechat } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';
import { type ThemeMode, readMode, resolveTheme, setMode } from '../../utils/theme';
import { toast } from '../../utils/feedback';

const validDate = (value: string | null) => value ? new Date(value).toLocaleDateString('zh-CN') : '有效期未设置';

const MODE_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '浅色', hint: '始终使用明亮外观' },
  { value: 'dark', label: '深色', hint: '界面使用暗黑配色，夜间更护眼' },
  { value: 'auto', label: '跟随系统', hint: '随微信系统深浅色自动切换' },
];

const modeLabel = (mode: ThemeMode) => MODE_OPTIONS.find((item) => item.value === mode)?.label || '浅色';

const COMMON_ITEMS = [
  { label: '我的资产', url: '/pages/assets/index', iconClass: 'ui-icon-assets' },
  { label: '算力记录', url: '/pages/compute/index', iconClass: 'ui-icon-compute' },
  { label: '订单记录', url: '/pages/orders/index', iconClass: 'ui-icon-orders' },
  { label: '联系客服', url: '/pages/service/index', iconClass: 'ui-icon-service' },
];

export default function ProfilePage() {
  const { pageStyle } = useThemePage();
  // 主动退出登录后进入未登录视图；重新「微信一键登录」后回到已登录视图
  const [signedOut, setSignedOut] = useState<boolean>(() => isLoggedOut());
  const [loginBusy, setLoginBusy] = useState(false);
  const state = useLoad(async () => (isLoggedOut() ? null : getMe()), []);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readMode());
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  usePullDownRefresh(async () => { if (!isLoggedOut()) await state.reload(); Taro.stopPullDownRefresh(); });

  const pickMode = (mode: ThemeMode) => {
    setMode(mode);
    setThemeMode(mode);
    setShowThemeSheet(false);
  };

  // 微信一键登录（登出后重新进入）
  const startWechatLogin = async () => {
    if (loginBusy) return;
    setLoginBusy(true);
    try {
      await loginWithWechat();
      setSignedOut(false);
      await state.reload();
      toast('登录成功', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '登录失败，请稍后重试', 'error');
    } finally {
      setLoginBusy(false);
    }
  };

  return <View className='page mini-profile-page' style={pageStyle}>
    <PageState loading={!signedOut && state.loading} error={!signedOut ? state.error : ''} onRetry={state.reload} />

    {signedOut ? (
      /* ===== 未登录视图（退出登录后） ===== */
      <View className='mini-login-card'>
        <View className='mini-login-avatar'><Text>友</Text></View>
        <Text className='mini-login-title'>未登录</Text>
        <Text className='mini-login-desc'>登录后可查看可用算力、算力记录与账号资产，使用全部 AI 智能体与工作流。</Text>
        <Button className='mini-login-button' loading={loginBusy} disabled={loginBusy} onClick={startWechatLogin}>微信一键登录</Button>
        <Text className='mini-login-hint'>登录即代表同意平台服务协议与隐私政策</Text>
      </View>
    ) : state.data ? (
      /* ===== 已登录主内容 ===== */
      <>
        {/* 账号信息行：头像 + 昵称 + 用户 ID，右侧 ">" 进入「账号与安全」 */}
        <View className='mini-account-row' onClick={() => Taro.navigateTo({ url: '/pages/account-security/index' })}>
          <View className='mini-profile-avatar'>
            {state.data.avatar
              ? <Image className='mini-profile-avatar-img' src={state.data.avatar} mode='aspectFill' />
              : <Text>{String(state.data.nickname || state.data.name || '友').slice(0, 1)}</Text>}
          </View>
          <View className='mini-profile-head-main'>
            <Text className='mini-profile-name'>{state.data.nickname || state.data.name || '微信用户'}</Text>
            <View className='mini-profile-id-row'>
              <Text className='muted'>用户 ID：{state.data.id}</Text>
            </View>
          </View>
          <Text className='mini-settings-arrow'>›</Text>
        </View>

        {/* 算力会员卡：可用点数 + 充值入口 */}
        <View className='mini-membership-card'>
          <View className='mini-membership-left'>
            <Text className='mini-membership-kicker'>我的算力</Text>
            <Text className='mini-membership-title'>可用点数</Text>
            <Text className='mini-membership-desc'>有效期至 {validDate(state.data.validTo)}</Text>
          </View>
          <View className='mini-membership-right'>
            <View className='mini-membership-points'><Text>{state.data.points}</Text><Text>点</Text></View>
            {/* 充值入口暂时下线：置灰且不响应点击（二级页 /pages/recharge/index 内容保留） */}
            <Button className='mini-membership-recharge mini-membership-recharge-disabled' disabled>充值</Button>
          </View>
        </View>

        {/* 常用功能：3 个链接入口 */}
        <View className='mini-common-section'>
          <Text className='mini-section-heading'>常用功能</Text>
          <View className='mini-common-grid'>
            {COMMON_ITEMS.map((item) => (
              <View key={item.label} className='mini-common-item' onClick={() => Taro.navigateTo({ url: item.url })}>
                <View className={`mini-common-icon ${item.iconClass}`} />
                <Text className='mini-common-label'>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 使用协议 / 隐私政策 / 模式切换（同一容器） */}
        <View className='mini-settings-list'>
          <View className='mini-settings-row' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=terms' })}>
            <View className='mini-settings-left'>
              <View className='mini-settings-icon ui-icon-terms' />
              <Text>使用协议</Text>
            </View>
            <Text className='mini-settings-arrow'>›</Text>
          </View>
          <View className='mini-settings-row' onClick={() => Taro.navigateTo({ url: '/pages/legal/index?type=privacy' })}>
            <View className='mini-settings-left'>
              <View className='mini-settings-icon ui-icon-privacy' />
              <Text>隐私政策</Text>
            </View>
            <Text className='mini-settings-arrow'>›</Text>
          </View>
          <View className='mini-settings-row' onClick={() => setShowThemeSheet(true)}>
            <View className='mini-settings-left'>
              <View className='mini-settings-icon ui-icon-theme' />
              <Text>模式切换</Text>
            </View>
            <View className='mini-settings-pick'>
              <Text className='mini-settings-current'>{themeMode === 'auto' ? '跟随系统' : modeLabel(themeMode)}</Text>
              <Text className='mini-settings-arrow'>›</Text>
            </View>
          </View>
        </View>

        {isBindingRequired() && <View className='mini-bind-card'><View><Text className='mini-bind-title'>绑定已有网站账号</Text><Text className='mini-bind-desc'>同步已有算力、资产和历史记录</Text></View><Button className='mini-bind-button' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>去绑定</Button></View>}
      </>
    ) : null}

    <MiniappTabBar active='profile' />

    {/* 深色模式选择 */}
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

    {/* 算力充值已改为二级页 /pages/recharge/index */}

    <t-dialog id='t-dialog' title='' />
    <t-toast id='t-toast' theme='info' />
  </View>;
}
