import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, History, Image as ImageIcon, Plus, RotateCcw, Save, Send, Trash2, Upload } from 'lucide-react';
import { AdminPageHeader } from '../adminUI.jsx';
import { getMiniappLayout, getMiniappPreviewContent, publishMiniappLayout, rollbackMiniappLayout, saveMiniappLayoutDraft } from '../miniappLayoutApi.js';
import { tryUploadToBlob } from '../blobUpload.js';

const COMPONENTS = [
  ['carousel', '轮播横幅'], ['announcements', '公告'], ['search', '搜索'], ['categories', '分类导航'],
  ['featured-agents', '推荐智能体'], ['featured-workflows', '推荐工作流'], ['quick-links', '快捷入口'], ['spacer', '间距'],
];
const LABELS = Object.fromEntries(COMPONENTS);
const glyphs = ['✦', '◈', '⌁', '◌', '▣'];

const categoryRef = (category) => String(category?.key || category?.id || '');
const isAllCategory = (category) => categoryRef(category) === 'all' || String(category?.name || '').trim() === '全部';

const blockFor = (type) => ({
  id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type, visible: true, title: '', image: '', backgroundColor: '', textColor: '',
  spacing: type === 'spacer' ? 24 : 16, link: '', dataSource: type.startsWith('featured-') ? 'recommended' : '', limit: type.startsWith('featured-') ? 8 : 12,
  slides: type === 'carousel' ? [] : undefined,
  categoryImages: type === 'categories' ? {} : undefined,
});

