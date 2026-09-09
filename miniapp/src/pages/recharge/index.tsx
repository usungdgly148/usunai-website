import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { createRechargeOrder, getPublicContent, getRechargeStatus } from '../../services/api';
import type { ComputePackage } from '../../types';

interface RechargeData {
  computePackages: ComputePackage[];
  rechargeInfo: string;
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

/**
 * 算力充值二级页：套餐列表 + 微信在线支付。
 * 套餐与网页端「算力充值」弹窗同源（getPublicContent → computePackages），
 * 选套餐后走微信 JSAPI 支付，不再需要联系客服人工办理。
 */
export default function RechargePage() {
  const { pageStyle } = useThemePage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '算力充值' });
  }, []);

  const state = useLoad(async (): Promise<RechargeData> => {
    const content = await getPublicContent();
    return {
      computePackages: Array.isArray(content?.computePackages)
        ? content.computePackages.filter((pkg) => pkg.published !== false)
        : [],
      rechargeInfo: typeof content?.rechargeInfo === 'string' ? content.rechargeInfo : '',
    };
  }, []);

  const data = state.data;
  const packages = data?.computePackages || [];

  /** 支付成功后轮询订单状态，确认已到账（微信回调异步，最多轮询 ~10s）。 */
  const waitPaid = async (orderId: string) => {
    for (let i = 0; i < 10; i++) {
      const status = await getRechargeStatus(orderId);
      if (status.status === 'paid') return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const handlePay = async () => {
    if (payingId) return;
    const pkg = packages.find((item) => item.id === selectedId);
    if (!pkg) {
      Taro.showToast({ title: '请先选择套餐', icon: 'none' });
      return;
    }
    setPayingId(pkg.id);
    try {
      const order = await createRechargeOrder(pkg.id);
      try {
        await Taro.requestPayment({
          timeStamp: order.payParams.timeStamp,
          nonceStr: order.payParams.nonceStr,
          package: order.payParams.package,
          signType: order.payParams.signType,
          paySign: order.payParams.paySign,
        });
      } catch (payError) {
        const errMsg = String((payError as { errMsg?: unknown })?.errMsg || (payError as Error)?.message || '');
        if (errMsg.includes('cancel')) {
          Taro.showToast({ title: '已取消支付', icon: 'none' });
          return;
        }
        throw payError;
      }
      // 用户已确认支付，等待回调落库确认到账。
      await waitPaid(order.orderId);
      Taro.showToast({ title: '充值成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      Taro.showToast({ title: msg || '支付失败，请稍后重试', icon: 'none', duration: 2500 });
    } finally {
      setPayingId(null);
    }
  };

  return <View className='page mini-recharge-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>算力充值</Text>
      <Text className='mini-page-caption'>选择算力套餐，微信在线支付，即时到账</Text>
    </View>

    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />

    {!state.loading && !state.error && data && (
      <>
        <View className='mini-recharge-panel'>
          <Text className='mini-recharge-label'>算力套餐</Text>
          {packages.length === 0 ? (
            <View className='mini-recharge-empty'>后台暂未设置算力套餐</View>
          ) : (
            <View className='mini-recharge-list'>
              {packages.map((pkg) => {
                const selected = selectedId === pkg.id;
                return (
                  <View
                    key={pkg.id}
                    className={`mini-recharge-card${selected ? ' mini-recharge-card--selected' : ''}`}
                    onClick={() => setSelectedId(pkg.id)}
                  >
                    <View className='mini-recharge-card-main'>
                      <View className='mini-recharge-card-left'>
                        <Text className='mini-recharge-card-name'>{pkg.name}</Text>
                        <Text className='mini-recharge-card-points'>{Number(pkg.points || 0).toLocaleString()} 点</Text>
                      </View>
                      <View className='mini-recharge-card-right'>
                        <Text className='mini-recharge-card-price'>¥{pkg.price}</Text>
                        <View className='mini-recharge-radio'>
                          <View className='mini-recharge-radio-dot' />
                        </View>
                      </View>
                    </View>
                    <View className='mini-recharge-card-foot'>
                      <Text className='mini-recharge-card-validity'>{validityText(pkg)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View className='mini-recharge-footer'>
          <Button
            className='mini-recharge-pay mini-recharge-pay--full'
            disabled={!selectedId || payingId !== null}
            loading={payingId !== null}
            onClick={handlePay}
          >{payingId ? '支付中' : '立即支付'}</Button>
        </View>

        {data.rechargeInfo && data.rechargeInfo.trim() ? (
          <View className='mini-recharge-panel'>
            <Text className='mini-recharge-label'>提示信息</Text>
            <Text className='mini-recharge-info'>{data.rechargeInfo}</Text>
          </View>
        ) : null}
      </>
    )}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
