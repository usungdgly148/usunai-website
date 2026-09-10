import { useEffect, useState } from 'react';
import { BadgeCheck, KeyRound } from 'lucide-react';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, PrimaryButton } from '../adminUI.jsx';

const PUSH_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 随机字符串（Token 用）。必须走 crypto.getRandomValues：
 * 这两个值都是密钥类字段，Math.random 可预测，不能用于此。
 * 字符集限定 A-Za-z0-9，避免进 XML / URL / 微信后台输入框时需要转义。
 */
function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += PUSH_CHARS[bytes[i] % PUSH_CHARS.length];
  return out;
}

/**
 * EncodingAESKey：微信硬性要求 43 位、且 base64 解码后恰好 32 字节（AES-256 key）。
 * 纯字符集随机拼 43 位不保证这条（长度错一位 → 解码 31 字节 → 解密全线失败），
 * 所以反过来做：32 随机字节 → base64 → 去掉 '=' → 必然是 43 位 / 32 字节。
 */
function randomAesKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '');
}

/** 校验 EncodingAESKey：必须 43 位且 base64 解码为 32 字节。 */
function aesKeyIssue(value) {
  const key = String(value || '').trim();
  if (!key) return '未填写，安全模式下推送报文无法解密';
  if (key.length !== 43) return `当前 ${key.length} 位，微信要求 43 位`;
  try {
    if (atob(`${key}=`).length !== 32) return 'base64 解码不是 32 字节，请点「随机生成」重取';
  } catch {
    return '不是合法 base64，请点「随机生成」重取';
  }
  return '';
}

/**
 * 小程序设置：微信支付凭证（APIv3 密钥 / 商户证书序列号 / 商户 API 私钥）
 * 与虚拟支付配置（OfferID / 现网 AppKey / 环境）。
 * 凭证存服务端 KV（miniappPaySettings / miniappVirtualPaySettings），仅管理员可读写；
 * 读回脱敏（密钥只显示「已设置」），留空保存时保留原值，避免回显脱敏后误清空。
 */