function PreviewCard({ item, index }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-2.5 shadow-[0_8px_20px_rgba(22,67,127,0.08)]">
    <div className="mb-2 flex h-16 items-center justify-center rounded-xl bg-gradient-to-br from-[#eaf5ff] to-[#dbe9ff] p-2">
      {item?.avatar ? <img src={item.avatar} alt="" className="h-9 w-9 rounded-xl object-cover shadow-sm" /> : <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#2768e7] text-xs font-bold text-white shadow-sm">AI</span>}
    </div>
    <p className="truncate text-[10px] font-semibold text-slate-800">{item?.name || `推荐工具 ${index + 1}`}</p>
    <p className="mt-1 line-clamp-2 text-[8px] leading-3 text-slate-400">{item?.description || '帮助用户快速完成内容创作和业务任务'}</p>
  </div>;
}

function PhonePreview({ blocks, content, page, selectedId, onSelect }) {
  const categories = (content?.categories || []).filter(category => !isAllCategory(category));
  const agents = (content?.agents || []).slice(0, 4);
  const workflows = (content?.workflows || []).slice(0, 4);
  const banners = content?.banners || [];
  const choose = (block) => (event) => { event.preventDefault(); onSelect(block.id); };
  return <div className="relative mx-auto w-full max-w-[410px] overflow-hidden rounded-[36px] border-[8px] border-slate-900 bg-[#f4f8ff] shadow-2xl">
    <div className="bg-white px-4 pb-2 pt-3">
      <div className="mx-auto mb-2 h-4 w-24 rounded-full bg-slate-900" />
      <div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-900">{page === 'home' ? '友尚AI智能体' : '智能体工具'}</span><span className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-medium text-blue-600">浅色预览</span></div>
    </div>
    <div className="max-h-[640px] overflow-y-auto px-4 pb-20 pt-4">
      {blocks.filter(block => block.visible).map(block => <button key={block.id} type="button" onClick={choose(block)}
        className={`mb-3 w-full rounded-2xl border p-3 text-left transition ${selectedId === block.id ? 'border-[#2768e7] ring-2 ring-blue-100' : 'border-transparent bg-white shadow-[0_6px_18px_rgba(28,75,140,0.06)]'}`}
        style={{ backgroundColor: block.backgroundColor || undefined, color: block.textColor || undefined, marginBottom: block.spacing }}>
        {(block.title || block.type !== 'spacer') && <div className="mb-2 text-xs font-semibold">{block.title || LABELS[block.type]}</div>}
        {block.type === 'carousel' && (() => {
          const slide = block.slides?.[0] || { image: block.image || banners[0]?.image, title: block.title || banners[0]?.title, subtitle: banners[0]?.subtitle };
          return <div className="relative h-36 overflow-hidden rounded-xl bg-gradient-to-br from-[#123c76] via-[#2768e7] to-[#7cb5ff] p-4 text-white">
          {slide.image ? <img src={slide.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" /> : null}
          <div className="relative"><p className="text-base font-bold">{slide.title || 'AI 智能创作引擎'}</p><p className="mt-1 text-[9px] opacity-80">{slide.subtitle || '让内容创作和获客更高效'}</p></div>
        </div>;
        })()}
        {block.type === 'announcements' && <p className="flex items-center gap-1.5 truncate rounded-lg bg-amber-50 px-2 py-2 text-[9px] text-amber-700"><span>◉</span>{content?.announcements?.[0]?.title || '欢迎体验友尚 AI 智能体'}</p>}
        {block.type === 'search' && <div className="rounded-full bg-slate-100 px-3 py-2 text-[10px] text-slate-400">⌕ 输入关键词搜索智能体和工作流...</div>}
        {block.type === 'categories' && <div className="grid grid-cols-2 gap-2">{(categories.length ? categories : Array.from({ length: 4 })).slice(0, block.limit || 6).map((item, index) => <div key={item?.id || index} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-[#eaf5ff] to-[#dbe9ff]"><>{(block.categoryImages?.[categoryRef(item)] || item?.miniappImage) ? <img src={block.categoryImages?.[categoryRef(item)] || item.miniappImage} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}</><p className="absolute bottom-2 left-2 right-2 truncate text-[9px] font-semibold text-white [text-shadow:0_1px_6px_rgba(15,48,91,.8)]">{item?.name || '分类'}</p></div>)}</div>}
        {block.type === 'quick-links' && <div className="grid grid-cols-5 gap-1">{['智能体', '工作流', '我的资产', '算力记录', '我的'].map((name, index) => <div key={name} className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-xs text-indigo-600">{glyphs[index]}</span><p className="mt-1 text-[8px] text-slate-600">{name}</p></div>)}</div>}
        {block.type === 'featured-agents' && <div className="grid grid-cols-2 gap-2">{agents.slice(0, Math.min(block.limit || 4, 4)).map((item, index) => <PreviewCard key={item.id || index} item={item} index={index} />)}</div>}
        {block.type === 'featured-workflows' && <div className="grid grid-cols-2 gap-2">{workflows.slice(0, Math.min(block.limit || 4, 4)).map((item, index) => <PreviewCard key={item.id || index} item={item} index={index} />)}</div>}
        {block.type === 'spacer' && <div className="text-center text-[9px] text-slate-400">{block.spacing}px 留白</div>}
      </button>)}
    </div>
    <div className="absolute bottom-0 grid w-full grid-cols-5 border-t border-slate-100 bg-white px-2 py-2 text-center text-[9px] text-slate-500"><span className="text-blue-600">首页</span><span>智能体</span><span>灵感</span><span>资产</span><span>我的</span></div>
  </div>;
}

export default function AdminMiniappDesign() {
  const [page, setPage] = useState('home');
  const [layout, setLayout] = useState({ page: 'home', blocks: [] });
  const [content, setContent] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const selected = useMemo(() => layout.blocks.find(block => block.id === selectedId) || null, [layout, selectedId]);

  const load = async (nextPage = page) => {
    setLoading(true); setMessage(null);
    try {
      const [layoutData, previewContent] = await Promise.all([getMiniappLayout(nextPage), getMiniappPreviewContent().catch(() => null)]);
      setLayout(layoutData.draft); setVersions(layoutData.versions || []); setContent(previewContent); setSelectedId(layoutData.draft.blocks[0]?.id || '');
    } catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [page]);

  const updateBlocks = (blocks) => setLayout(current => ({ ...current, blocks }));
  const updateSelected = (patch) => updateBlocks(layout.blocks.map(block => block.id === selectedId ? { ...block, ...patch } : block));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= layout.blocks.length) return;
    const blocks = [...layout.blocks]; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; updateBlocks(blocks);
  };
  const run = async (work, success) => {
    setBusy(true); setMessage(null);
    try { await work(); await load(page); setMessage({ ok: true, text: success }); }
    catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setBusy(false); }
  };
  const updateCarouselSlide = (index, patch) => {
    const slides = [...(selected?.slides || [])];
    slides[index] = { ...slides[index], ...patch };
    updateSelected({ slides });
  };
  const removeCarouselSlide = (index) => updateSelected({ slides: (selected?.slides || []).filter((_, itemIndex) => itemIndex !== index) });
  const uploadImage = async (file, apply) => {
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      const url = await tryUploadToBlob(file, { admin: true });
      apply(url);
      setMessage({ ok: true, text: '图片已上传到小程序草稿，请保存草稿并发布后生效。' });
    } catch (error) { setMessage({ ok: false, text: error.message || '图片上传失败' }); }
    finally { setBusy(false); }
  };

  return <div>
    <AdminPageHeader title="小程序设计" subtitle="以受控组件配置页面；画布读取小程序同一份公共内容，发布后体验版重新进入或下拉刷新即可看到布局变更。" actions={<div className="flex gap-2">
      <button disabled={busy} onClick={() => run(() => saveMiniappLayoutDraft(page, layout), '草稿已保存')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"><Save size={16} />保存草稿</button>
      <button disabled={busy} onClick={() => run(() => publishMiniappLayout(page, layout), '布局已发布到小程序数据源')} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"><Send size={16} />发布布局</button>
    </div>} />
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-600"><ImageIcon size={17} className="text-blue-600" /><span>这是与体验版一致的布局预览：修改区块顺序、显示状态、标题、颜色、链接和展示数量后，先保存草稿；确认无误再发布。</span></div>
    <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-600">首页布局可视化配置。分类详情页固定为“该分类下的全部智能体和工作流”，不再单独配置快捷分类或热门工具。</div>
    {message && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message.text}</div>}
    {loading ? <div className="rounded-2xl bg-white p-12 text-center text-slate-400">加载布局中…</div> : <div className="grid gap-5 xl:grid-cols-[250px_minmax(420px,1fr)_340px]">
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold text-slate-900">组件库</h2><div className="grid gap-2">{COMPONENTS.map(([type, label]) => <button key={type} onClick={() => { const block = blockFor(type); updateBlocks([...layout.blocks, block]); setSelectedId(block.id); }} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-blue-300 hover:bg-blue-50"><Plus size={15} className="text-blue-600" />{label}</button>)}</div>
        <h2 className="mb-3 mt-6 flex items-center gap-2 font-semibold text-slate-900"><History size={17} />版本历史</h2><div className="max-h-72 space-y-2 overflow-auto">{versions.length === 0 && <p className="text-xs text-slate-400">尚未发布版本</p>}{versions.map(version => <div key={version.id} className="rounded-xl border border-slate-100 p-3 text-xs"><div className="font-medium text-slate-700">{new Date(version.createdAt).toLocaleString()}</div><button disabled={busy} onClick={() => window.confirm('确认回滚到该版本？') && run(() => rollbackMiniappLayout(page, version.id), '已回滚并发布为新版本')} className="mt-2 inline-flex items-center gap-1 text-blue-600"><RotateCcw size={13} />回滚</button></div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">实时手机画布</h2><PhonePreview blocks={layout.blocks} content={content} page={page} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="mt-5 space-y-2">{layout.blocks.map((block, index) => <div key={block.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) { const blocks = [...layout.blocks]; const [item] = blocks.splice(from, 1); blocks.splice(index, 0, item); updateBlocks(blocks); } }} onClick={() => setSelectedId(block.id)} className={`flex items-center gap-2 rounded-xl border p-3 ${selectedId === block.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}><GripVertical size={16} className="cursor-grab text-slate-400" /><span className="flex-1 text-sm font-medium">{block.title || LABELS[block.type]}</span><button title="上移" onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button title="下移" onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button title="显示或隐藏" onClick={() => updateBlocks(layout.blocks.map(item => item.id === block.id ? { ...item, visible: !item.visible } : item))}>{block.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button><button title="复制" onClick={() => { const copy = { ...block, id: `${block.type}-${Date.now()}` }; const blocks = [...layout.blocks]; blocks.splice(index + 1, 0, copy); updateBlocks(blocks); setSelectedId(copy.id); }}><Copy size={15} /></button><button title="删除" className="text-rose-500" onClick={() => { updateBlocks(layout.blocks.filter(item => item.id !== block.id)); if (selectedId === block.id) setSelectedId(''); }}><Trash2 size={15} /></button></div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">属性设置</h2>{!selected && <p className="text-sm text-slate-400">请选择一个区块</p>}{selected && <div className="space-y-4 text-sm">
        {selected.type === 'carousel' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><div><p className="font-semibold text-slate-800">小程序轮播图（16:9）</p><p className="mt-1 text-xs text-slate-500">仅用于小程序，不影响网页端 Banner。上传后保存草稿并发布。</p></div>{(selected.slides || []).map((slide, index) => <div key={`${slide.image}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-2 flex gap-3">{slide.image ? <img src={slide.image} alt="" className="h-16 w-28 rounded-lg object-cover" /> : <div className="h-16 w-28 rounded-lg bg-slate-100" />}<label className="inline-flex h-9 cursor-pointer items-center gap-1 self-center rounded-lg border border-blue-200 bg-white px-3 text-xs text-blue-700"><Upload size={14} />上传图片<input type="file" accept="image/*" className="hidden" onChange={event => void uploadImage(event.target.files?.[0], url => updateCarouselSlide(index, { image: url }))} /></label></div><input value={slide.title || ''} onChange={event => updateCarouselSlide(index, { title: event.target.value })} placeholder="标题（可选）" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2" /><input value={slide.subtitle || ''} onChange={event => updateCarouselSlide(index, { subtitle: event.target.value })} placeholder="副标题（可选）" className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2" /><input value={slide.link || ''} onChange={event => updateCarouselSlide(index, { link: event.target.value })} placeholder="点击链接（可选）" className="w-full rounded-lg border border-slate-200 px-3 py-2" /><button type="button" onClick={() => removeCarouselSlide(index)} className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600"><Trash2 size={13} />删除此图</button></div>)}<button type="button" disabled={(selected.slides || []).length >= 8} onClick={() => updateSelected({ slides: [...(selected.slides || []), { image: '', title: '', subtitle: '', link: '' }] })} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700"><Plus size={14} />添加轮播图</button></div>}
        {selected.type === 'categories' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><div><p className="font-semibold text-slate-800">分类背景图（4:3）</p><p className="mt-1 text-xs text-slate-500">“全部”不会在小程序分类区显示；每个分类仅显示背景图和名称。</p></div>{(content?.categories || []).filter(category => !isAllCategory(category)).map(category => { const key = categoryRef(category); const image = selected.categoryImages?.[key] || ''; return <div key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">{image ? <img src={image} alt="" className="h-16 w-24 rounded-lg object-cover" /> : <div className="h-16 w-24 rounded-lg bg-gradient-to-br from-blue-100 to-slate-100" />}<div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-800">{category.name}</p><p className="mt-1 text-xs text-slate-400">推荐 4:3，本地上传</p></div><label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-xs text-blue-700"><Upload size={13} />上传<input type="file" accept="image/*" className="hidden" onChange={event => void uploadImage(event.target.files?.[0], url => updateSelected({ categoryImages: { ...(selected.categoryImages || {}), [key]: url } }))} /></label></div>})}</div>}
        {selected.type !== 'carousel' && selected.type !== 'categories' && <><label className="block">标题<input value={selected.title} onChange={e => updateSelected({ title: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label className="block">图片地址（HTTPS）<input value={selected.image} onChange={e => updateSelected({ image: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></>}
        <div className="grid grid-cols-2 gap-3"><label>背景色<input value={selected.backgroundColor} onChange={e => updateSelected({ backgroundColor: e.target.value })} placeholder="#ffffff" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label>文字色<input value={selected.textColor} onChange={e => updateSelected({ textColor: e.target.value })} placeholder="#0f172a" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div><label className="block">区块间距（px）<input type="number" min="0" max="120" value={selected.spacing} onChange={e => updateSelected({ spacing: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label className="block">链接<input value={selected.link} onChange={e => updateSelected({ link: e.target.value })} placeholder="/pages/... 或 https://" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label className="block">数据源<select value={selected.dataSource} onChange={e => updateSelected({ dataSource: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="">默认</option><option value="recommended">推荐内容</option><option value="all">全部上架内容</option><option value="current-category">当前分类</option></select></label><label className="block">展示数量<input type="number" min="1" max="24" value={selected.limit} onChange={e => updateSelected({ limit: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div>}</section>
    </div>}
  </div>;
}
