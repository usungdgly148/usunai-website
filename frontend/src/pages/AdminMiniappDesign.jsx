import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, History, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { AdminPageHeader } from '../adminUI.jsx';
import { getMiniappLayout, publishMiniappLayout, rollbackMiniappLayout, saveMiniappLayoutDraft } from '../miniappLayoutApi.js';

const COMPONENTS = [
  ['carousel', '轮播图'],
  ['announcements', '公告'],
  ['search', '搜索'],
  ['categories', '分类导航'],
  ['featured-agents', '推荐智能体'],
  ['featured-workflows', '推荐工作流'],
  ['quick-links', '快捷入口'],
  ['spacer', '间距'],
];
const LABELS = Object.fromEntries(COMPONENTS);

const blockFor = (type) => ({
  id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type,
  visible: true,
  title: '',
  image: '',
  backgroundColor: '',
  textColor: '',
  spacing: type === 'spacer' ? 24 : 16,
  link: '',
  dataSource: type.startsWith('featured-') ? 'recommended' : '',
  limit: type.startsWith('featured-') ? 8 : 12,
});

function PhonePreview({ blocks, selectedId, onSelect }) {
  return <div className="mx-auto w-full max-w-[360px] rounded-[34px] border-[8px] border-slate-900 bg-slate-50 p-3 shadow-xl min-h-[620px]">
    <div className="mx-auto mb-4 h-5 w-24 rounded-full bg-slate-900" />
    <div className="space-y-2">
      {blocks.filter(block => block.visible).map(block => <button key={block.id} type="button" onClick={() => onSelect(block.id)}
        className={`w-full rounded-xl border p-3 text-left transition ${selectedId === block.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 bg-white'}`}
        style={{ backgroundColor: block.backgroundColor || undefined, color: block.textColor || undefined, marginBottom: block.spacing }}>
        <div className="text-xs font-semibold">{block.title || LABELS[block.type]}</div>
        {block.type === 'carousel' && <div className="mt-2 h-24 rounded-lg bg-gradient-to-r from-blue-100 to-indigo-100" />}
        {block.type === 'search' && <div className="mt-2 rounded-full bg-slate-100 px-3 py-2 text-[10px] text-slate-400">搜索智能体或工作流</div>}
        {block.type === 'categories' && <div className="mt-2 flex gap-1"><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px]">分类</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px]">分类</span></div>}
        {block.type.startsWith('featured-') && <div className="mt-2 grid grid-cols-2 gap-2"><span className="h-14 rounded bg-slate-100" /><span className="h-14 rounded bg-slate-100" /></div>}
        {block.type === 'spacer' && <div className="text-[10px] text-slate-400">{block.spacing}px</div>}
      </button>)}
    </div>
  </div>;
}

