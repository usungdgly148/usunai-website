import Taro from '@tarojs/taro';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { API_BASE, getPublicContent } from '../services/api';
import type { ComputePackage, PublicContent } from '../types';

const ABSENT_STATE: Pick<PublicContent, 'computePackages' | 'rechargeInfo' | 'customerService'> = {
  computePackages: [],
  rechargeInfo: '',
  customerService: { enabled: false, qr: '', lines: [] },
};

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
 * 算力充值弹窗：仅展示套餐与联系客服（人工办理，非在线支付）。
 * 结构参照网页端 RechargeDialog：套餐卡列表 + 联系客服（二维码/说明）+ 提示信息。
 */
export function RechargeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Pick<PublicContent, 'computePackages' | 'rechargeInfo' | 'customerService'>>(ABSENT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible || loaded) return;
    let alive = true;
    setLoaded(true);
    getPublicContent()
      .then((content) => {
        if (!alive) return;
        setSection({
          computePackages: Array.isArray(content?.computePackages) ? content.computePackages : [],
          rechargeInfo: typeof content?.rechargeInfo === 'string' ? content.rechargeInfo : '',
          customerService: content?.customerService && typeof content.customerService === 'object'
            ? { enabled: content.customerService.enabled !== false, qr: String(content.customerService.qr || ''), lines: Array.isArray(content.customerService.lines) ? content.customerService.lines : [] }
            : ABSENT_STATE.customerService,
        });
      })
      .catch(() => { if (alive) setSection(ABSENT_STATE); });
    return () => { alive = false; };
  }, [visible, loaded]);

  const packages = section.computePackages;
  const qr = toAbsolute(section.customerService.qr || '');
  const previewQr = () => {
    if (!qr) return;
    Taro.previewImage({ urls: [qr] }).catch(() => {});
  };

  return (
    <t-popup
      visible={visible}
      placement='bottom'
      showOverlay
      closeOnOverlayClick
      onVisibleChange={(event: { detail?: { visible?: boolean } }) => {
        if (!event.detail?.visible) onClose();
      }}
    >
      <View className='mini-recharge-sheet'>
        <View className='mini-recharge-sheet-head'>
          <Text className='mini-recharge-sheet-title'>算力充值</Text>
          <Text className='mini-recharge-sheet-close' onClick={onClose}>✕</Text>
        </View>
        <Text className='mini-recharge-sheet-sub'>以下为当前可选的算力套餐。算力充值由客服人工办理，请扫码联系客服完成。</Text>

        <ScrollView scrollY className='mini-recharge-scroll'>
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

          {/* 联系客服 + 提示信息 */}
          <View className='mini-recharge-grid'>
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
              {section.customerService.lines.length > 0 && (
                <View className='mini-recharge-lines'>
                  {section.customerService.lines.map((line, index) => (
                    <Text key={`${line}-${index}`} className='mini-recharge-line'>{line}</Text>
                  ))}
                </View>
              )}
            </View>
            <View className='mini-recharge-panel'>
              <Text className='mini-recharge-label'>提示信息</Text>
              {section.rechargeInfo && section.rechargeInfo.trim() ? (
                <Text className='mini-recharge-info'>{section.rechargeInfo}</Text>
              ) : (
                <Text className='mini-recharge-note'>暂无提示信息</Text>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </t-popup>
  );
}
