import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Pencil, Plug, Plus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useStore } from '../store.jsx';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, Modal, PrimaryButton, SecondaryButton, StatusBadge } from '../adminUI.jsx';
import { testApiTokenConnection, testOAuthConnection, testPatConnection } from '../cozeApi.js';

const TYPES = {
  apitoken: 'Coze 新版 API Token', pat: 'Coze 旧版 PAT', oauth: 'Coze 旧版 OAuth',
  deepseek: 'DeepSeek 原生模型', 'bailian-embedding': '百炼向量模型',
  // 外部大模型中转站：Base URL 与 API Key 都由这里统一配置，智能体只引用凭证。
  relay: '外部大模型中转站',
};
const blank = { name: '', type: 'oauth', baseUrl: 'https://api.coze.cn', apiKey: '', clientId: '', keyId: '', privateKey: '', status: 'active', model: '', dimensions: 1024 };
const inputClass = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

async function postJson(url, body) {
  const response = await adminFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function AdminAuthProviders() {
  const { authProviders, addAuthProvider, updateAuthProvider, deleteAuthProvider, refreshAllConfig } = useStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  // 「AI全能设计」的图片处理授权：来自 /api/admin/image-gen/providers，与用户页配置接口
  // 共用服务端 resolveImageProvider() —— 这里显示的「生效中」就是用户页真实在用的那条。
  // 每条中转授权自带实时探测到的 imageModels / available / error，不写死任何授权 id 或名称。
  const [imageAuth, setImageAuth] = useState(null);
  const loadImageAuth = async () => {
    try {
      const response = await adminFetch('/api/admin/image-gen/providers', { cache: 'no-store' });
      const data = await response.json();
      if (data.ok) setImageAuth(data);
    } catch { /* 授权页仍可正常管理凭证，只是不显示生图联动信息 */ }
  };
  useEffect(() => { refreshAllConfig(); loadImageAuth(); }, [refreshAllConfig]);

  const setImageProvider = async (providerId) => {
    setBusy(`image-${providerId}`);
    setResult(null);
    try {
      const data = await postJson('/api/admin/image-gen/provider', { providerId });
      await loadImageAuth();
      await refreshAllConfig();
      const chosen = (data.providers || []).find((p) => p.id === providerId);
      setResult({
        ok: true,
        text: data.reason
          ? `已指定「${chosen?.name || providerId}」为图片处理授权，用户页按实际生效的可用模型更新；${data.reason}`
          : `已将「${chosen?.name || providerId}」设为 AI全能设计 的图片处理授权，用户页刷新即生效`,
      });
    } catch (error) { setResult({ ok: false, text: error.message }); }
    finally { setBusy(''); }
  };

  const effectiveInfo = (imageAuth?.providers || []).find((p) => p.id === imageAuth?.effectiveProviderId) || null;

  const set = patch => setForm(value => ({ ...value, ...patch }));
  const chooseType = type => {
    const defaults = type === 'deepseek'
      ? { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }
      : type === 'relay'
        // 中转站的 Base URL 由使用者填写；OpenAI 兼容地址一般带 /v1，不填 /v1 时服务端会自动补。
        ? { baseUrl: 'https://api.easy88ai.com/v1', model: '' }
        : type === 'bailian-embedding'
          ? { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-text-embedding', dimensions: 1024 }
          : { baseUrl: 'https://api.coze.cn' };
    set({ type, ...defaults }); setResult(null);
  };
  const beginNew = () => { setEditingId(''); setForm(blank); setResult(null); setOpen(true); };
  const beginEdit = provider => { setEditingId(provider.id); setForm({ ...blank, ...provider, apiKey: '', privateKey: provider.privateKey || '' }); setResult(null); setOpen(true); };

  const validate = () => {
    if (!form.name.trim()) return '请填写授权名称';
    if (!/^https:\/\//i.test(form.baseUrl || '')) return 'Base URL 必须使用 HTTPS';
    if (form.type === 'oauth' && (!form.clientId.trim() || !form.keyId.trim() || (!editingId && !form.privateKey.trim()))) return '请填写 Client ID、kid 和私钥';
    if (['apitoken', 'pat', 'deepseek', 'bailian-embedding', 'relay'].includes(form.type) && !editingId && !form.apiKey.trim()) return '请填写 API Key / Token';
    return '';
  };
  const save = async () => {
    const error = validate(); if (error) return setResult({ ok: false, text: error });
    setBusy('save');
    try {
      const payload = { ...form, name: form.name.trim(), baseUrl: form.baseUrl.trim() };
      let savedId;
      if (editingId) {
        const ok = await updateAuthProvider(editingId, payload);
        savedId = ok ? editingId : '';
      } else {
        savedId = await addAuthProvider(payload);
      }
      if (!savedId) throw new Error('保存失败');
      setOpen(false); setResult(null);
      // 新增/编辑/换密钥都会改变图片授权候选及其可用模型，必须重新探测一次。
      await refreshAllConfig(); await loadImageAuth();
    } catch (error) { setResult({ ok: false, text: error.message }); }
    finally { setBusy(''); }
  };
  const test = async provider => {
    const target = provider.id || 'new';
    setBusy(target); setResult(null);
    try {
      let data;
      if (provider.type === 'deepseek') data = await postJson('/api/deepseek/test', provider.id ? { authProviderId: provider.id } : { apiKey: provider.apiKey });
      else if (provider.type === 'relay') data = await postJson('/api/admin/relay/test', provider.id ? { authProviderId: provider.id } : { baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      else if (provider.type === 'bailian-embedding') {
        if (!provider.id) throw new Error('请先保存百炼凭证，再测试连接');
        data = await postJson('/api/bailian/embedding/test', { authProviderId: provider.id });
      } else if (provider.type === 'oauth') data = await testOAuthConnection(provider);
      else if (provider.type === 'pat') data = await testPatConnection(provider);
      else data = await testApiTokenConnection(provider);
      if (!data?.ok) throw new Error(data?.error || `连接失败${data?.status ? `（${data.status}）` : ''}`);
      setResult({ target, ok: true, text: provider.type === 'bailian-embedding' ? `连接成功：qwen3.7-text-embedding，${data.dimensions || 1024} 维` : (provider.type === 'relay' && data.msg ? data.msg : '连接成功，凭证有效') });
    } catch (error) { setResult({ target, ok: false, text: error.message }); }
    finally { setBusy(''); }
  };
  const remove = async id => {
    if (!window.confirm('确认删除该授权凭证吗？')) return;
    try {
      const ok = await deleteAuthProvider(id);
      if (!ok) throw new Error('删除失败');
      // 删掉的可能是当前生效的图片授权：服务端会自动 fallback，这里刷新后展示新的生效项。
      await refreshAllConfig(); await loadImageAuth();
    }
    catch (error) { setResult({ ok: false, text: error.message }); }
  };

  return <div className="space-y-6">
    <AdminPageHeader title="AI 授权管理" subtitle="统一管理 Coze、DeepSeek 与百炼向量凭证，并可把任意中转站授权指定为「AI全能设计」的图片处理授权。真实密钥只加密保存在服务器，浏览器和智能体配置均不保存明文。" actions={<PrimaryButton onClick={beginNew}><Plus size={16} />新增授权</PrimaryButton>} />
    {result && !open && <div className={`rounded-xl px-4 py-3 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.text}</div>}
    {imageAuth && (
      <div className={`rounded-xl px-4 py-3 text-sm ${imageAuth.reason || !imageAuth.effectiveProviderId ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'}`}>
        <span className="font-medium">AI全能设计 · 图片处理授权：</span>
        {imageAuth.effectiveProviderId
          ? <>当前生效「{effectiveInfo?.name || imageAuth.effectiveProviderId}」，该授权下 {effectiveInfo?.imageModels?.length || 0} 个可用图片模型。用户页的模型列表按这条授权实时过滤；要换一条，点下方中转站卡片的「设为图片授权」。</>
          : <>暂无可用的图片处理授权，请新增或启用一条包含图片模型的中转站授权。</>}
        {imageAuth.reason && <div className="mt-1">{imageAuth.reason}</div>}
      </div>
    )}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {authProviders.map(provider => {
        const imageInfo = provider.type === 'relay'
          ? (imageAuth?.providers || []).find((p) => p.id === provider.id)
          : null;
        const isCurrent = !!imageAuth && imageAuth.effectiveProviderId === provider.id;
        const isConfigured = !!imageAuth && imageAuth.configuredProviderId === provider.id;
        return <Card key={provider.id} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3 min-w-0"><div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex shrink-0 items-center justify-center"><KeyRound size={18} /></div><div className="min-w-0"><div className="font-semibold truncate">{provider.name}</div><div className="text-xs text-slate-400 truncate">{provider.baseUrl}</div></div></div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isCurrent && <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">图片授权·生效中</span>}
              <StatusBadge status={provider.status || 'active'} activeText="已启用" inactiveText="已停用" />
            </div>
          </div>
          <div className="mt-4 flex gap-2 flex-wrap"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{TYPES[provider.type] || provider.type}</span>{provider.hasApiKey && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">密钥已加密保存</span>}</div>
          {provider.type === 'relay' && (
            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="text-xs font-medium text-slate-600">AI全能设计 · 可用图片模型</div>
              {imageInfo?.available
                ? <div className="mt-1.5 flex flex-wrap gap-1.5">{(imageInfo.imageModels || []).map((id) => <span key={id} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">{id}</span>)}</div>
                : <div className="mt-1 text-xs text-amber-700">{imageInfo?.error || '未启用或缺少密钥，暂不属于图片处理授权候选'}</div>}
              {isConfigured && !isCurrent && <div className="mt-1.5 text-xs text-amber-700">这是后台指定的授权，但当前不可用；用户页已自动切换到其他可用授权。</div>}
            </div>
          )}
          <div className="mt-5 pt-4 border-t border-slate-100 flex gap-2 flex-wrap">
            <SecondaryButton disabled={busy === provider.id} onClick={() => test(provider)}>{busy === provider.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}测试连接</SecondaryButton>
            <SecondaryButton onClick={() => beginEdit(provider)}><Pencil size={14} />编辑</SecondaryButton>
            {provider.type === 'relay' && !isCurrent && (
              <SecondaryButton disabled={busy === `image-${provider.id}`} onClick={() => setImageProvider(provider.id)}>
                {busy === `image-${provider.id}` ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}设为图片授权
              </SecondaryButton>
            )}
            <button className="ml-auto text-slate-400 hover:text-rose-600" onClick={() => remove(provider.id)}><Trash2 size={16} /></button>
          </div>
          {result?.target === provider.id && <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{result.text}</div>}
        </Card>;
      })}
      {!authProviders.length && <Card className="col-span-full p-12 text-center text-sm text-slate-400">还没有授权凭证</Card>}
    </div>

    <Modal open={open} onClose={() => setOpen(false)} title={editingId ? '编辑授权' : '新增授权'} footer={<><SecondaryButton onClick={() => setOpen(false)}>取消</SecondaryButton><PrimaryButton disabled={busy === 'save'} onClick={save}>{busy === 'save' ? '保存中…' : '保存'}</PrimaryButton></>}>
      <div className="space-y-4">
        <input className={inputClass} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="授权名称" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{Object.entries(TYPES).map(([type, label]) => <button key={type} type="button" onClick={() => chooseType(type)} className={`rounded-xl border px-3 py-2 text-sm ${form.type === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{label}</button>)}</div>
        <input className={inputClass} value={form.baseUrl} onChange={e => set({ baseUrl: e.target.value })} placeholder="Base URL" readOnly={form.type === 'deepseek'} />
        {form.type === 'relay' && <p className="text-xs text-slate-500">填写中转站的 OpenAI 兼容地址，例如 <span className="font-mono">https://api.easy88ai.com/v1</span>。只填域名时会自动补 <span className="font-mono">/v1</span>。这里配置的 Base URL 与 API Key 会被所有引用该凭证的智能体共用。</p>}
        {form.type === 'oauth' ? <div className="space-y-3"><input className={inputClass} value={form.clientId} onChange={e => set({ clientId: e.target.value })} placeholder="Client ID" /><input className={inputClass} value={form.keyId} onChange={e => set({ keyId: e.target.value })} placeholder="公钥指纹 kid" /><textarea className={`${inputClass} resize-none font-mono text-xs`} rows={6} value={form.privateKey} onChange={e => set({ privateKey: e.target.value })} placeholder={editingId ? '留空则保留服务器中的原私钥' : '-----BEGIN PRIVATE KEY-----'} /></div> : <input type="password" autoComplete="new-password" className={inputClass} value={form.apiKey} onChange={e => set({ apiKey: e.target.value })} placeholder={editingId && form.hasApiKey ? '留空则保留服务器中的原密钥' : 'API Key / Token'} />}
        {form.type === 'bailian-embedding' && <div className="grid grid-cols-2 gap-3"><input className={inputClass} value="qwen3.7-text-embedding" readOnly /><input className={inputClass} value="1024 维" readOnly /></div>}
        {form.type === 'deepseek' && <div className="space-y-2">
          <select className={inputClass} value={form.model || 'deepseek-flash'} onChange={e => set({ model: e.target.value })}>
            <option value="deepseek-flash">deepseek-flash</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          </select>
          <p className="text-xs text-slate-500">可选模型（2026-09-10 官方起）：deepseek-flash 为 V4.1 Flash，原生多模态；deepseek-v4-pro 不支持图片。此处仅作记录，实际调用模型由「智能体编辑 → 模型」决定。</p>
        </div>}
        {result && (!result.target || result.target === 'new' || result.target === editingId) && <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{result.text}</div>}
        <SecondaryButton disabled={busy === 'new'} onClick={() => test({ ...form, ...(editingId ? { id: editingId } : {}) })}>{busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}测试连接</SecondaryButton>
      </div>
    </Modal>
  </div>;
}
