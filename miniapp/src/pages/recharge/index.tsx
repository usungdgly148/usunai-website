import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import { useEffect } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { API_BASE, getPublicContent } from '../../services/api';
import type { ComputePackage, CustomerService } from '../../types';

interface RechargeData {
  computePackages: ComputePackage[];
  rechargeInfo: string;
  customerService: CustomerService;
}

/** 套餐有效期文案（与网页 RechargeDialog 同规则） */
function validityText(pkg: ComputePackage) {
  const days = Number(pkg.validDays) || 0;
  if (days > 0 && pkg.validFrom) {
    const base = new Date(String(pkg.validFrom));
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    return `有效期至 ${end.toLocaleDateString('zh-CN')}`;
  }
  if (days > 0) return `购买后 ${days} 天到期`;
  if (pkg.validFrom) return `长期有效（${String(pkg.validFrom)} 起）`;
  return '长期有效';
}

const toAbsolute = (url: string) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
};

/**
 * 算力充值二级页：内容与网页端「算力充值」弹窗一致（同一数据源 getPublicContent），
 * 仅展示套餐 + 联系客服二维码 + 提示信息，人工办理、不提供在线支付。
 */
export default function RechargePage() {
  const { pageStyle } = useThemePage();

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '算力充值' });
  }, []);

  const state = useLoad(async (): Promise<RechargeData> => {
    const content = await getPublicContent();
    return {
      computePackages: Array.isArray(content?.computePackages) ? content.computePackages : [],
      rechargeInfo: typeof content?.rechargeInfo === 'string' ? content.rechargeInfo : '',
      customerService: content?.customerService && typeof content.customerService === 'object'
        ? {
          enabled: content.customerService.enabled !== false,
          qr: String(content.customerService.qr || ''),
          lines: Array.isArray(content.customerService.lines) ? content.customerService.lines : [],
        }
        : { enabled: false, qr: '', lines: [] },
    };
  }, []);

  const data = state.data;
  const packages = data?.computePackages || [];
  const qr = toAbsolute(data?.customerService.qr || '');
  const previewQr = () => {
    if (!qr) return;
    Taro.previewImage({ urls: [qr] }).catch(() => {});
  };

  return <View className='page mini-recharge-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>算力充值</Text>
      <Text className='mini-page-caption'>以下为当前可选的算力套餐。算力充值由客服人工办理，请扫码联系客服完成。</Text>
    </View>

    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />

    {!state.loading && !state.error && data && (
      <>
        {/* 算力套餐 */}
        <View className='mini-recharge-panel'>
          <Text className='mini-recharge-label'>算力套餐</Text>
          {packages.length === 0 ? (
            <View className='mini-recharge-empty'>后台暂未设置算力套餐</View>
          ) : (
            <View className='mini-recharge-list'>
              {packages.map((pkg) => (
                <View key={pkg.id} className='mini-recharge-card'>
                  <View className='mini-recharge-card-main'>
                    <View className='mini-recharge-card-left'>
                      <Text className='mini-recharge-card-name'>{pkg.name}</Text>
                      <Text className='mini-recharge-card-points'>{Number(pkg.points || 0).toLocaleString()} 点</Text>
                    </View>
                    <Text className='mini-recharge-card-price'>¥{pkg.price}</Text>
                  </View>
                  <View className='mini-recharge-card-foot'>
                    <Text className='mini-recharge-card-validity'>{validityText(pkg)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 联系客服充值 */}
        <View className='mini-recharge-panel'>
          <Text className='mini-recharge-label'>联系客服充值</Text>
          {qr ? (
            <Image
              className='mini-recharge-qr'
              src={qr}
              mode='aspectFit'
              showMenuByLongpress
              onClick={previewQr}
            />
          ) : (
            <View className='mini-recharge-qr mini-recharge-qr--empty'>后台未上传客服二维码</View>
          )}
          <Text className='mini-recharge-qr-tip'>点击放大 · 长按保存二维码，再用微信扫一扫添加客服</Text>
          {data.customerService.lines.length > 0 && (
            <View className='mini-recharge-lines'>
              {data.customerService.lines.map((line, index) => (
                <Text key={`${line}-${index}`} className='mini-recharge-line'>{line}</Text>
              ))}
            </View>
          )}
        </View>

        {/* 提示信息 */}
        <View className='mini-recharge-panel'>
          <Text className='mini-recharge-label'>提示信息</Text>
          {data.rechargeInfo && data.rechargeInfo.trim() ? (
            <Text className='mini-recharge-info'>{data.rechargeInfo}</Text>
          ) : (
            <Text className='mini-recharge-note'>暂无提示信息</Text>
          )}
        </View>
      </>
    )}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
