import { useEffect } from 'react';
import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { API_BASE, getPublicContent } from '../../services/api';

/** 二维码相对路径（/api/...）拼上 API_BASE，与 recharge 页同一规则 */
const toAbsolute = (url: string) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
};

/**
 * 联系客服二级页：客服微信二维码 + 提示文字「长按扫码，咨询客服」。
 * 二维码与网页端首页右下角「联系我们」同源（getPublicContent → customerService.qr，后台客服配置）。
 */
export default function ServicePage() {
  const { pageStyle } = useThemePage();

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '联系客服' });
  }, []);

  const state = useLoad(async () => {
    const content = await getPublicContent();
    const raw = content?.customerService;
    const cs = (raw && typeof raw === 'object' ? raw : {}) as { qr?: unknown };
    return { qr: String(cs.qr || '') };
  }, []);

  const qr = toAbsolute(state.data?.qr || '');
  const previewQr = () => {
    if (!qr) return;
    Taro.previewImage({ urls: [qr] }).catch(() => {});
  };

  return <View className='page mini-service-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>联系客服</Text>
      <Text className='mini-page-caption'>添加客服微信，获取产品咨询与人工服务</Text>
    </View>

    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />

    {!state.loading && !state.error && (
      <View className='mini-service-card'>
        {qr ? (
          <Image
            className='mini-service-qr'
            src={qr}
            mode='aspectFit'
            showMenuByLongpress
            onClick={previewQr}
          />
        ) : (
          <View className='mini-service-qr mini-service-qr--empty'>客服二维码暂未上传，请稍后再试</View>
        )}
        <Text className='mini-service-tip'>长按扫码，咨询客服</Text>
      </View>
    )}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
