import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { ApiError, createRechargeOrder, getMe, getPublicContent, getRechargeStatus, isLoggedOut, refreshMiniappSession } from '../../services/api';
import type { ComputePackage, UserProfile, VirtualPaymentParams } from '../../types';
import { shareTargets } from '../../utils/share';

interface RechargeData {
  computePackages: ComputePackage[];
  rechargeInfo: string;
  /** 当前登录用户（用于顶部算力余额卡）；未登录或接口异常时为 null，只隐藏余额卡 */
  profile: UserProfile | null;
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

/** 千分位：与「我的」页 formatPoints 同规则（toLocaleString 在小程序端表现不一致，勿用）。 */
function formatPoints(value: number) {
  return String(Math.max(0, Math.trunc(Number(value) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 套餐名自带徽标 emoji（后台命名为「🥈 银卡 / 🥇 金卡 / 👑 至尊卡」）。
 * 拆成「emoji 徽标 + 纯文本名」：emoji 上移到卡片左上角圆形徽标里，标题只留文字。
 * 用代理对区间匹配而非 \u{...}（后者需要 u 标志，小程序端转译不保证支持）。
 */
const BADGE_EMOJI = /^(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2B00-\u2BFF]|\uFE0F|\u200D)+\s*/;

function splitPackageName(name: string) {
  const raw = String(name || '').trim();
  const matched = raw.match(BADGE_EMOJI);
  if (!matched) return { badge: '', label: raw };
  const label = raw.slice(matched[0].length).trim();
  // 名称整体就是 emoji（没有文字）时保留原名，别渲染成空标题
  return { badge: matched[0].trim(), label: label || raw };
}

/** 后台「充值提示信息」是带序号的多行文本 → 逐行去掉序号，作为权益清单条目。 */
function splitInfoLines(text: string) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+\s*[.、)）]\s*/, ''))
    .filter(Boolean);
}

/**
 * 是否「试用套餐」（每用户限购一次）。
 * ⚠️ 必须与服务端 server/plan-access.mjs 的 isTrialPackage 同规则：开关优先 + 名称含「试用」兜底。
 * 线上「免费试用」套餐没有 trial 字段，只认开关会让客户端的「已购买」标记完全失效。
 */
const TRIAL_PLAN_PATTERN = /试用/;

function isTrialPackage(pkg?: ComputePackage | null) {
  if (!pkg) return false;
  return pkg.trial === true || TRIAL_PLAN_PATTERN.test(String(pkg.name || ''));
}

/**
 * 服务端「试用套餐已购过」的错误码与文案，跨端契约（定义在 server/plan-access.mjs）。
 * 服务端把这个码回过来时前端必须弹窗，不能退化成 toast —— 用户会以为是网络问题而反复重试。
 *
 * ⚠️ 文案必须与服务端的 `TRIAL_ALREADY_PURCHASED_MESSAGE` **逐字一致**：
 *    本页有两条路径会弹这个窗（本地预拦 / 服务端 409 兜底），文案只留这一份常量共用，
 *    否则两条路径措辞漂移、用户看到两套说法。`scripts/check-plan-access.mjs` 会断言一致性。
 */
const TRIAL_ALREADY_PURCHASED_CODE = 'TRIAL_ALREADY_PURCHASED';
const TRIAL_ALREADY_PURCHASED_MESSAGE = '「免费试用」套餐每位用户仅限购买一次，请选择其它套餐。';

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

/** 虚拟支付失败错误：保留 errCode 便于区分「签名失效」「道具未发布」等场景 */
class VirtualPayError extends Error {
  constructor(message: string, public errCode = 0) {
    super(message);
  }
}

/**
 * 是否为「用户态签名校验失败」——即服务端持有的 session_key 已失效。
 * 微信每次登录都会刷新 session_key，旧密钥会让 signature/paySig 对不上；
 * 这类错误可以靠「重新登录换新密钥 + 重试一次」恢复，不需要用户手动干预。
 */
function isVirtualPaySignatureError(error: unknown) {
  if (!(error instanceof VirtualPayError)) return false;
  return /sign|签名/i.test(`${error.message} ${error.errCode}`);
}

/**
 * 微信虚拟支付原始报错（形如 `requestVirtualPayment:fail SOME_UPPER_CODE`）→ 人话。
 * 运营/测试期最容易撞上的几个码先覆盖，未命中则原样透出，方便继续排查。
 */
