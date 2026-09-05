import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store.jsx';
import { AdminPageHeader, Card, PrimaryButton, SecondaryButton, StatusBadge } from '../adminUI.jsx';
import {
  createKnowledgeBase, deleteKnowledgeBase, deleteKnowledgeDocument, listKnowledgeBases,
  listKnowledgeDocuments, replaceKnowledgeDocument, retryKnowledgeDocument, testKnowledgeSearch,
  updateKnowledgeBase, uploadKnowledgeDocument,
} from '../knowledgeApi.js';

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown';
const inputClass = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

export default function AdminKnowledgeBases() {
  const { authProviders, refreshAllAdminLists } = useStore();
  const embeddingProviders = useMemo(() => authProviders.filter(p => p.type === 'bailian-embedding' && p.status !== 'disabled'), [authProviders]);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState({ name: '', description: '', embeddingProviderId: '' });
  const [initialFile, setInitialFile] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const replaceRef = useRef(null);
  const replaceDocId = useRef('');

  const notify = (ok, text) => setMessage({ ok, text });
  const load = async () => {
    try {
      const data = await listKnowledgeBases();
      setItems(data.items || []);
      setSelectedId(current => current && data.items?.some(x => x.id === current) ? current : (data.items?.[0]?.id || ''));
    } catch (error) { notify(false, error.message); }
  };
  const loadDocuments = async (kbId) => {
    if (!kbId) { setDocuments([]); return; }
    try { setDocuments((await listKnowledgeDocuments(kbId)).items || []); }
    catch (error) { notify(false, error.message); }
  };

  useEffect(() => { refreshAllAdminLists(); load(); }, [refreshAllAdminLists]);
  useEffect(() => { loadDocuments(selectedId); }, [selectedId]);

  const resetForm = () => {
    setEditingId(''); setForm({ name: '', description: '', embeddingProviderId: embeddingProviders[0]?.id || '' }); setInitialFile(null);
  };
  useEffect(() => {
    if (!form.embeddingProviderId && embeddingProviders[0]) setForm(value => ({ ...value, embeddingProviderId: embeddingProviders[0].id }));
  }, [embeddingProviders, form.embeddingProviderId]);

  const save = async () => {
    if (!form.name.trim()) return notify(false, '请填写知识库名称');
    if (!form.embeddingProviderId) return notify(false, '请先在授权中心添加并选择百炼向量凭证');
    if (!editingId && !initialFile) return notify(false, '创建知识库时必须选择首个知识来源文件');
    setBusy(true); setMessage(null);
    try {
      if (editingId) {
        await updateKnowledgeBase(editingId, form);
        notify(true, '知识库配置已保存');
      } else {
        const created = await createKnowledgeBase(form);
        await uploadKnowledgeDocument(created.item.id, initialFile);
        setSelectedId(created.item.id);
        notify(true, '知识库已创建，文档正在解析和向量化');
      }
      resetForm(); await load();
    } catch (error) { notify(false, error.message); }
    finally { setBusy(false); }
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm({ name: item.name || '', description: item.description || '', embeddingProviderId: item.embeddingProviderId || '' });
    setInitialFile(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const removeKb = async (item) => {
    if (!window.confirm(`确认删除知识库“${item.name}”及其全部文档吗？`)) return;
    try { await deleteKnowledgeBase(item.id); notify(true, '知识库已删除'); await load(); }
    catch (error) { notify(false, error.message); }
  };
  const removeDoc = async (doc) => {
    if (!window.confirm(`确认删除文档“${doc.name}”吗？`)) return;
    try { await deleteKnowledgeDocument(doc.id); notify(true, '文档已删除'); await loadDocuments(selectedId); await load(); }
    catch (error) { notify(false, error.message); }
  };
  const replaceDoc = (doc) => { replaceDocId.current = doc.id; replaceRef.current?.click(); };
  const onReplaceFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !replaceDocId.current) return;
    try { await replaceKnowledgeDocument(replaceDocId.current, file); notify(true, '替换文档已上传，正在重新向量化'); await loadDocuments(selectedId); }
    catch (error) { notify(false, error.message); }
  };
  const retry = async (doc) => {
    try { await retryKnowledgeDocument(doc.id); notify(true, '已重新提交处理'); await loadDocuments(selectedId); }
    catch (error) { notify(false, error.message); }
  };
  const runSearch = async () => {
    if (!selectedId || !query.trim()) return;
    try { setSearchResult(await testKnowledgeSearch(selectedId, { query: query.trim(), topK: 5, threshold: 0.3 })); }
    catch (error) { notify(false, error.message); }
  };

  return <div className="space-y-6">
    <AdminPageHeader title="知识库" subtitle="为原生 DeepSeek 智能体管理 RAG 知识来源；前端回答不展示引用来源。" />
    {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message.text}</div>}

    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">{editingId ? '编辑知识库' : '新建知识库'}</h2>{editingId && <SecondaryButton onClick={resetForm}>取消编辑</SecondaryButton>}</div>
      <input className={inputClass} placeholder="知识库名称" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} />
      <textarea className={`${inputClass} resize-none`} rows={3} placeholder="用途说明（可选）" value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} />
      <select className={inputClass} value={form.embeddingProviderId} onChange={e => setForm(v => ({ ...v, embeddingProviderId: e.target.value }))}>
        <option value="">选择百炼向量凭证</option>
        {embeddingProviders.map(p => <option key={p.id} value={p.id}>{p.name} · qwen3.7-text-embedding（1024 维）</option>)}
      </select>
      {!editingId && <label className="block rounded-xl border-2 border-dashed border-slate-200 p-5 text-center cursor-pointer hover:border-blue-300">
        <Upload size={20} className="mx-auto text-blue-600 mb-2" /><span className="text-sm text-slate-700">{initialFile ? initialFile.name : '选择首个知识来源文件（必选）'}</span>
        <span className="block text-xs text-slate-400 mt-1">支持 PDF、DOCX、TXT、Markdown，最大 20MB</span>
        <input type="file" accept={ACCEPT} className="hidden" onChange={e => setInitialFile(e.target.files?.[0] || null)} />
      </label>}
      <PrimaryButton className="w-full" disabled={busy} onClick={save}>{busy ? '处理中…' : editingId ? '保存修改' : '创建并上传文档'}</PrimaryButton>
    </Card>

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
      <Card className="overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between"><h2 className="font-semibold">知识库列表</h2><SecondaryButton onClick={load}><RefreshCw size={14} />刷新</SecondaryButton></div>
        <div className="divide-y divide-slate-100">
          {items.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full p-5 text-left ${selectedId === item.id ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
            <div className="flex items-start gap-3"><BookOpen size={18} className="text-blue-600 mt-0.5" /><div className="min-w-0 flex-1"><div className="font-medium text-slate-900 truncate">{item.name}</div><div className="text-xs text-slate-400 mt-1">{item.readyDocumentCount || 0}/{item.documentCount || 0} 文档就绪 · {item.chunkCount || 0} 分段 · 绑定 {item.boundAgentCount || 0} 个智能体</div></div><StatusBadge status={item.status || 'active'} activeText="启用" inactiveText="停用" /></div>
            <div className="mt-3 flex justify-end gap-2"><SecondaryButton onClick={e => { e.stopPropagation(); edit(item); }}><Pencil size={13} />编辑</SecondaryButton><SecondaryButton onClick={e => { e.stopPropagation(); removeKb(item); }}><Trash2 size={13} />删除</SecondaryButton></div>
          </button>)}
          {!items.length && <div className="p-10 text-center text-sm text-slate-400">还没有知识库</div>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between"><h2 className="font-semibold">文档管理</h2>{selectedId && <label className="cursor-pointer text-sm font-medium text-blue-600"><Plus size={14} className="inline mr-1" />添加文档<input type="file" accept={ACCEPT} className="hidden" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { await uploadKnowledgeDocument(selectedId, file); notify(true, '文档已上传，正在处理'); await loadDocuments(selectedId); await load(); } catch (error) { notify(false, error.message); } }} /></label>}</div>
        <input ref={replaceRef} type="file" accept={ACCEPT} className="hidden" onChange={onReplaceFile} />
        <div className="divide-y divide-slate-100">
          {documents.map(doc => <div key={doc.id} className="p-5"><div className="flex items-start gap-3"><FileText size={18} className="text-slate-400 mt-0.5" /><div className="min-w-0 flex-1"><div className="font-medium truncate">{doc.name}</div><div className="text-xs text-slate-400 mt-1">{doc.status} · {doc.chunkCount || 0} 分段 · {Math.max(1, Math.round((doc.size || 0) / 1024))} KB</div>{doc.error && <div className="text-xs text-rose-600 mt-1">{doc.error}</div>}</div></div><div className="mt-3 flex justify-end gap-2">{doc.status === 'failed' && <SecondaryButton onClick={() => retry(doc)}><RefreshCw size={13} />重试</SecondaryButton>}<SecondaryButton onClick={() => replaceDoc(doc)}><Upload size={13} />替换</SecondaryButton><SecondaryButton onClick={() => removeDoc(doc)}><Trash2 size={13} />删除</SecondaryButton></div></div>)}
          {!documents.length && <div className="p-10 text-center text-sm text-slate-400">请选择知识库查看文档</div>}
        </div>
        {selectedId && <div className="p-5 border-t border-slate-100 space-y-3"><div className="flex gap-2"><input className={inputClass} placeholder="输入问题测试召回" value={query} onChange={e => setQuery(e.target.value)} /><PrimaryButton onClick={runSearch}><Search size={15} />测试</PrimaryButton></div>{searchResult && <pre className="max-h-56 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap">{JSON.stringify(searchResult.matches || searchResult.items || [], null, 2)}</pre>}</div>}
      </Card>
    </div>
  </div>;
}