export default function AdminMiniappDesign() {
  const [page, setPage] = useState('home');
  const [layout, setLayout] = useState({ page: 'home', blocks: [] });
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const selected = useMemo(() => layout.blocks.find(block => block.id === selectedId) || null, [layout, selectedId]);

  const load = async (nextPage = page) => {
    setLoading(true); setMessage(null);
    try {
      const data = await getMiniappLayout(nextPage);
      setLayout(data.draft); setVersions(data.versions || []); setSelectedId(data.draft.blocks[0]?.id || '');
    } catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [page]);

  const updateBlocks = (blocks) => setLayout(current => ({ ...current, blocks }));
  const updateSelected = (patch) => updateBlocks(layout.blocks.map(block => block.id === selectedId ? { ...block, ...patch } : block));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= layout.blocks.length) return;
    const blocks = [...layout.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateBlocks(blocks);
  };
  const run = async (work, success) => {
    setBusy(true); setMessage(null);
    try { await work(); await load(page); setMessage({ ok: true, text: success }); }
    catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setBusy(false); }
  };

  return <div>
    <AdminPageHeader title="小程序设计" subtitle="使用受控组件配置小程序首页与分类页；发布后小程序自动读取最新有效版本。" actions={<div className="flex gap-2">
      <button disabled={busy} onClick={() => run(() => saveMiniappLayoutDraft(page, layout), '草稿已保存')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"><Save size={16} />保存草稿</button>
      <button disabled={busy} onClick={() => run(() => publishMiniappLayout(page, layout), '布局已发布')} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"><Send size={16} />发布</button>
    </div>} />
    <div className="mb-5 inline-flex rounded-xl bg-slate-100 p-1">
      {[['home', '首页'], ['category', '分类页']].map(([value, label]) => <button key={value} onClick={() => setPage(value)} className={`rounded-lg px-5 py-2 text-sm ${page === value ? 'bg-white font-semibold text-blue-700 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
    </div>
    {message && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message.text}</div>}
    {loading ? <div className="rounded-2xl bg-white p-12 text-center text-slate-400">加载布局中…</div> : <div className="grid gap-5 xl:grid-cols-[250px_minmax(380px,1fr)_340px]">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">组件库</h2>
        <div className="grid gap-2">{COMPONENTS.map(([type, label]) => <button key={type} onClick={() => { const block = blockFor(type); updateBlocks([...layout.blocks, block]); setSelectedId(block.id); }} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-blue-300 hover:bg-blue-50"><Plus size={15} className="text-blue-600" />{label}</button>)}</div>
        <h2 className="mb-3 mt-6 flex items-center gap-2 font-semibold text-slate-900"><History size={17} />版本历史</h2>
        <div className="max-h-72 space-y-2 overflow-auto">{versions.length === 0 && <p className="text-xs text-slate-400">尚未发布版本</p>}{versions.map(version => <div key={version.id} className="rounded-xl border border-slate-100 p-3 text-xs"><div className="font-medium text-slate-700">{new Date(version.createdAt).toLocaleString()}</div><button disabled={busy} onClick={() => window.confirm('确认回滚到该版本？') && run(() => rollbackMiniappLayout(page, version.id), '已回滚并发布为新版本')} className="mt-2 inline-flex items-center gap-1 text-blue-600"><RotateCcw size={13} />回滚</button></div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">手机画布</h2>
        <PhonePreview blocks={layout.blocks} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="mt-5 space-y-2">{layout.blocks.map((block, index) => <div key={block.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) { const blocks = [...layout.blocks]; const [item] = blocks.splice(from, 1); blocks.splice(index, 0, item); updateBlocks(blocks); } }} onClick={() => setSelectedId(block.id)} className={`flex items-center gap-2 rounded-xl border p-3 ${selectedId === block.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
          <GripVertical size={16} className="cursor-grab text-slate-400" /><span className="flex-1 text-sm font-medium">{block.title || LABELS[block.type]}</span>
          <button title="上移" onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button title="下移" onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
          <button title="显示或隐藏" onClick={() => updateBlocks(layout.blocks.map(item => item.id === block.id ? { ...item, visible: !item.visible } : item))}>{block.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          <button title="复制" onClick={() => { const copy = { ...block, id: `${block.type}-${Date.now()}` }; const blocks = [...layout.blocks]; blocks.splice(index + 1, 0, copy); updateBlocks(blocks); setSelectedId(copy.id); }}><Copy size={15} /></button>
          <button title="删除" className="text-rose-500" onClick={() => { updateBlocks(layout.blocks.filter(item => item.id !== block.id)); if (selectedId === block.id) setSelectedId(''); }}><Trash2 size={15} /></button>
        </div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-4 font-semibold text-slate-900">属性设置</h2>
        {!selected && <p className="text-sm text-slate-400">请选择一个区块</p>}
        {selected && <div className="space-y-4 text-sm">
          <label className="block">标题<input value={selected.title} onChange={e => updateSelected({ title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
          <label className="block">图片地址（HTTPS）<input value={selected.image} onChange={e => updateSelected({ image: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
          <div className="grid grid-cols-2 gap-3"><label>背景色<input value={selected.backgroundColor} onChange={e => updateSelected({ backgroundColor: e.target.value })} placeholder="#ffffff" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label>文字色<input value={selected.textColor} onChange={e => updateSelected({ textColor: e.target.value })} placeholder="#0f172a" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div>
          <label className="block">区块间距（px）<input type="number" min="0" max="120" value={selected.spacing} onChange={e => updateSelected({ spacing: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
          <label className="block">链接<input value={selected.link} onChange={e => updateSelected({ link: e.target.value })} placeholder="/pages/... 或 https://" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
          <label className="block">数据源<select value={selected.dataSource} onChange={e => updateSelected({ dataSource: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">默认</option><option value="recommended">推荐内容</option><option value="all">全部上架内容</option><option value="current-category">当前分类</option></select></label>
          <label className="block">展示数量<input type="number" min="1" max="24" value={selected.limit} onChange={e => updateSelected({ limit: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>
        </div>}
      </section>
    </div>}
  </div>;
}