const VIRTUAL_PAY_HINTS: Array<[RegExp, string]> = [
  [/COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY/, '道具刚在微信后台创建，约 10 分钟后才生效，请稍后再试'],
  [/COIN_OR_PRODUCT_ID_NOT_EXIST|PRODUCT_ID_NOT_EXIST|COIN_ID_NOT_EXIST|NOT_EXIST/, '微信后台还没有这个道具，请先在「虚拟支付 → 道具管理」创建并发布'],
  [/NOT_PUBLISHED|NOT_ONLINE|NOT_EFFECTIVE/, '道具尚未发布生效，请在微信后台提交发布并等待通过'],
  [/GOODS_PRICE|PRICE_NOT_MATCH|INVALID_PRICE|PRICE_ERROR/, '道具价格与套餐价格不一致，请核对微信后台的道具价格'],
  [/INVALID_BUY_QUANTITY/, '购买数量无效，请稍后重试'],
  [/SESSION_?KEY/, '登录态已失效，请重新进入小程序后再试'],
  [/INSUFFICIENT|BALANCE_NOT_ENOUGH/, '账户余额不足'],
  [/FREQUENCY|TOO_MANY_REQUEST/, '操作过于频繁，请稍后再试'],
  [/SIGNATURE_INVALID|SIGN_ERROR/, '支付签名校验失败，请重新进入小程序后再试'],
];

