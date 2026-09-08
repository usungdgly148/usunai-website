import Taro from '@tarojs/taro';
import { Button, Image, Input, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { changePassword, getMe, isLoggedOut, logoutSession, updateProfile } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';
import { confirmDialog, toast } from '../../utils/feedback';

const maskPhone = (phone?: string) => {
  if (!phone) return '';
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
};

export default function AccountSecurityPage() {
  const { pageStyle } = useThemePage();
  const state = useLoad(async () => getMe(), []);

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '账号与安全' });
  }, []);

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

  // 退出登录：服务端吊销会话 + 清理本地登录态
  const confirmLogout = async () => {
    const yes = await confirmDialog({
      title: '退出登录',
      content: '确定要退出当前账号吗？退出后可随时通过「微信一键登录」重新进入。',
      confirmText: '退出',
    });
    if (!yes) return;
    try { await logoutSession(); } finally {
      toast('已退出登录', 'success');
      setTimeout(() => Taro.reLaunch({ url: '/pages/profile/index' }), 500);
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

  return <View className='page mini-account-page' style={pageStyle}>
    <PageState
      loading={state.loading}
      error={state.error}
      loginFallback={!!state.error && isLoggedOut()}
      onGoLogin={() => Taro.reLaunch({ url: '/pages/profile/index' })}
      onRetry={state.reload}
    />

    {state.data && (
      <>
        {/* 账号信息：头像 + 昵称 */}
        <View className='mini-security-section'>
          <Text className='mini-section-heading'>账号信息</Text>
          <View className='mini-security-list'>
            <View className='mini-security-row' onClick={pickAvatar}>
              <View className='mini-security-left'>
                <View className='mini-security-icon mini-security-icon--avatar'>
                  {state.data.avatar
                    ? <Image className='mini-profile-avatar-img' src={state.data.avatar} mode='aspectFill' />
                    : <Text>{String(state.data.nickname || state.data.name || '友').slice(0, 1)}</Text>}
                </View>
                <View className='mini-security-info'>
                  <Text className='mini-security-label'>头像</Text>
                  <Text className='mini-security-value'>点击更换头像</Text>
                </View>
              </View>
              <Text className='mini-settings-arrow'>›</Text>
            </View>
            <View className='mini-security-row' onClick={openNick}>
              <View className='mini-security-left'>
                <View className='mini-security-icon'><Text>👤</Text></View>
                <View className='mini-security-info'>
                  <Text className='mini-security-label'>昵称</Text>
                  <Text className='mini-security-value'>{state.data.nickname || state.data.name || '微信用户'}</Text>
                </View>
              </View>
              <Text className='mini-settings-arrow'>›</Text>
            </View>
          </View>
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

        {/* 退出登录（替代原「账号注销」） */}
        <View className='mini-logout-wrap'>
          <Button className='mini-logout-button' onClick={confirmLogout}>退出登录</Button>
        </View>
      </>
    )}

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

    <t-dialog id='t-dialog' title='' />
    <t-toast id='t-toast' theme='info' />
  </View>;
}
