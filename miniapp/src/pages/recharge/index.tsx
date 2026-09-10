import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { createRechargeOrder, getPublicContent, getRechargeStatus } from '../../services/api';
import type { ComputePackage, VirtualPaymentParams } from '../../types';

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

/** 版本号比较：v1 > v2 返回 1，相等返回 0，小于返回 -1。 */
function compareVersion(v1: string, v2: string) {
  const a = String(v1 || '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(v2 || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

interface VirtualPayOptions {
  signData: string;
  paySig: string;
  signature: string;
  mode: string;
  success?: (res: unknown) => void;
  fail?: (err: { errMsg?: string; errCode?: number }) => void;
}

type VirtualPayBridge = (options: VirtualPayOptions) => void;

/** 虚拟支付要求基础库 ≥ 2.19.2；iOS 端还需微信客户端 ≥ 8.0.68。不满足时给出明确引导。 */
function ensureVirtualPaySupported() {
  const info = Taro.getSystemInfoSync();
  const sdkVersion = String(info.SDKVersion || '');
  if (compareVersion(sdkVersion, '2.19.2') < 0 && !Taro.canIUse('requestVirtualPayment')) {
    Taro.showModal({ title: '提示', content: '当前微信版本过低，请升级微信后再进行支付', showCancel: false });
    return false;
  }
  if (String(info.platform) === 'ios' && compareVersion(String(info.version || ''), '8.0.68') < 0) {
    Taro.showModal({ title: '提示', content: 'iOS 端请将微信更新至 8.0.68 及以上版本后再支付', showCancel: false });
    return false;
  }
  return true;
}

/** Taro 未封装 requestVirtualPayment：优先取 Taro 上的实现，否则回落到小程序全局 wx。 */
function resolveVirtualPayBridge(): VirtualPayBridge | null {
  const taroScope = Taro as unknown as { requestVirtualPayment?: VirtualPayBridge };
  if (typeof taroScope.requestVirtualPayment === 'function') return taroScope.requestVirtualPayment.bind(Taro);
  const globalScope = (typeof globalThis === 'undefined' ? undefined : globalThis) as unknown as {
    wx?: { requestVirtualPayment?: VirtualPayBridge };
  };
  const api = globalScope && globalScope.wx ? globalScope.wx.requestVirtualPayment : undefined;
  return typeof api === 'function' ? api : null;
}

/** 拉起虚拟支付。signData 必须原样透传服务端签名串，不能重新序列化。 */
function requestVirtualPayment(params: VirtualPaymentParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const bridge = resolveVirtualPayBridge();
    if (!bridge) {
      reject(new Error('当前微信版本不支持虚拟支付，请升级微信后再试'));
      return;
    }
    bridge({
      signData: params.signData,
      paySig: params.paySig,
      signature: params.signature,
      mode: params.mode,
      success: () => resolve(),
      fail: (err) => {
        const message = String((err && err.errMsg) || '');
        if (message.includes('cancel') || Number(err && err.errCode) === -2) {
          reject(new Error('cancel'));
          return;
        }
        reject(new Error(message || '支付失败，请稍后重试'));
      },
    });
  });
}

/**
 * 算力充值二级页：套餐列表 + 微信虚拟支付（道具直购）。
 * 套餐与网页端「算力充值」弹窗同源（getPublicContent → computePackages）。
 * 支付成功后由微信发货推送 + 服务端查单兜底完成加算力，前端轮询订单状态确认到账。
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

  /** 支付后轮询订单状态确认到账（发货推送异步，服务端每次轮询都会查单兜底，最多 ~10s）。 */
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
    if (!ensureVirtualPaySupported()) return;
    setPayingId(pkg.id);
    try {
      const order = await createRechargeOrder(pkg.id);
      // success 回调只代表「支付操作完成」，不能作为发货依据；到账以服务端订单状态为准。
      await requestVirtualPayment(order.virtualPay);
      await waitPaid(order.orderId);
      Taro.showToast({ title: '充值成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1200);
    } catch (error) {
      if (error instanceof Error && error.message === 'cancel') {
        Taro.showToast({ title: '已取消支付', icon: 'none' });
        return;
      }
      const msg = error instanceof Error ? error.message : '';
      Taro.showToast({ title: msg || '支付失败，请稍后重试', icon: 'none', duration: 2500 });
    } finally {
      setPayingId(null);
    }
  };

  return <View className='page mini-recharge-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>算力充值</Text>
      <Text className='mini-page-caption'>选择算力套餐，微信支付，即时到账</Text>
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
