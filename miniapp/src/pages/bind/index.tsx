import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { bindWebsiteAccount, sendPhoneCode, storeBoundSession } from '../../services/api';
import { toast } from '../../utils/feedback';
import { useThemePage } from '../../hooks/use-theme-page';

export default function BindPage() {
  const { pageStyle } = useThemePage();
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      const result = method === 'email'
        ? await bindWebsiteAccount({ method, email: email.trim(), password })
        : await bindWebsiteAccount({ method, phone: phone.trim(), code: code.trim() });
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
    <Text className='page-subtitle'>绑定后继续使用网站已有的算力、资产和订单。不会创建重复余额。</Text>
    <View className='chip-row section'>
      <View className={`chip ${method === 'email' ? 'chip-active' : ''}`} onClick={() => setMethod('email')}>邮箱账户</View>
      <View className={`chip ${method === 'phone' ? 'chip-active' : ''}`} onClick={() => setMethod('phone')}>手机号账户</View>
    </View>
    {method === 'email' ? <View className='section'>
      <Text className='form-label'>邮箱</Text><Input className='form-input' value={email} onInput={(event) => setEmail(event.detail.value)} placeholder='请输入网站注册邮箱' />
      <Text className='form-label'>密码</Text><Input className='form-input' password value={password} onInput={(event) => setPassword(event.detail.value)} placeholder='请输入网站登录密码' />
    </View> : <View className='section'>
      <Text className='form-label'>手机号</Text><Input className='form-input' type='number' maxlength={11} value={phone} onInput={(event) => setPhone(event.detail.value)} placeholder='请输入网站注册手机号' />
      <Text className='form-label'>验证码</Text><Input className='form-input' type='number' value={code} onInput={(event) => setCode(event.detail.value)} placeholder='请输入短信验证码' />
      <Button className='secondary-button' onClick={sendCode}>获取验证码</Button>
    </View>}
    <Button className='primary-button' loading={busy} disabled={busy} onClick={submit}>确认绑定</Button>
    <t-toast id='t-toast' theme='info' />
  </View>;
}