export default function AdminMiniappSettings() {
  const [serialNo, setSerialNo] = useState('');
  const [apiV3Key, setApiV3Key] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [apiV3KeySet, setApiV3KeySet] = useState(false);
  const [privateKeySet, setPrivateKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  // 虚拟支付（算力充值走道具直购）
  const [vpOfferId, setVpOfferId] = useState('');
  const [vpAppKey, setVpAppKey] = useState('');
  const [vpPushToken, setVpPushToken] = useState('');
  const [vpAesKey, setVpAesKey] = useState('');
  const [vpEnv, setVpEnv] = useState(0);
  const [vpAppKeySet, setVpAppKeySet] = useState(false);
  const [vpConfigured, setVpConfigured] = useState(false);
  const [vpSaving, setVpSaving] = useState(false);
  const [vpMsg, setVpMsg] = useState(null);

  const load = async () => {
    try {
      const r = await adminFetch('/api/admin/miniapp-pay-settings');
      const j = await r.json();
      if (j && j.ok && j.data) {
        setSerialNo(j.data.serialNo || '');
        setConfigured(!!j.data.configured);
        setApiV3KeySet(!!j.data.apiV3KeySet);
        setPrivateKeySet(!!j.data.privateKeySet);
      }
    } catch (e) {
      setMsg({ ok: false, msg: '读取配置失败：' + (e.message || e) });
    }
    try {
      const r = await adminFetch('/api/admin/miniapp-virtual-pay-settings');
      const j = await r.json();
      if (j && j.ok && j.data) {
        setVpOfferId(j.data.offerId || '');
        setVpPushToken(j.data.pushToken || '');
        setVpAesKey(j.data.encodingAesKey || '');
        setVpEnv(Number(j.data.env) === 1 ? 1 : 0);
        setVpAppKeySet(!!j.data.appKeySet);
        setVpConfigured(!!j.data.configured);
      }
    } catch (e) {
      setVpMsg({ ok: false, msg: '读取虚拟支付配置失败：' + (e.message || e) });
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const key = apiV3Key.trim();
    if (key && key.length !== 32) {
      setMsg({ ok: false, msg: 'APIv3 密钥必须是 32 位（当前 ' + key.length + ' 位），请从微信商户平台「账户中心 → API 安全 → APIv3 密钥」获取' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await adminFetch('/api/admin/miniapp-pay-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNo, apiV3Key, privateKey }),
      });
      const j = await r.json();
      if (!j || !j.ok) throw new Error(j && j.msg ? j.msg : '保存失败');
      setConfigured(!!(j.data && j.data.configured));
      setApiV3KeySet(!!apiV3Key || apiV3KeySet);
      setPrivateKeySet(!!privateKey || privateKeySet);
      setApiV3Key('');
      setPrivateKey('');
      setMsg({ ok: true, msg: '已保存' });
    } catch (e) {
      setMsg({ ok: false, msg: '保存失败：' + (e.message || e) });
    } finally {
      setSaving(false);
    }
  };

  const saveVirtualPay = async () => {
    setVpSaving(true);
    setVpMsg(null);
    try {
      const r = await adminFetch('/api/admin/miniapp-virtual-pay-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: vpOfferId, appKey: vpAppKey, pushToken: vpPushToken, encodingAesKey: vpAesKey, env: vpEnv }),
      });
      const j = await r.json();
      if (!j || !j.ok) throw new Error(j && j.msg ? j.msg : '保存失败');
      setVpConfigured(!!(j.data && j.data.configured));
      setVpAppKeySet(!!vpAppKey || vpAppKeySet);
      setVpAppKey('');
      setVpMsg({ ok: true, msg: '已保存' });
    } catch (e) {
      setVpMsg({ ok: false, msg: '保存失败：' + (e.message || e) });
    } finally {
      setVpSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="小程序设置"
        subtitle="配置小程序「算力充值」的支付能力：虚拟支付（道具直购，当前启用）与微信支付凭证。凭证仅管理员可见，保存后支付接口自动读取。"
      />

      <Card className="p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <KeyRound size={18} className="text-blue-600" />
          <h2 className="font-semibold text-slate-800">微信支付凭证</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          商户号 <span className="font-mono text-slate-700">1728733415</span> · 小程序 AppID{' '}
          <span className="font-mono text-slate-700">wx4f071fbfd1e51130</span>。以下三项填写完整后即完成支付配置。
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">商户证书序列号（serial_no）</label>
            <input
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              placeholder="如 40 位大写十六进制字符串"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">APIv3 密钥（32 位）</label>
            <input
              type="password"
              autoComplete="new-password"
              name="apiV3Key"
              value={apiV3Key}
              onChange={(e) => setApiV3Key(e.target.value)}
              placeholder={apiV3KeySet ? '已设置（留空则不修改）' : '输入 32 位 APIv3 密钥'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            {apiV3KeySet && <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1"><BadgeCheck size={13} /> 已配置，留空保存将保留原值</p>}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">商户 API 私钥（apiclient_key.pem 全文）</label>
            <textarea
              rows={8}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={privateKeySet ? '已设置（留空则不修改）' : '粘贴 apiclient_key.pem 的完整内容，含 -----BEGIN/END----- 行'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 resize-y"
            />
            {privateKeySet && <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1"><BadgeCheck size={13} /> 已配置，留空保存将保留原值</p>}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </PrimaryButton>
          {msg && (
            <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.msg}</span>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2.5 mb-1">
          <BadgeCheck size={18} className="text-blue-600" />
          <h2 className="font-semibold text-slate-800">虚拟支付（算力充值）</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          小程序内虚拟商品必须走「虚拟支付」。到 MP 后台
          <span className="text-slate-700">【虚拟支付 → 基本配置】</span>取 OfferID 与现网 AppKey；
          <span className="text-slate-700">【道具管理】</span>为每个算力套餐创建并发布道具（单价单位为分），
          道具 ID 填到「算力管理」的套餐里。
        </p>
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mb-5 text-xs text-slate-600 space-y-1">
          <div className="font-medium text-slate-700 mb-1">发货推送要把下面三项填到 MP 后台「虚拟支付 → 基本配置 → 发货推送配置」：</div>
          <div>1. URL：<span className="font-mono text-slate-800 break-all">https://usunai.top/api/miniapp/v1/recharge/virtual-notify</span></div>
          <div>2. Token 与 EncodingAESKey：用下方「随机生成」生成后复制过去，<span className="text-slate-700">两边必须完全一致</span></div>
          <div>3. 消息加密方式选「安全模式」、数据格式选「XML」（本服务安全模式与明文模式都支持）</div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">OfferID</label>
            <input
              value={vpOfferId}
              onChange={(e) => setVpOfferId(e.target.value)}
              placeholder="虚拟支付 → 基本配置 → OfferID"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">AppKey（须与所选环境匹配）</label>
            <input
              type="password"
              autoComplete="new-password"
              name="virtualPayAppKey"
              value={vpAppKey}
              onChange={(e) => setVpAppKey(e.target.value)}
              placeholder={vpAppKeySet ? '已设置（留空则不修改）' : '虚拟支付 → 基本配置 → 现网 AppKey'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            {vpAppKeySet && <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1"><BadgeCheck size={13} /> 已配置，留空保存将保留原值</p>}
          </div>

          <div>
            <label className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>发货推送 Token（1-32 位）</span>
              <button type="button" onClick={() => setVpPushToken(randomString(32))} className="text-blue-600 hover:underline">随机生成</button>
            </label>
            <input
              value={vpPushToken}
              onChange={(e) => setVpPushToken(e.target.value)}
              placeholder="生成后复制到 MP 后台发货推送配置的 Token 栏"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>EncodingAESKey（43 位，安全模式用）</span>
              <button type="button" onClick={() => setVpAesKey(randomAesKey())} className="text-blue-600 hover:underline">随机生成</button>
            </label>
            <input
              value={vpAesKey}
              onChange={(e) => setVpAesKey(e.target.value)}
              placeholder="生成后复制到 MP 后台发货推送配置的 EncodingAESKey 栏（须 43 位）"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            {aesKeyIssue(vpAesKey) ? (
              <p className="mt-1 text-xs text-amber-600">⚠ {aesKeyIssue(vpAesKey)}</p>
            ) : (
              <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1"><BadgeCheck size={13} /> 43 位 / base64 解码 32 字节，可用</p>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">环境</label>
            <select
              value={vpEnv}
              onChange={(e) => setVpEnv(Number(e.target.value))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value={0}>现网环境 env=0（正式，iOS 也走这里）</option>
              <option value={1}>沙箱环境 env=1（仅 Android 可调，AppKey 需用沙箱的）</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <PrimaryButton onClick={saveVirtualPay} disabled={vpSaving}>
            {vpSaving ? '保存中…' : '保存虚拟支付配置'}
          </PrimaryButton>
          {vpMsg && (
            <span className={`text-sm ${vpMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{vpMsg.msg}</span>
          )}
        </div>

        <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${vpConfigured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {vpConfigured ? '✓ 虚拟支付已配置齐全，充值下单可正常发起' : '⚠ 尚未配置齐全（需 OfferID + AppKey，且服务器已配置小程序 AppSecret）'}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2.5 mb-3">
          <KeyRound size={18} className="text-slate-400" />
          <h2 className="font-semibold text-slate-800">当前状态</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">证书序列号</div>
            <div className="mt-1 text-sm font-mono text-slate-800 truncate" title={serialNo}>{serialNo || '未设置'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">APIv3 密钥</div>
            <div className={`mt-1 text-sm font-semibold ${apiV3KeySet ? 'text-emerald-600' : 'text-slate-400'}`}>{apiV3KeySet ? '已设置' : '未设置'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">商户 API 私钥</div>
            <div className={`mt-1 text-sm font-semibold ${privateKeySet ? 'text-emerald-600' : 'text-slate-400'}`}>{privateKeySet ? '已设置' : '未设置'}</div>
          </div>
        </div>
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {configured ? '✓ 支付凭证已齐全，小程序算力充值可正常发起支付' : '⚠ 凭证尚未配置齐全，充值下单将提示「微信支付尚未配置」'}
        </div>
      </Card>
    </div>
  );
}