/** 把虚拟支付报错转成可读文案；命中映射时 `hint=true`（表示这是我们给出的处置建议，而非原始码） */
function describeVirtualPayError(error: unknown): { text: string; hint: boolean } {
  const raw = error instanceof Error ? error.message : '';
  if (!raw) return { text: '支付失败，请稍后重试', hint: false };
  for (const [pattern, tip] of VIRTUAL_PAY_HINTS) {
    if (pattern.test(raw)) return { text: tip, hint: true };
  }
  return { text: raw, hint: false };
}

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
        reject(new VirtualPayError(message || '支付失败，请稍后重试', Number(err && err.errCode) || 0));
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
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets();
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: '算力充值' });
  }, []);

  const state = useLoad(async (): Promise<RechargeData> => {
    const [content, profile] = await Promise.all([
      getPublicContent(),
      // 余额卡是加分项：未登录或接口异常时只隐藏它，不能让整页充值流程跟着报错
      isLoggedOut() ? Promise.resolve(null) : getMe().catch(() => null),
    ]);
    return {
      computePackages: Array.isArray(content?.computePackages)
        ? content.computePackages.filter((pkg) => pkg.published !== false)
        : [],
      rechargeInfo: typeof content?.rechargeInfo === 'string' ? content.rechargeInfo : '',
      profile: profile || null,
    };
  }, []);

  const data = state.data;
  const packages = data?.computePackages || [];
  const infoLines = splitInfoLines(data?.rechargeInfo || '');
  /** 「免费试用」是否已用过（服务端判定，含上线前买入的老数据）→ 试用套餐卡片转「已购买」态 */
  const trialUsed = data?.profile?.trialPurchased === true;

  /** 权益卡右侧箭头指向「联系客服」——权益里的「使用咨询和专属技术支持」正落在这个页面。 */
  const openService = () => {
    void Taro.navigateTo({ url: '/pages/service/index' });
  };

  /** 已购过试用再点它：用弹窗说清原因（不是静默无反应），并引导改选其它套餐。 */
  const showTrialUsed = () => {
    void Taro.showModal({
      title: '每个账号仅限购买一次',
      content: TRIAL_ALREADY_PURCHASED_MESSAGE,
      showCancel: false,
      confirmText: '知道了',
    });
  };

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
    // 本地先拦一道：已经买过试用就不必再走下单/支付，直接弹窗说明（服务端还有一道 409 硬拦截）。
    if (isTrialPackage(pkg) && trialUsed) {
      showTrialUsed();
      setSelectedId(null);
      return;
    }
    if (!ensureVirtualPaySupported()) return;
    setPayingId(pkg.id);
    /** 下单 → 拉起支付 → 轮询到账；签名失效重试时整体重跑（需重新下单拿新的签名串）。 */
    const runPayFlow = async () => {
      const order = await createRechargeOrder(pkg.id);
      // success 回调只代表「支付操作完成」，不能作为发货依据；到账以服务端订单状态为准。
      await requestVirtualPayment(order.virtualPay);
      await waitPaid(order.orderId);
    };
    try {
      try {
        await runPayFlow();
      } catch (error) {
        // session_key 失效导致的签名校验失败：静默重新登录换新密钥后重试一次。
        if (isVirtualPaySignatureError(error)) {
          await refreshMiniappSession();
          await runPayFlow();
        } else {
          throw error;
        }
      }
      Taro.showToast({ title: '充值成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 1200);
    } catch (error) {
      if (error instanceof Error && error.message === 'cancel') {
        Taro.showToast({ title: '已取消支付', icon: 'none' });
        return;
      }
      // 服务端「试用套餐每用户限购一次」的硬拦截：必须弹窗（toast 会被误当成网络抖动），
      // 并刷新一次档案 —— 刷新后该卡片会自动转成「已购买」态。
      if (error instanceof ApiError && error.code === TRIAL_ALREADY_PURCHASED_CODE) {
        setSelectedId(null);
        void state.reload();
        Taro.showModal({
          title: '每个账号仅限购买一次',
          content: error.message || TRIAL_ALREADY_PURCHASED_MESSAGE,
          showCancel: false,
          confirmText: '换一个套餐',
        });
        return;
      }
      const { text, hint } = describeVirtualPayError(error);
      // 命中的是我们给出的处置建议（偏长且需要看清）→ 用弹窗；未识别的原始报错 → 用短 toast。
      if (hint) {
        Taro.showModal({ title: '暂时无法支付', content: text, showCancel: false, confirmText: '知道了' });
      } else {
        Taro.showToast({ title: text || '支付失败，请稍后重试', icon: 'none', duration: 3000 });
      }
    } finally {
      setPayingId(null);
    }
  };

  return <View className='page mini-recharge-page' style={pageStyle}>
    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />

    {!state.loading && !state.error && data && (
      <>
        {/* ① 算力余额卡：与「我的」页共用 .mini-points-* 视觉，进页先看到「我还有多少算力」 */}
        {data.profile ? (
          <View className='mini-recharge-balance'>
            <View className='mini-points-icon-wrap'><View className='mini-points-icon ui-icon-power' /></View>
            <View className='mini-points-main'>
              <Text className='mini-points-kicker'>算力点数</Text>
              <View className='mini-points-value'>
                <Text className='mini-points-number'>{formatPoints(data.profile.points)}</Text>
                <Text className='mini-points-unit'>点</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ② 选择套餐：两列网格；套餐名自带的 emoji 直接当左上角徽标 */}
        <Text className='mini-recharge-section-title'>选择套餐</Text>
        {packages.length === 0 ? (
          <View className='mini-recharge-empty'>后台暂未设置算力套餐</View>
        ) : (
          <View className='mini-recharge-grid'>
            {packages.map((pkg) => {
              const selected = selectedId === pkg.id;
              // 试用套餐 + 已经买过 → 转「已购买」态：不可选中，点了用弹窗说明原因
              const used = trialUsed && isTrialPackage(pkg);
              const { badge, label } = splitPackageName(pkg.name);
              return (
                <View
                  key={pkg.id}
                  className={`mini-recharge-card${selected ? ' mini-recharge-card--selected' : ''}${used ? ' mini-recharge-card--used' : ''}`}
                  onClick={() => (used ? showTrialUsed() : setSelectedId(pkg.id))}
                >
                  <View className='mini-recharge-card-head'>
                    <View className='mini-recharge-badge'>
                      {badge
                        ? <Text className='mini-recharge-badge-emoji'>{badge}</Text>
                        : <View className='mini-recharge-badge-icon ui-icon-power' />}
                    </View>
                    <Text className='mini-recharge-card-name'>{label}</Text>
                    <View className='mini-recharge-check' />
                  </View>
                  <Text className='mini-recharge-card-points'>{formatPoints(pkg.points)} 点</Text>
                  <Text className='mini-recharge-card-price'>¥{pkg.price}</Text>
                  <Text className={`mini-recharge-card-validity${used ? ' mini-recharge-card-validity--used' : ''}`}>
                    {used ? '已购买 · 每人限购 1 次' : validityText(pkg)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ③ 通栏支付按钮 */}
        <Button
          className='mini-recharge-pay mini-recharge-pay--full'
          disabled={!selectedId || payingId !== null}
          loading={payingId !== null}
          onClick={handlePay}
        >{payingId ? '支付中' : '立即支付'}</Button>

        {/* ④ VIP 会员权益：内容 = 后台「充值提示信息」逐行拆成条目 */}
        {infoLines.length ? (
          <View className='mini-recharge-vip' onClick={openService}>
            <View className='mini-recharge-vip-head'>
              <View className='mini-recharge-vip-badge'><View className='mini-recharge-vip-crown ui-icon-vip' /></View>
              <Text className='mini-recharge-vip-title'>VIP 会员权益</Text>
              <View className='mini-recharge-vip-arrow' />
            </View>
            <View className='mini-recharge-vip-list'>
              {infoLines.map((line, index) => (
                <View key={`${index}-${line}`} className='mini-recharge-vip-item'>
                  <View className='mini-recharge-vip-tick' />
                  <Text className='mini-recharge-vip-text'>{line}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </>
    )}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
