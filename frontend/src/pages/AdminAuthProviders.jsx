import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Pencil, Plug, Plus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useStore } from '../store.jsx';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, Modal, PrimaryButton, SecondaryButton, StatusBadge } from '../adminUI.jsx';
import { testApiTokenConnection, testOAuthConnection, testPatConnection } from '../cozeApi.js';

const TYPES = {
  apitoken: 'Coze 新版 API Token', pat: 'Coze 旧版 PAT', oauth: 'Coze 旧版 OAuth',
  deepseek: 'DeepSeek 原生模型', 'bailian-embedding': '百炼向量模型',
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
  const { authProviders, addAuthProvider, updateAuthProvider, deleteAuthProvider, refreshAllAdminLists, refreshAllConfig } = useStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);

  const set = patch => setForm(value => ({ ...value, ...patch }));
  const chooseType = type => {
    const defaults = type === 'deepseek'
      ? { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }
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
    if (['apitoken', 'pat', 'deepseek', 'bailian-embedding'].includes(form.type) && !editingId && !form.apiKey.trim()) return '请填写 API Key / Token';
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
      setOpen(false); setResult(null); await refreshAllAdminLists();
    } catch (error) { setResult({ ok: false, text: error.message }); }
    finally { setBusy(''); }
  };
  const test = async provider => {
    const target = provider.id || 'new';
    setBusy(target); setResult(null);
    try {
      let data;
      if (provider.type === 'deepseek') data = await postJson('/api/deepseek/test', provider.id ? { authProviderId: provider.id } : { apiKey: provider.apiKey });
      else if (provider.type === 'bailian-embedding') {
        if (!provider.id) throw new Error('请先保存百炼凭证，再测试连接');
        data = await postJson('/api/bailian/embedding/test', { authProviderId: provider.id });
      } else if (provider.type === 'oauth') data = await testOAuthConnection(provider);
      else if (provider.type === 'pat') data = await testPatConnection(provider);
      else data = await testApiTokenConnection(provider);
      if (!data?.ok) throw new Error(data?.error || `连接失败${data?.status ? `（${data.status}）` : ''}`);
      setResult({ target, ok: true, text: provider.type === 'bailian-embedding' ? `连接成功：qwen3.7-text-embedding，${data.dimensions || 1024} 维` : '连接成功，凭证有效' });
    } catch (error) { setResult({ target, ok: false, text: error.message }); }
    finally { setBusy(''); }
  };
  const remove = async id => {
    if (!window.confirm('确认删除该授权凭证吗？')) return;
    try {
      const ok = await deleteAuthProvider(id);
      if (!ok) throw new Error('删除失败');
      await refreshAllAdminLists();
    }
    catch (error) { setResult({ ok: false, text: error.message }); }
  };

  return <div className="space-y-6">
    <AdminPageHeader title="AI 授权管理" subtitle="统一管理 Coze、DeepSeek 与百炼向量凭证。真实密钥只加密保存在服务器，浏览器和智能体配置均不保存明文。" actions={<PrimaryButton onClick={beginNew}><Plus size={16} />新增授权</PrimaryButton>} />
    {result && !open && <div className={`rounded-xl px-4 py-3 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.text}</div>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {authProviders.map(provider => <Card key={provider.id} className="p-5">
        <div className="flex items-start justify-between gap-3"><div className="flex gap-3 min-w-0"><div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><KeyRound size={18} /></div><div className="min-w-0"><div className="font-semibold truncate">{provider.name}</div><div className="text-xs text-slate-400 truncate">{provider.baseUrl}</div></div></div><StatusBadge status={provider.status || 'active'} activeText="已启用" inactiveText="已停用" /></div>
        <div className="mt-4 flex gap-2 flex-wrap"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{TYPES[provider.type] || provider.type}</span>{provider.hasApiKey && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">密钥已加密保存</span>}</div>
        <div className="mt-5 pt-4 border-t border-slate-100 flex gap-2"><SecondaryButton disabled={busy === provider.id} onClick={() => test(provider)}>{busy === provider.id ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}测试连接</SecondaryButton><SecondaryButton onClick={() => beginEdit(provider)}><Pencil size={14} />编辑</SecondaryButton><button className="ml-auto text-slate-400 hover:text-rose-600" onClick={() => remove(provider.id)}><Trash2 size={16} /></button></div>
        {result?.target === provider.id && <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{result.text}</div>}
      </Card>)}
      {!authProviders.length && <Card className="col-span-full p-12 text-center text-sm text-slate-400">还没有授权凭证</Card>}
    </div>

    <Modal open={open} onClose={() => setOpen(false)} title={editingId ? '编辑授权' : '新增授权'} footer={<><SecondaryButton onClick={() => setOpen(false)}>取消</SecondaryButton><PrimaryButton disabled={busy === 'save'} onClick={save}>{busy === 'save' ? '保存中…' : '保存'}</PrimaryButton></>}>
      <div className="space-y-4">
        <input className={inputClass} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="授权名称" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{Object.entries(TYPES).map(([type, label]) => <button key={type} type="button" onClick={() => chooseType(type)} className={`rounded-xl border px-3 py-2 text-sm ${form.type === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>{label}</button>)}</div>
        <input className={inputClass} value={form.baseUrl} onChange={e => set({ baseUrl: e.target.value })} placeholder="Base URL" readOnly={form.type === 'deepseek'} />
        {form.type === 'oauth' ? <div className="space-y-3"><input className={inputClass} value={form.clientId} onChange={e => set({ clientId: e.target.value })} placeholder="Client ID" /><input className={inputClass} value={form.keyId} onChange={e => set({ keyId: e.target.value })} placeholder="公钥指纹 kid" /><textarea className={`${inputClass} resize-none font-mono text-xs`} rows={6} value={form.privateKey} onChange={e => set({ privateKey: e.target.value })} placeholder={editingId ? '留空则保留服务器中的原私钥' : '-----BEGIN PRIVATE KEY-----'} /></div> : <input type="password" autoComplete="new-password" className={inputClass} value={form.apiKey} onChange={e => set({ apiKey: e.target.value })} placeholder={editingId && form.hasApiKey ? '留空则保留服务器中的原密钥' : 'API Key / Token'} />}
        {form.type === 'bailian-embedding' && <div className="grid grid-cols-2 gap-3"><input className={inputClass} value="qwen3.7-text-embedding" readOnly /><input className={inputClass} value="1024 维" readOnly /></div>}
        {form.type === 'deepseek' && <select className={inputClass} value={form.model || 'deepseek-v4-flash'} onChange={e => set({ model: e.target.value })}><option value="deepseek-v4-flash">deepseek-v4-flash</option><option value="deepseek-v4-pro">deepseek-v4-pro</option></select>}
        {result && (!result.target || result.target === 'new' || result.target === editingId) && <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{result.ok ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{result.text}</div>}
        <SecondaryButton disabled={busy === 'new'} onClick={() => test({ ...form, ...(editingId ? { id: editingId } : {}) })}>{busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}测试连接</SecondaryButton>
      </div>
    </Modal>
  </div>;
}
