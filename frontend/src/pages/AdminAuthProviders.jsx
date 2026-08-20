import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { AdminPageHeader, Card, PrimaryButton, SecondaryButton, Modal, StatusBadge } from '../adminUI.jsx';
import { KeyRound, Plus, Pencil, Trash2, Plug, ShieldCheck, ShieldAlert, Info, Loader2 } from 'lucide-react';
import { testPatConnection, testApiTokenConnection, testOAuthConnection } from '../cozeApi.js';

const TYPE_LABEL = { apitoken: 'API Token（部署服务）', pat: 'PAT 个人令牌', oauth: 'coze 老版（OAuth 模式）' };
const BASE_URL_OPTIONS = [
  { value: 'https://api.coze.cn', label: 'api.coze.cn（国内版）' },
  { value: 'https://api.coze.com', label: 'api.coze.com（国际版）' },
];

const blankForm = {
  name: '',
  type: 'oauth',
  baseUrl: 'https://api.coze.cn',
  apiKey: '',
  clientId: '',
  keyId: '',
  privateKey: '',
};

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 font-mono';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';

export default function AdminAuthProviders() {
  const { authProviders, addAuthProvider, updateAuthProvider, deleteAuthProvider, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [testing, setTesting] = useState(null); // provider id 或 'new'（仅控制按钮禁用）
  const [testTarget, setTestTarget] = useState(null); // 记录最近被测试的授权，用于展示结果
  const [testResult, setTestResult] = useState(null); // {ok, msg}
  const [toast, setToast] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const openNew = () => { setForm(blankForm); setEditingId(null); setTestResult(null); setModalOpen(true); };
  const openEdit = (p) => {
    setForm({ ...blankForm, ...p, privateKey: p.privateKey || '' });
    setEditingId(p.id);
    setTestResult(null);
    setModalOpen(true);
  };

  const save = () => {
    if (!form.name.trim()) { showToast('请填写授权名称'); return; }
    const baseUrl = form.baseUrl.trim();
    if ((form.type === 'apitoken' || form.type === 'pat') && (!baseUrl || !form.apiKey.trim())) {
      showToast('请填写 Base URL 和 Token'); return;
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      showToast('Base URL 需以 http:// 或 https:// 开头'); return;
    }
    if (form.type === 'oauth' && (!form.clientId.trim() || !form.keyId.trim() || !form.privateKey.trim())) {
      showToast('OAuth 模式请填写 Client ID / 公钥指纹(kid) / 私钥'); return;
    }
    const final = { ...form, baseUrl };
    if (form.type === 'pat' && !baseUrl) final.baseUrl = 'https://api.coze.cn';
    if (editingId) updateAuthProvider(editingId, final);
    else addAuthProvider(final);
    setModalOpen(false);
    showToast('已保存授权');
  };

  const runTest = async (p, isNew) => {
    const target = isNew ? 'new' : p.id;
    setTestTarget(target);
    setTesting(target);
    setTestResult(null);
    try {
      if (p.type === 'apitoken') {
        const r = await testApiTokenConnection(p);
        if (!r.ok) {
          setTestResult({ ok: false, msg: '无法连接：' + (r.error || '网络/CORS 错误，请检查 Base URL 或代理配置') });
        } else if (r.status === 200) {
          setTestResult({ ok: true, msg: '连接成功，可正常调用部署服务' });
        } else if (r.status === 401 || r.status === 403) {
          setTestResult({ ok: false, msg: `已连通部署服务，但 Token 无效或权限不足（${r.status}），请检查 API Token` });
        } else {
          setTestResult({ ok: false, msg: `已连通部署服务，但接口返回 ${r.status}，请确认 Project ID 或请求参数` });
        }
      } else if (p.type === 'pat') {
        const r = await testPatConnection(p);
        if (!r.ok) {
          setTestResult({ ok: false, msg: '无法连接扣子官方 API：' + (r.error || '网络/CORS 错误，请检查代理配置') });
        } else if (r.status === 200) {
          setTestResult({ ok: true, msg: 'PAT 连接成功，可调用旧版 Bot API（/v3/chat）' });
        } else if (r.status === 401 || r.status === 403) {
          setTestResult({ ok: false, msg: `已连通扣子官方 API，但 PAT 无效或权限不足（${r.status}），请检查 PAT 令牌` });
        } else {
          setTestResult({ ok: false, msg: `已连通扣子官方 API，但接口返回 ${r.status}，请检查 Base URL` });
        }
      } else if (p.type === 'oauth') {
        const r = await testOAuthConnection({
          baseUrl: p.baseUrl,
          clientId: p.clientId,
          keyId: p.keyId,
          privateKey: p.privateKey,
        });
        if (!r.ok) {
          // 后端已把扣子的英文错误翻译成中文可操作提示（r.error），r.raw 保留原始响应
          setTestResult({ ok: false, msg: r.error || 'OAuth 连接失败：服务端生成 JWT 或连接扣子失败' });
        } else if (r.msg) {
          setTestResult({ ok: true, msg: r.msg });
        } else if (r.status === 200) {
          setTestResult({ ok: true, msg: 'OAuth JWT 连接成功，服务端可正常调用扣子旧版 API' });
        } else if (r.status === 401 || r.status === 403) {
          setTestResult({ ok: false, msg: `已连通扣子官方 API，但 JWT 鉴权失败（${r.status}），请检查 Client ID / 公钥指纹(kid) / 私钥` });
        } else {
          setTestResult({ ok: false, msg: `已连通扣子官方 API，但接口返回 ${r.status}，请检查 Base URL` });
        }
      }
    } catch (e) {
      setTestResult({ ok: false, msg: '请求异常：' + (e.message || e) });
    } finally {
      setTesting(null);
    }
  };

  const doDelete = () => {
    if (!confirmDel) return;
    deleteAuthProvider(confirmDel);
    setConfirmDel(null);
    showToast('已删除授权');
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="AI 授权管理"
        subtitle="统一管理扣子（Coze）授权凭证，上架智能体 / 工作流时直接选择授权账号，无需重复填写密钥。"
        actions={<PrimaryButton onClick={openNew} className="gap-1.5"><Plus size={16} /> 新增授权</PrimaryButton>}
      />

      {/* 说明 */}
      <Card className="p-5 bg-blue-50/40 border-blue-100">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-600 leading-relaxed">
            <div className="font-medium text-slate-800 mb-1">三种授权模式</div>
            <div>
              <span className="font-medium text-slate-700">API Token（部署服务）</span>：对应扣子编程项目部署后的 API Token，配合 Project ID 调用 /stream_run，适合新版 code.coze.cn 项目。
            </div>
            <div className="mt-1">
              <span className="font-medium text-slate-700">PAT 个人令牌</span>：对应扣子旧版 Bot API（/v3/chat），需要 Bot ID。新版扣子编程项目没有 Bot ID。
            </div>
            <div className="mt-1">
              <span className="font-medium text-slate-700">OAuth JWT</span>：适用于扣子企业版 / Web SDK，需要私钥签名生成令牌，<span className="text-rose-600 font-medium">必须由后端代理完成签名与转发</span>，第一阶段仅保存配置。
            </div>
          </div>
        </div>
      </Card>

      {authProviders.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 mx-auto mb-4">
            <KeyRound size={26} />
          </div>
          <div className="text-slate-500 font-medium">还没有任何授权</div>
          <div className="text-sm text-slate-400 mt-1 mb-5">点击右上角「新增授权」添加你的第一个扣子授权</div>
          <PrimaryButton onClick={openNew} className="gap-1.5"><Plus size={16} /> 新增授权</PrimaryButton>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {authProviders.map(p => (
            <Card key={p.id} className="p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${p.type === 'oauth' ? 'bg-blue-50 text-blue-600' : p.type === 'pat' ? 'bg-violet-50 text-violet-600' : 'bg-slate-50 text-slate-600'}`}>
                    <KeyRound size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                    <div className="text-xs text-slate-400 truncate font-mono">{p.baseUrl}</div>
                  </div>
                </div>
                <StatusBadge status={p.status || 'active'} activeText="已启用" inactiveText="已停用" />
              </div>

              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">{TYPE_LABEL[p.type]}</span>
                {(p.type === 'apitoken' || p.type === 'pat') && p.apiKey ? (
                  <span className="text-xs text-slate-400 font-mono">Token: {p.apiKey.slice(0, 6)}••••</span>
                ) : p.type === 'oauth' ? (
                  <span className="text-xs text-slate-400 font-mono">Client: {p.clientId}</span>
                ) : null}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-2">
                <SecondaryButton onClick={() => runTest(p, false)} disabled={testing === p.id} className="text-xs px-3 py-2 gap-1.5">
                  {testing === p.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                  测试连接
                </SecondaryButton>
                <SecondaryButton onClick={() => openEdit(p)} className="text-xs px-3 py-2 gap-1.5"><Pencil size={14} /> 编辑</SecondaryButton>
                <button onClick={() => setConfirmDel(p.id)} className="ml-auto p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition">
                  <Trash2 size={15} />
                </button>
              </div>

              {testResult && testTarget === p.id && (
                <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                  {testResult.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                  {testResult.msg}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 新增 / 编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑授权' : '新增授权'}
        footer={
          <>
            <SecondaryButton onClick={() => setModalOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={save}>保存</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>授权名称</label>
            <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="如：我的扣子主账号" className={inputCls.replace('font-mono', '')} />
          </div>

          <div>
            <label className={labelCls}>平台类型</label>
            <div className="text-sm font-medium text-slate-900 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
              {TYPE_LABEL[form.type]}
            </div>
          </div>

          <div>
            <label className={labelCls}>授权类型</label>
            <div className="grid grid-cols-3 gap-3">
              {['apitoken', 'pat', 'oauth'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set({ type: t, baseUrl: t === 'pat' && !form.baseUrl.trim() ? 'https://api.coze.cn' : (form.baseUrl || 'https://api.coze.cn') })}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition ${form.type === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>API 域名（Base URL）</label>
            <select value={form.baseUrl} onChange={e => set({ baseUrl: e.target.value })} className={inputCls}>
              {BASE_URL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">旧版扣子 Bot API 官方地址</p>
          </div>

          {form.type === 'oauth' ? (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>应用 ID（Client ID）</label>
                <input value={form.clientId} onChange={e => set({ clientId: e.target.value })} placeholder="OAuth 应用客户端 ID" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>公钥指纹（kid）</label>
                <input value={form.keyId} onChange={e => set({ keyId: e.target.value })} placeholder="OAuth 应用配置页的「公钥指纹」" className={inputCls} />
                <p className="text-xs text-slate-400 mt-1">即 JWT 头里的 <code className="font-mono">kid</code>，必须与下方私钥对应（在扣子「授权 → OAuth 应用」配置页查看）。</p>
              </div>
              <div>
                <label className={labelCls}>私钥（Private Key）</label>
                <textarea value={form.privateKey} onChange={e => set({ privateKey: e.target.value })} rows={5} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----" className={`${inputCls} resize-none`} />
                <p className="text-xs text-rose-500 mt-1">私钥仅由后端代理用于 RSA 签名，浏览器不直接拿它调扣子；请妥善保管，勿泄露。</p>
                <p className="text-xs text-slate-400 mt-1">粘贴从 Coze「OAuth 应用」下载的 private_key.pem 全文（含 BEGIN/END 行）。</p>
              </div>
            </div>
          ) : (
            <div>
              <label className={labelCls}>{form.type === 'apitoken' ? 'API Token' : 'PAT（个人访问令牌）'}</label>
              <input type="password" value={form.apiKey} onChange={e => set({ apiKey: e.target.value })} placeholder={form.type === 'apitoken' ? '填写扣子部署页面创建的 API Token' : 'pat_xxxxxxxx'} className={inputCls} />
              <p className="text-xs text-slate-400 mt-1">{form.type === 'apitoken' ? '扣子项目 → 部署 → API Token → 创建 Token' : '扣子控制台 → API & SDK → 授权 → 个人访问令牌'}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <SecondaryButton
              onClick={() => runTest({ ...form }, true)}
              disabled={testing === 'new' || (form.type === 'oauth' ? (!form.clientId.trim() || !form.keyId.trim() || !form.privateKey.trim()) : (!form.baseUrl.trim() || !form.apiKey.trim()))}
              className="text-xs gap-1.5"
            >
              {testing === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              测试连接
            </SecondaryButton>
            {testResult && testTarget === 'new' && (
              <span className={`text-xs flex items-center gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                {testResult.ok ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                {testResult.msg}
              </span>
            )}
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="确认删除"
        footer={
          <>
            <SecondaryButton onClick={() => setConfirmDel(null)}>取消</SecondaryButton>
            <button onClick={doDelete} className="px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition">删除</button>
          </>
        }
      >
        <p className="text-sm text-slate-600">删除后，引用该授权的智能体将无法调用扣子。确认删除此授权？</p>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
