import { useEffect, useState } from 'react';
import { BadgeCheck, KeyRound } from 'lucide-react';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, PrimaryButton } from '../adminUI.jsx';

/**
 * 小程序设置：微信支付凭证（APIv3 密钥 / 商户证书序列号 / 商户 API 私钥）。
 * 凭证存服务端 KV（miniappPaySettings），仅管理员可读写；读回脱敏（密钥/私钥只显示「已设置」），
 * 留空保存时保留原值，避免回显脱敏后误清空。
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="小程序设置"
        subtitle="配置微信支付凭证，用于小程序「算力充值」的在线支付。凭证仅管理员可见，保存后支付接口自动读取。"
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
