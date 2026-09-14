import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, KeyRound, Share2 } from 'lucide-react';
import { adminFetch } from '../authFetch.js';
import { tryUploadToBlob } from '../blobUpload.js';
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
 * 小程序设置：微信支付凭证（APIv3 密钥 / 商户证书序列号 / 商户 API 私钥）、
 * 虚拟支付配置（OfferID / 现网 AppKey / 环境），以及分享设置（转发卡片标题 / 落地路径 / 配图）。
 * 凭证存服务端 KV（miniappPaySettings / miniappVirtualPaySettings），仅管理员可读写；
 * 读回脱敏（密钥只显示「已设置」），留空保存时保留原值，避免回显脱敏后误清空。
 * 分享设置存 miniappShareSettings，随小程序内容接口下发 —— 改标题不必重新发版，
 * 所以这一块与上面两块相反：**明文回显、留空即清空**（清空 = 回退内置默认文案）。
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
  // 分享设置（转发卡片：标题 / 落地路径 / 配图）。三项都为明文，留空即回退内置默认。
  const [shareTitle, setShareTitle] = useState('');
  const [sharePath, setSharePath] = useState('');
  const [shareImageUrl, setShareImageUrl] = useState('');
  const [shareConfigured, setShareConfigured] = useState(false);
  const [shareUploading, setShareUploading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareMsg, setShareMsg] = useState(null);
  const shareFileRef = useRef(null);

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
    try {
      const r = await adminFetch('/api/admin/miniapp-share-settings');
      const j = await r.json();
      if (j && j.ok && j.data) {
        setShareTitle(j.data.title || '');
        setSharePath(j.data.path || '');
        setShareImageUrl(j.data.imageUrl || '');
        setShareConfigured(!!j.data.configured);
      }
    } catch (e) {
      setShareMsg({ ok: false, msg: '读取分享设置失败：' + (e.message || e) });
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

  const uploadShareImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    // 先清空 input：不清空的话，连续选同一张图第二次不会触发 change，看起来像「点了没反应」。
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setShareMsg({ ok: false, msg: '请选择 PNG / JPG 图片' });
      return;
    }
    setShareUploading(true);
    setShareMsg(null);
    try {
      // 走与其它后台图片同一套上传：存到对象存储，返回 /api/blob/serve?key=… 相对地址。
      // 失败时返回 null（不抛错），所以要显式判一次。
      const url = await tryUploadToBlob(file, { admin: true });
      if (!url) throw new Error('上传失败：对象存储未启用或图片过大');
      setShareImageUrl(url);
      setShareMsg({ ok: true, msg: '图片已上传，记得点下面的「保存分享设置」' });
    } catch (error) {
      setShareMsg({ ok: false, msg: error.message || '图片上传失败' });
    } finally {
      setShareUploading(false);
    }
  };

  const saveShare = async () => {
    setShareSaving(true);
    setShareMsg(null);
    try {
      const r = await adminFetch('/api/admin/miniapp-share-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: shareTitle, path: sharePath, imageUrl: shareImageUrl }),
      });
      const j = await r.json();
      if (!j || !j.ok) throw new Error(j && j.msg ? j.msg : '保存失败');
      if (j.data) {
        // 以服务端校验后的值为准回写（路径会被 trim、超长会被截断），避免界面与落库不一致。
        setShareTitle(j.data.title || '');
        setSharePath(j.data.path || '');
        setShareImageUrl(j.data.imageUrl || '');
        setShareConfigured(!!j.data.configured);
      }
      setShareMsg({ ok: true, msg: '已保存 · 小程序下次进入（最长 5 分钟）生效' });
    } catch (e) {
      setShareMsg({ ok: false, msg: '保存失败：' + (e.message || e) });
    } finally {
      setShareSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="小程序设置"
        subtitle="小程序的支付能力（虚拟支付 / 微信支付凭证）与「转发分享」卡片设置。支付凭证仅管理员可见；分享设置存服务端，改完不必重新构建、重新上传小程序。"
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
        <div className="flex items-center gap-2.5 mb-1">
          <Share2 size={18} className="text-blue-600" />
          <h2 className="font-semibold text-slate-800">分享设置（转发给朋友 / 朋友圈）</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          对应小程序右上角「··· → 转发」卡片上的三样东西：标题、点开后的落地页、配图。
          存服务端并随小程序内容一起下发，<span className="text-slate-700">改完不用重新构建、重新上传小程序</span>，
          用户下次打开小程序（最长 5 分钟）自动生效。
          三项都留空 = 用内置默认：标题「智能体名 · 友尚AI」、落点跟随用户当前所在页面、配图截当前页。
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">分享标题</label>
            <input
              value={shareTitle}
              onChange={(e) => setShareTitle(e.target.value)}
              placeholder="留空 = 「智能体名 · 友尚AI」；填写后所有页面统一用这个标题"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-slate-400">最多 60 字。填写后是全局统一标题；留空则按语境自动拼（详情页 / 对话页会带上对应的智能体名）。</p>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">点开卡片打开的页面（path）</label>
            <input
              value={sharePath}
              onChange={(e) => setSharePath(e.target.value)}
              placeholder="留空 = 跟随用户当前所在页面，例：/pages/home/index"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              必须是本小程序的页面，形如 <span className="font-mono">/pages/home/index</span>，可带参数（<span className="font-mono">/pages/detail/index?id=xxx</span>）。
              留空时，用户在详情页 / 分类页转发出去，点开仍落在原来那一页。
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">卡片配图（imageUrl）</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={shareImageUrl}
                onChange={(e) => setShareImageUrl(e.target.value)}
                placeholder="留空 = 微信截取当前页面；也可粘贴 https 外链"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => shareFileRef.current && shareFileRef.current.click()}
                disabled={shareUploading}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-blue-300 hover:text-blue-600 disabled:opacity-60"
              >
                {shareUploading ? '上传中…' : '上传图片'}
              </button>
              <input ref={shareFileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadShareImage} />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              微信按 5:4 展示，建议 500×400 的 PNG / JPG。点「上传图片」存到本站图床；也可以填 https 外链。
              <span className="text-amber-600">不能填小程序包内路径</span>（如微信文档示例里的 /images/share.png —— 后台改不了代码包，填了只会得到一张加载失败的卡片）。
            </p>
            {shareImageUrl && (
              <div className="mt-3 flex items-center gap-3">
                <img src={shareImageUrl} alt="分享配图预览" className="h-16 w-20 rounded-lg border border-slate-200 object-cover" />
                <button type="button" onClick={() => setShareImageUrl('')} className="text-xs text-rose-600 hover:underline">移除图片</button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <PrimaryButton onClick={saveShare} disabled={shareSaving}>
            {shareSaving ? '保存中…' : '保存分享设置'}
          </PrimaryButton>
          {shareMsg && (
            <span className={`text-sm ${shareMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{shareMsg.msg}</span>
          )}
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
        <div className={`mt-3 rounded-lg px-4 py-3 text-sm font-medium ${shareConfigured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
          {shareConfigured
            ? '✓ 分享设置已配置，转发卡片按上面填写的标题 / 落地页 / 配图展示'
            : '· 分享设置未配置，使用内置默认：标题「智能体名 · 友尚AI」、落点跟随当前页面、配图截当前页'}
        </div>
      </Card>
    </div>
  );
}
