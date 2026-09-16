import { useState } from 'react';
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import {
  ApiError,
  bindPhoneNumber,
  bindWebsiteAccount,
  markPhoneBound,
  sendPhoneCode,
  storeBoundSession,
} from '../../services/api';
import { toast } from '../../utils/feedback';
import { useThemePage } from '../../hooks/use-theme-page';
import { shareTargets } from '../../utils/share';

/** 号码已属于另一个账号（服务端回 409），错误码定义在 server/plan-access.mjs。 */
const PHONE_OWNED_BY_OTHER_ACCOUNT = 'PHONE_OWNED_BY_OTHER_ACCOUNT';

type Mode = 'bind' | 'adopt';

/**
 * 补手机号页。一个页面承担两件事（2026-09-17 主人决策 6：把旧的「绑定已有网站账号」
 * 入口合并进来，不再单开一页）：
 *
 *   · bind  —— 给**当前**这个静默登录新建的账号补手机号（默认路径，新用户的常态）。
 *     服务端把号码绑到当前账号；号码若落在另一个**空壳**账号上，会自动并过来
 *     （此时提示「已合并原空账号」）。
 *   · adopt —— 号码已经属于另一个**有资产 / 有邮箱 / 挂过微信**的账号。
 *     服务端不替用户做资产决策（回 409），于是本页切到 adopt：验证通过后把当前微信身份
 *     挂到那个已有账号上，其算力、资产与历史记录原样保留。
 *
 * ⚠️ adopt 分支必须让用户**重新获取一次验证码**：短信验证码是一次性的
 *（阿里云 Dypns 的 CheckSmsVerifyCode 校验通过即失效），bind 那一次已经把码用掉了，
 * 拿同一个码再调 bind 必然失败。这是这个页面唯一需要用户多做一步的地方。
 */
export default function BindPage() {
  const { pageStyle } = useThemePage();
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets();
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('bind');

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) return void toast('请输入正确手机号', 'warning');
    try {
      await sendPhoneCode(phone);
      toast('验证码已发送', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '发送失败', 'error');
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'adopt') {
        const result = await bindWebsiteAccount({ method: 'phone', phone: phone.trim(), code: code.trim() });
        storeBoundSession(result.token);
        toast('已登录该手机号的账号', 'success');
        setTimeout(() => Taro.reLaunch({ url: '/pages/profile/index' }), 500);
        return;
      }
      const result = await bindPhoneNumber({ phone: phone.trim(), code: code.trim() });
      // 账号已经补完整 → 清掉「绑定已有网站账号」的引导标记，别再让个人中心挂着那张卡。
      markPhoneBound();
      toast(result.merged ? '绑定成功，已合并原空账号' : '绑定成功', 'success');
      setTimeout(() => Taro.reLaunch({ url: '/pages/profile/index' }), 500);
    } catch (error) {
      // 号码属于另一个有资产的账号：服务端拒绝抢占（决策「有资产不自动并」），
      // 这里切到 adopt 让用户自己决定。验证码已被消耗 → 必须重新获取。
      if (error instanceof ApiError && error.code === PHONE_OWNED_BY_OTHER_ACCOUNT) {
        setMode('adopt');
        setCode('');
        toast('该手机号已注册，请重新获取验证码', 'warning');
        return;
      }
      toast(error instanceof Error ? error.message : '绑定失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const adopting = mode === 'adopt';

  return <View className='page' style={pageStyle}>
    <Text className='page-title'>{adopting ? '登录已有账号' : '绑定手机号'}</Text>
    <View className='section'>
      <Text className='muted'>
        {adopting
          ? '该手机号已注册过账号。验证后将登录该账号，其算力、资产与历史记录都会被保留。'
          : '绑定手机号后才能充值、使用 AI 智能体与工作流。'}
      </Text>
      <Text className='form-label'>手机号</Text><Input className='form-input' type='number' maxlength={11} value={phone} onInput={(event) => setPhone(event.detail.value)} placeholder='请输入手机号' />
      <Text className='form-label'>验证码</Text><Input className='form-input' type='number' value={code} onInput={(event) => setCode(event.detail.value)} placeholder={adopting ? '请重新获取验证码后输入' : '请输入短信验证码'} />
      <Button className='secondary-button' onClick={sendCode}>获取验证码</Button>
    </View>
    <Button className='primary-button' loading={busy} disabled={busy} onClick={submit}>{adopting ? '登录该账号' : '确认绑定'}</Button>
    {/* adopt 是「这个号不是我要的」时的退路：清掉号码从头来，别把用户困在这一步 */}
    {adopting
      ? <Button className='secondary-button' onClick={() => { setMode('bind'); setCode(''); setPhone(''); }}>换一个手机号</Button>
      : null}
    <t-toast id='t-toast' theme='info' />
  </View>;
}
