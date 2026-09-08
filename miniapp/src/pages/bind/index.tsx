import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { bindWebsiteAccount, sendPhoneCode, storeBoundSession } from '../../services/api';
import { toast } from '../../utils/feedback';
import { useThemePage } from '../../hooks/use-theme-page';

export default function BindPage() {
  const { pageStyle } = useThemePage();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

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
      const result = await bindWebsiteAccount({ method: 'phone', phone: phone.trim(), code: code.trim() });
      storeBoundSession(result.token);
      toast('绑定成功', 'success');
      setTimeout(() => Taro.reLaunch({ url: '/pages/profile/index' }), 500);
    } catch (error) {
      toast(error instanceof Error ? error.message : '绑定失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return <View className='page' style={pageStyle}>
    <Text className='page-title'>绑定网站账户</Text>
    <Text className='page-subtitle'>用网站已注册的手机号绑定，继承已有算力、资产和订单，不会创建重复余额。</Text>
    <View className='section'>
      <Text className='form-label'>手机号</Text><Input className='form-input' type='number' maxlength={11} value={phone} onInput={(event) => setPhone(event.detail.value)} placeholder='请输入网站注册手机号' />
      <Text className='form-label'>验证码</Text><Input className='form-input' type='number' value={code} onInput={(event) => setCode(event.detail.value)} placeholder='请输入短信验证码' />
      <Button className='secondary-button' onClick={sendCode}>获取验证码</Button>
    </View>
    <Button className='primary-button' loading={busy} disabled={busy} onClick={submit}>确认绑定</Button>
    <t-toast id='t-toast' theme='info' />
  </View>;
}
