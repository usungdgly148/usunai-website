import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Button, Image, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { RechargeSheet } from '../../components/recharge-sheet';
import { useLoad } from '../../hooks/use-load';
import { changePassword, getMe, isBindingRequired, isLoggedOut, loginWithWechat, logoutSession, updateProfile } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';
import { type ThemeMode, readMode, resolveTheme, setMode } from '../../utils/theme';
import { confirmDialog, toast } from '../../utils/feedback';

const validDate = (value: string | null) => value ? new Date(value).toLocaleDateString('zh-CN') : '有效期未设置';
const maskPhone = (phone?: string) => {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
};

const MODE_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '浅色', hint: '始终使用明亮外观' },
  { value: 'dark', label: '深色', hint: '界面使用暗黑配色，夜间更护眼' },
  { value: 'auto', label: '跟随系统', hint: '随微信系统深浅色自动切换' },
];

const modeLabel = (mode: ThemeMode) => MODE_OPTIONS.find((item) => item.value === mode)?.label || '浅色';

export default function ProfilePage() {
  const { pageStyle } = useThemePage();
  // 主动退出登录后进入未登录视图；重新「微信一键登录」后回到已登录视图
  const [signedOut, setSignedOut] = useState<boolean>(() => isLoggedOut());
  const [loginBusy, setLoginBusy] = useState(false);
  const state = useLoad(async () => (isLoggedOut() ? null : getMe()), []);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readMode());
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  // 昵称编辑
  const [nickOpen, setNickOpen] = useState(false);
  const [nickInput, setNickInput] = useState('');
  const [nickSaving, setNickSaving] = useState(false);
  // 修改密码
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  // 算力充值弹窗
  const [rechargeOpen, setRechargeOpen] = useState(false);
  usePullDownRefresh(async () => { if (!isLoggedOut()) await state.reload(); Taro.stopPullDownRefresh(); });

  const pickMode = (mode: ThemeMode) => {
    setMode(mode);
    setThemeMode(mode);
    setShowThemeSheet(false);
  };

  const copyId = () => {
    if (!state.data?.id) return;
    Taro.setClipboardData({ data: state.data.id }).then(() => toast('已复制用户 ID', 'success')).catch(() => {});
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

  // 退出登录：服务端吊销会话 + 清理本地登录态
  const confirmLogout = async () => {
    const yes = await confirmDialog({
      title: '退出登录',
      content: '确定要退出当前账号吗？退出后可随时通过「微信一键登录」重新进入。',
      confirmText: '退出',
    });
    if (!yes) return;
    try { await logoutSession(); } finally { setSignedOut(true); }
    toast('已退出登录', 'success');
  };

  // 头像：选择图片 → 读 base64 → 更新 → 刷新
  const pickAvatar = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] });
      const tempPath = res.tempFilePaths && res.tempFilePaths[0];
      if (!tempPath) return;
      const base64 = Taro.getFileSystemManager().readFileSync(tempPath, 'base64') as string;
      if (base64.length > 1200 * 1024) { toast('图片过大，请选择更小的图片', 'warning'); return; }
      let mime = 'jpeg';
      try {
        const info = await Taro.getImageInfo({ src: tempPath });
        const t = String((info as { type?: string }).type || '').toLowerCase();
        if (t === 'png' || t === 'gif' || t === 'webp') mime = t;
        else if (t === 'jpeg' || t === 'jpg') mime = 'jpeg';
      } catch { /* 默认 jpeg */ }
      await updateProfile({ avatar: `data:image/${mime};base64,${base64}` });
      toast('头像已更新', 'success');
      await state.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : '头像更新失败', 'error');
    }
  };

  const openNick = () => {
    setNickInput(state.data?.nickname || state.data?.name || '');
    setNickOpen(true);
  };
  const saveNick = async () => {
    const name = nickInput.trim();
    if (!name) { toast('昵称不能为空', 'warning'); return; }
    setNickSaving(true);
    try {
      await updateProfile({ name });
      toast('昵称已保存', 'success');
      setNickOpen(false);
      await state.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setNickSaving(false);
    }
  };

  const openPwd = () => {
    setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    setPwdOpen(true);
  };
  const submitPwd = async () => {
    if (newPwd.length < 6) { toast('新密码至少 6 位', 'warning'); return; }
    if (newPwd !== confirmPwd) { toast('两次输入的密码不一致', 'warning'); return; }
    if (state.data?.hasPassword && !oldPwd) { toast('请输入原密码', 'warning'); return; }
    setPwdBusy(true);
    try {
      await changePassword({ oldPassword: oldPwd, newPassword: newPwd });
      toast('密码修改成功', 'success');
      setPwdOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : '修改失败', 'error');
    } finally {
      setPwdBusy(false);
    }
  };

  const securityRows: Array<{ icon: string; label: string; value: string; action?: () => void; actionText?: string }> = [
    { icon: '✉', label: '邮箱', value: state.data?.email || '未绑定' },
    {
      icon: '☎', label: '手机号', value: maskPhone(state.data?.phone) || '未绑定',
      action: () => Taro.navigateTo({ url: '/pages/bind/index' }),
      actionText: state.data?.phone ? '修改' : '绑定',
    },
    { icon: '💬', label: '微信', value: '已绑定' },
    { icon: '🔒', label: '登录密码', value: state.data?.hasPassword ? '已设置' : '未设置', action: openPwd, actionText: '修改' },
  ];

  const shortcuts: Array<{ icon: string; label: string; url?: string; onClick?: () => void }> = [
    { icon: '▣', label: '我的资产', url: '/pages/assets/index' },
    { icon: 'ϟ', label: '算力充值', onClick: () => setRechargeOpen(true) },
    { icon: '◉', label: '订单记录', url: '/pages/orders/index' },
    { icon: '◎', label: 'AI工具', url: '/pages/category/index?type=agent&title=AI%E6%99%BA%E8%83%BD%E4%BD%93' },
  ];

  const links = [
    { label: '我的资产', url: '/pages/assets/index' },
    { label: '算力记录', url: '/pages/compute/index' },
    { label: '订单记录', url: '/pages/orders/index' },
    { label: '使用协议', url: '/pages/webview/index?url=https%3A%2F%2Fwww.usunai.top%2Flegal-agreements' },
    { label: '隐私政策', url: '/pages/webview/index?url=https%3A%2F%2Fwww.usunai.top%2Flegal-agreements' },
  ];

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
        {/* 基本信息：头像 + 昵称 + 用户 ID（可编辑） */}
        <View className='mini-profile-head'>
          <View className='mini-profile-avatar' onClick={pickAvatar}>
            {state.data.avatar
              ? <Image className='mini-profile-avatar-img' src={state.data.avatar} mode='aspectFill' />
              : <Text>{String(state.data.nickname || state.data.name || '友').slice(0, 1)}</Text>}
            <View className='mini-profile-avatar-badge'>📷</View>
          </View>
          <View className='mini-profile-head-main'>
            <View className='mini-profile-name-row'>
              <Text className='mini-profile-name'>{state.data.nickname || state.data.name || '微信用户'}</Text>
              <Text className='mini-profile-edit' onClick={openNick}>编辑</Text>
            </View>
            <View className='mini-profile-id-row' onClick={copyId}>
              <Text className='muted'>用户 ID：{state.data.id}</Text>
              <Text className='mini-profile-copy'>复制</Text>
            </View>
            <Text className='mini-profile-avatar-hint' onClick={pickAvatar}>点击头像更换</Text>
          </View>
        </View>

        <View className='mini-membership-card'>
          <View><Text className='mini-membership-kicker'>我的算力</Text><Text className='mini-membership-title'>可用点数</Text><Text className='mini-membership-desc'>有效期至 {validDate(state.data.validTo)}</Text></View>
          <View className='mini-membership-points'><Text>{state.data.points}</Text><Text>点</Text></View>
        </View>

        {/* 算力充值入口（弹窗展示套餐，客服人工办理） */}
        <View className='mini-recharge-entry' onClick={() => setRechargeOpen(true)}>
          <View className='mini-recharge-entry-icon'><Text>ϟ</Text></View>
          <View className='mini-recharge-entry-main'>
            <Text className='mini-recharge-entry-title'>算力充值</Text>
            <Text className='mini-recharge-entry-desc'>查看算力套餐 · 联系客服人工开通</Text>
          </View>
          <Text className='mini-settings-arrow'>›</Text>
        </View>

        {/* 账号安全 */}
        <View className='mini-security-section'>
          <Text className='mini-section-heading'>账号安全</Text>
          <View className='mini-security-list'>
            {securityRows.map((row) => (
              <View key={row.label} className='mini-security-row'>
                <View className='mini-security-left'>
                  <View className='mini-security-icon'><Text>{row.icon}</Text></View>
                  <View className='mini-security-info'>
                    <Text className='mini-security-label'>{row.label}</Text>
                    <Text className='mini-security-value'>{row.value}</Text>
                  </View>
                </View>
                {row.action && <Text className='mini-security-action' onClick={row.action}>{row.actionText}</Text>}
              </View>
            ))}
          </View>
        </View>

        {isBindingRequired() && <View className='mini-bind-card'><View><Text className='mini-bind-title'>绑定已有网站账号</Text><Text className='mini-bind-desc'>同步已有算力、资产和历史记录</Text></View><Button className='mini-bind-button' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>去绑定</Button></View>}
      </>
    ) : null}

    {/* 快捷入口与常用链接（未登录也可见） */}
    <View className='mini-profile-shortcuts'>{shortcuts.map(item => <View className='mini-profile-shortcut' key={item.label} onClick={() => (item.onClick ? item.onClick() : Taro.navigateTo({ url: item.url || '' }))}><Text className='mini-profile-shortcut-icon'>{item.icon}</Text><Text>{item.label}</Text></View>)}</View>
    <View className='mini-settings-list'>{links.map(item => <View className='mini-settings-row' key={item.label} onClick={() => Taro.navigateTo({ url: item.url })}><Text>{item.label}</Text><Text className='mini-settings-arrow'>›</Text></View>)}</View>

    {/* 深色模式 */}
    <View className='mini-settings-list mini-settings-list--theme'>
      <View className='mini-settings-row' onClick={() => setShowThemeSheet(true)}>
        <Text>深色模式</Text>
        <View className='mini-settings-pick'>
          <Text className='mini-settings-current'>{themeMode === 'auto' ? '跟随系统' : modeLabel(themeMode)}</Text>
          <Text className='mini-settings-arrow'>›</Text>
        </View>
      </View>
    </View>

    {!signedOut && (
      <View className='mini-logout-wrap'>
        <Button className='mini-logout-button' onClick={confirmLogout}>退出登录</Button>
      </View>
    )}

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

    {/* 昵称编辑 */}
    <t-popup visible={nickOpen} placement='center' showOverlay closeOnOverlayClick onVisibleChange={(e: { detail?: { visible?: boolean } }) => { if (!e.detail?.visible) setNickOpen(false); }}>
      <View className='mini-edit-sheet'>
        <Text className='mini-edit-sheet-title'>修改昵称</Text>
        <Input className='mini-edit-sheet-input' value={nickInput} maxlength={40} onInput={(e) => setNickInput(e.detail.value)} placeholder='请输入昵称' />
        <View className='mini-edit-sheet-actions'>
          <Button className='mini-edit-sheet-cancel' onClick={() => setNickOpen(false)}>取消</Button>
          <Button className='mini-edit-sheet-ok' loading={nickSaving} disabled={nickSaving} onClick={saveNick}>保存</Button>
        </View>
      </View>
    </t-popup>

    {/* 修改密码 */}
    <t-popup visible={pwdOpen} placement='center' showOverlay closeOnOverlayClick onVisibleChange={(e: { detail?: { visible?: boolean } }) => { if (!e.detail?.visible) setPwdOpen(false); }}>
      <View className='mini-edit-sheet'>
        <Text className='mini-edit-sheet-title'>修改登录密码</Text>
        <Text className='mini-edit-sheet-sub'>密码需至少 6 位，修改后请使用新密码登录。</Text>
        {state.data?.hasPassword && (
          <Input className='mini-edit-sheet-input' password value={oldPwd} onInput={(e) => setOldPwd(e.detail.value)} placeholder='请输入原密码' />
        )}
        <Input className='mini-edit-sheet-input' password value={newPwd} onInput={(e) => setNewPwd(e.detail.value)} placeholder='请输入新密码（至少 6 位）' />
        <Input className='mini-edit-sheet-input' password value={confirmPwd} onInput={(e) => setConfirmPwd(e.detail.value)} placeholder='请再次输入新密码' />
        <View className='mini-edit-sheet-actions'>
          <Button className='mini-edit-sheet-cancel' onClick={() => setPwdOpen(false)}>取消</Button>
          <Button className='mini-edit-sheet-ok' loading={pwdBusy} disabled={pwdBusy} onClick={submitPwd}>确认修改</Button>
        </View>
      </View>
    </t-popup>

    {/* 算力充值弹窗（套餐展示 + 联系客服） */}
    <RechargeSheet visible={rechargeOpen} onClose={() => setRechargeOpen(false)} />

    <t-dialog id='t-dialog' title='' />
    <t-toast id='t-toast' theme='info' />
  </View>;
}
