import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, History, Image as ImageIcon, Plus, RotateCcw, Save, Send, Trash2, Upload } from 'lucide-react';
import { AdminPageHeader } from '../adminUI.jsx';
import { getMiniappLayout, getMiniappPreviewContent, publishMiniappLayout, rollbackMiniappLayout, saveMiniappLayoutDraft } from '../miniappLayoutApi.js';
import LinkPicker, { categoryRef, isAllCategory } from '../miniappLinkPicker.jsx';
// 画布 + 两个「唯一事实来源」：区块默认标题、推荐区取数口径，都直接取小程序渲染器那份
import MiniappStage, { DEFAULT_TITLES, featuredEntries, normalizeContent, toolCardsOf } from '../miniapp-preview/index.jsx';
import { tryUploadToBlob } from '../blobUpload.js';

const COMPONENTS = [
  ['carousel', '轮播横幅'], ['announcements', '公告'], ['search', '搜索'], ['categories', '分类导航'],
  ['featured-agents', '推荐智能体'], ['featured-workflows', '推荐工作流'], ['tool-cards', '实用AI工具'],
  ['spacer', '间距'],
];
const LABELS = Object.fromEntries(COMPONENTS);

/**
 * 工具卡片数量上限。**与 `server/miniapp-layout.mjs` 的 `MAX_TOOL_CARDS` 保持一致** ——
 * 服务端是硬校验（超了直接报错），这里只是防呆、让「添加卡片」到点就置灰。
 */
const TOOL_CARD_MAX = 20;
const emptyToolCard = () => ({
  id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  image: '', title: '', subtitle: '', link: '',
});

/** 每个区块的「点击链接」语义不同，面板上要写清楚它到底管哪一次点击。 */
const LINK_FIELDS = {
  carousel: { label: '兜底跳转', hint: '单张轮播图没单独配链接时用这里；整块都没配就跟随网页端 Banner 的链接。' },
  announcements: { label: '点击公告栏', hint: '留空＝进公告通知列表页。' },
  search: { label: '点击搜索图标 / 回车', hint: '留空＝进全局搜索页；配了就固定跳这里。' },
  categories: { label: '点击右侧「更多」', hint: '留空＝进「全部分类」浏览页。每张分类卡自己的跳转在下面单独配。' },
  'featured-agents': { label: '点击右侧「更多」', hint: '留空＝进热门智能体页。每张卡片自己的跳转在下面单独配。' },
  'featured-workflows': { label: '点击右侧「更多」', hint: '留空＝进热门工作流页。每张卡片自己的跳转在下面单独配。' },
};

/**
 * 面板字段表 —— 整个改造的核心一句话：**后台每一个可见控件，要么真生效，要么不出现**。
 * 判断依据是渲染器到底读不读这个字段（详见 miniapp/src/components/layout-blocks.tsx）：
 *   - 标题：只有 categories / featured-* 会渲染出标题（轮播、公告、搜索、间距都没有标题行）
 *   - 配色 / 间距：spacer 的容器不吃 blockStyle，别给它显示
 *   - 「更多」：只有带 SectionTitle 的三个块有
 *   - 数据源：只有 featured-* 会读（分类块固定读 content.categories）
 *   - 逐项跳转：categories 读 categoryLinks、featured-* 读 cardLinks
 *   - 展示数量：轮播张数 / 分类个数 / 推荐个数，其余块没有这个概念
 */
const PANEL_FIELDS = {
  carousel: { title: false, colors: true, spacing: true, more: false, placeholder: false, dataSource: false, limit: '最多轮播几张（上传不足时按实际张数）' },
  announcements: { title: false, colors: true, spacing: true, more: false, placeholder: false, dataSource: false, limit: '' },
  search: { title: false, colors: true, spacing: true, more: false, placeholder: true, dataSource: false, limit: '' },
  categories: { title: true, colors: true, spacing: true, more: true, placeholder: false, dataSource: false, perItem: 'categories', limit: '最多显示几个分类' },
  'featured-agents': { title: true, colors: true, spacing: true, more: true, placeholder: false, dataSource: true, perItem: 'cards', limit: '最多显示几个（首页建议 6，与网页版同源）' },
  'featured-workflows': { title: true, colors: true, spacing: true, more: true, placeholder: false, dataSource: true, perItem: 'cards', limit: '最多显示几个（首页建议 6，与网页版同源）' },
  // 工具卡片：卡数由「添加/删除卡片」直接决定，没有「展示数量」这个概念；配色也不给 ——
  // 卡片文案自带颜色（有底图走白字+遮罩、没底图走中性色），区块的 textColor 在这里配了看不出来。
  'tool-cards': { title: true, colors: false, spacing: true, more: false, placeholder: false, dataSource: false, perItem: 'tools', limit: '' },
  spacer: { title: false, colors: false, spacing: true, more: false, placeholder: false, dataSource: false, limit: '' },
};

const blockFor = (type) => ({
  id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  type, visible: true, title: '', image: '', backgroundColor: '', textColor: '',
  spacing: type === 'spacer' ? 24 : 16, link: '', dataSource: type.startsWith('featured-') ? 'recommended' : '',
  limit: type === 'categories' ? 12 : type.startsWith('featured-') ? 6 : 8,
  searchPlaceholder: '', moreText: '', showMore: true,
  slides: type === 'carousel' ? [] : undefined,
  categoryImages: type === 'categories' ? {} : undefined,
  categoryLinks: type === 'categories' ? {} : undefined,
  cardLinks: type.startsWith('featured-') ? {} : undefined,
  // 新加的工具区先给两个空位，正好是双列的第一行，运营一眼看出是双列布局
  toolCards: type === 'tool-cards' ? [emptyToolCard(), emptyToolCard()] : undefined,
});

export default function AdminMiniappDesign() {
  const [page, setPage] = useState('home');
  const [layout, setLayout] = useState({ page: 'home', blocks: [] });
  const [content, setContent] = useState(null);
  const [versions, setVersions] = useState([]);
  // 小程序内页白名单由服务端下发（唯一事实来源），链接选择器只认它
  const [pages, setPages] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const selected = useMemo(() => layout.blocks.find(block => block.id === selectedId) || null, [layout, selectedId]);
  // 当前区块该显示哪些控件 —— 字段表驱动的唯一入口，不真生效的字段直接不渲染
  const panel = selected ? PANEL_FIELDS[selected.type] : null;
  const safeContent = useMemo(() => normalizeContent(content), [content]);
  const categoryList = useMemo(() => safeContent.categories.filter(category => !isAllCategory(category)), [safeContent]);
  /**
   * 推荐区「这一块会显示哪些卡片」—— 直接调渲染器那个函数，不另写一份口径，
   * 所以面板里列出来的卡片跟画布 / 真机上显示的一定是同一批。
   */
  const cardEntries = useMemo(() => {
    if (!selected || panel?.perItem !== 'cards') return [];
    return featuredEntries(safeContent, selected, selected.type === 'featured-workflows' ? 'workflow' : 'agent');
  }, [selected, panel, safeContent]);

  const load = async (nextPage = page) => {
    setLoading(true); setMessage(null);
    try {
      const [layoutData, previewContent] = await Promise.all([getMiniappLayout(nextPage), getMiniappPreviewContent().catch(() => null)]);
      setLayout(layoutData.draft); setVersions(layoutData.versions || []); setPages(layoutData.pages || []); setContent(previewContent); setSelectedId(layoutData.draft.blocks[0]?.id || '');
    } catch (error) { setMessage({ ok: false, text: error.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [page]);

  const updateBlocks = (blocks) => setLayout(current => ({ ...current, blocks }));
  const updateSelected = (patch) => updateBlocks(layout.blocks.map(block => block.id === selectedId ? { ...block, ...patch } : block));
  /** 逐项跳转的写入：值为空串＝沿用默认跳转（服务端会把空值丢掉，不落库） */
  const updateLinkMap = (field, key, link) => updateSelected({ [field]: { ...(selected?.[field] || {}), [key]: link } });
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
  /** 「实用AI工具」：卡片数组的增删改 —— 数组顺序就是小程序上的展示顺序 */
  const toolCards = selected?.toolCards || [];
  const setToolCards = (cards) => updateSelected({ toolCards: cards });
  const updateToolCard = (index, patch) => setToolCards(toolCards.map((card, itemIndex) => itemIndex === index ? { ...card, ...patch } : card));
  const removeToolCard = (index) => setToolCards(toolCards.filter((_, itemIndex) => itemIndex !== index));
  const moveToolCard = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= toolCards.length) return;
    const next = [...toolCards];
    [next[index], next[target]] = [next[target], next[index]];
    setToolCards(next);
  };
  const addToolCard = () => { if (toolCards.length < TOOL_CARD_MAX) setToolCards([...toolCards, emptyToolCard()]); };
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
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-600"><ImageIcon size={17} className="text-blue-600" /><span>画布直接渲染小程序真机的组件与样式（含底部导航），改完先保存草稿；确认无误再发布。在画布上点卡片 / 分类 / 底部导航，下方会显示小程序里会跳到哪儿。</span></div>
    <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-600">这份布局由小程序<b>首页</b>读取并渲染；分类页由小程序自行按分类列出全部智能体和工作流，不受这里的配置影响。</div>
    {message && <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{message.text}</div>}
    {loading ? <div className="rounded-2xl bg-white p-12 text-center text-slate-400">加载布局中…</div> : <div className="grid gap-5 xl:grid-cols-[250px_minmax(420px,1fr)_340px]">
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold text-slate-900">组件库</h2><div className="grid gap-2">{COMPONENTS.map(([type, label]) => <button key={type} onClick={() => { const block = blockFor(type); updateBlocks([...layout.blocks, block]); setSelectedId(block.id); }} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-blue-300 hover:bg-blue-50"><Plus size={15} className="text-blue-600" />{label}</button>)}</div>
        <h2 className="mb-3 mt-6 flex items-center gap-2 font-semibold text-slate-900"><History size={17} />版本历史</h2><div className="max-h-72 space-y-2 overflow-auto">{versions.length === 0 && <p className="text-xs text-slate-400">尚未发布版本</p>}{versions.map(version => <div key={version.id} className="rounded-xl border border-slate-100 p-3 text-xs"><div className="font-medium text-slate-700">{new Date(version.createdAt).toLocaleString()}</div><button disabled={busy} onClick={() => window.confirm('确认回滚到该版本？') && run(() => rollbackMiniappLayout(page, version.id), '已回滚并发布为新版本')} className="mt-2 inline-flex items-center gap-1 text-blue-600"><RotateCcw size={13} />回滚</button></div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">实时手机画布</h2>
        {/* 手机外壳是纯编辑器外观：用 box-shadow 画边框（不占布局宽度），里面 375px 就是真机宽度。
            壳内的 .miniapp-stage 里跑的是小程序真组件，外面这些都不参与真机还原。 */}
        <div className="mx-auto w-[375px] rounded-[34px] shadow-[0_0_0_9px_#0f172a,0_18px_40px_-10px_rgba(15,23,42,.5)]">
          <div className="overflow-hidden rounded-[34px] bg-white">
            <div className="bg-white pt-2">
              <div className="mx-auto h-4 w-24 rounded-full bg-slate-900" />
              <div className="flex items-center justify-between px-4 pb-1"><span className="text-[10px] font-semibold text-slate-500">友尚AI 小程序</span><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-medium text-blue-600">真机同款渲染</span></div>
            </div>
            <MiniappStage layout={layout} content={content} active="home" selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>
        <div className="mt-5 space-y-2">{layout.blocks.map((block, index) => <div key={block.id} draggable onDragStart={event => event.dataTransfer.setData('text/plain', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) { const blocks = [...layout.blocks]; const [item] = blocks.splice(from, 1); blocks.splice(index, 0, item); updateBlocks(blocks); } }} onClick={() => setSelectedId(block.id)} className={`flex items-center gap-2 rounded-xl border p-3 ${selectedId === block.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}><GripVertical size={16} className="cursor-grab text-slate-400" /><span className="flex-1 text-sm font-medium">{block.title || LABELS[block.type]}</span><button title="上移" onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button title="下移" onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button title="显示或隐藏" onClick={() => updateBlocks(layout.blocks.map(item => item.id === block.id ? { ...item, visible: !item.visible } : item))}>{block.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button><button title="复制" onClick={() => { const copy = { ...block, id: `${block.type}-${Date.now()}` }; const blocks = [...layout.blocks]; blocks.splice(index + 1, 0, copy); updateBlocks(blocks); setSelectedId(copy.id); }}><Copy size={15} /></button><button title="删除" className="text-rose-500" onClick={() => { updateBlocks(layout.blocks.filter(item => item.id !== block.id)); if (selectedId === block.id) setSelectedId(''); }}><Trash2 size={15} /></button></div>)}</div>
      </section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="mb-4 font-semibold text-slate-900">属性设置</h2>{!selected && <p className="text-sm text-slate-400">请选择一个区块</p>}{selected && <div className="space-y-4 text-sm">
{selected.type === 'carousel' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><div><p className="font-semibold text-slate-800">小程序轮播图（16:9）</p><p className="mt-1 text-xs text-slate-500">仅展示图片，不显示标题或副标题；不影响网页端 Banner。上传后保存草稿并发布。</p></div>{(selected.slides || []).map((slide, index) => <div key={`${slide.image}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-2 flex gap-3">{slide.image ? <img src={slide.image} alt="" className="h-16 w-28 rounded-lg object-cover" /> : <div className="h-16 w-28 rounded-lg bg-slate-100" />}<label className="inline-flex h-9 cursor-pointer items-center gap-1 self-center rounded-lg border border-blue-200 bg-white px-3 text-xs text-blue-700"><Upload size={14} />上传图片<input type="file" accept="image/*" className="hidden" onChange={event => void uploadImage(event.target.files?.[0], url => updateCarouselSlide(index, { image: url }))} /></label></div><div className="mt-1"><LinkPicker compact label="这张图的点击跳转" value={slide.link} onChange={link => updateCarouselSlide(index, { link })} content={content} pages={pages} /></div><button type="button" onClick={() => removeCarouselSlide(index)} className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600"><Trash2 size={13} />删除此图</button></div>)}<button type="button" disabled={(selected.slides || []).length >= 8} onClick={() => updateSelected({ slides: [...(selected.slides || []), { image: '', link: '' }] })} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700"><Plus size={14} />添加轮播图</button></div>}
        {panel?.perItem === 'tools' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div><p className="font-semibold text-slate-800">工具卡片（双列，卡片比例 21:9）</p><p className="mt-1 text-xs text-slate-500">顺序＝小程序上的展示顺序。主标 / 副标<b>留空＝这一行不显示</b>；一张卡连背景图和文字都没有，小程序上就不显示它。至少配好一张卡，首页才会出现这个模块。</p></div>
          {toolCards.map((card, index) => <div key={card.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-[10px] text-slate-400" style={{ width: 116, aspectRatio: '21 / 9' }}>{card.image ? <img src={card.image} alt="" className="h-full w-full object-cover" /> : '无背景图'}</div>
              <div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-700">第 {index + 1} 张</p><p className="mt-1 text-[11px] text-slate-400">背景图建议 21:9；上传后保存草稿并发布才生效</p></div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs text-blue-700"><Upload size={13} />上传<input type="file" accept="image/*" className="hidden" onChange={event => void uploadImage(event.target.files?.[0], url => updateToolCard(index, { image: url }))} /></label>
                {!!card.image && <button type="button" onClick={() => updateToolCard(index, { image: '' })} className="text-[11px] text-slate-500">清除背景图</button>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-slate-600">主标<input value={card.title || ''} onChange={event => updateToolCard(index, { title: event.target.value })} placeholder="留空＝不显示" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" /></label>
              <label className="block text-xs text-slate-600">副标<input value={card.subtitle || ''} onChange={event => updateToolCard(index, { subtitle: event.target.value })} placeholder="留空＝不显示" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5" /></label>
            </div>
            <LinkPicker compact label="这张卡片的跳转" hint="留空＝这张卡点了不跳转" value={card.link} onChange={link => updateToolCard(index, { link })} content={content} pages={pages} />
            <div className="flex items-center gap-3 text-xs">
              <button type="button" disabled={index === 0} onClick={() => moveToolCard(index, -1)} className="inline-flex items-center gap-1 text-slate-600 disabled:text-slate-300"><ArrowUp size={13} />上移</button>
              <button type="button" disabled={index === toolCards.length - 1} onClick={() => moveToolCard(index, 1)} className="inline-flex items-center gap-1 text-slate-600 disabled:text-slate-300"><ArrowDown size={13} />下移</button>
              <button type="button" onClick={() => removeToolCard(index)} className="ml-auto inline-flex items-center gap-1 text-rose-600"><Trash2 size={13} />删除此卡</button>
            </div>
          </div>)}
          {!toolCards.length && <p className="text-xs text-slate-400">还没有卡片，点下面的「添加卡片」开始。</p>}
          {/* 直接用渲染器那份口径算「真机会显示几张」，避免运营以为配了没反应 */}
          {!!toolCards.length && (() => {
            const visible = toolCardsOf({ type: 'tool-cards', toolCards }).length;
            if (visible === toolCards.length) return <p className="text-xs text-emerald-700">这 {visible} 张都会显示在小程序上。</p>;
            return <p className="text-xs text-amber-700">共 {toolCards.length} 张，其中 {toolCards.length - visible} 张既没背景图也没文字，小程序上不会显示。</p>;
          })()}
          <button type="button" disabled={toolCards.length >= TOOL_CARD_MAX} onClick={addToolCard} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 disabled:text-slate-300"><Plus size={14} />添加卡片（最多 {TOOL_CARD_MAX} 张）</button>
        </div>}
        {panel?.perItem === 'categories' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><div><p className="font-semibold text-slate-800">分类卡（背景图 + 逐张跳转）</p><p className="mt-1 text-xs text-slate-500">「全部」不会在小程序分类区显示；每张卡可单独配背景图和点击跳转，跳转留空＝进该分类的列表页。</p></div>{categoryList.map(category => { const key = categoryRef(category); const image = selected.categoryImages?.[key] || ''; return <div key={key} className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5"><div className="flex items-center gap-3">{image ? <img src={image} alt="" className="h-16 w-24 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-24 shrink-0 rounded-lg bg-gradient-to-br from-blue-100 to-slate-100" />}<div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-800">{category.label || category.name || key}</p><p className="mt-1 text-xs text-slate-400">背景图推荐 4:3</p></div><label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-xs text-blue-700"><Upload size={13} />上传<input type="file" accept="image/*" className="hidden" onChange={event => void uploadImage(event.target.files?.[0], url => updateSelected({ categoryImages: { ...(selected.categoryImages || {}), [key]: url } }))} /></label></div><LinkPicker compact label="这张分类卡的跳转" hint={`留空＝进「${category.label || category.name || key}」分类列表页`} value={selected.categoryLinks?.[key]} onChange={link => updateLinkMap('categoryLinks', key, link)} content={content} pages={pages} /></div>; })}{!categoryList.length && <p className="text-xs text-slate-400">公共内容里还没有分类。</p>}</div>}
        {panel?.perItem === 'cards' && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><div><p className="font-semibold text-slate-800">每张卡片的跳转</p><p className="mt-1 text-xs text-slate-500">按当前的「数据源 / 展示数量」列出这一块会显示的卡片；跳转留空＝默认打开该智能体 / 工作流自身。</p></div>{cardEntries.map(entry => <LinkPicker key={entry.item.id} compact label={entry.item.name || entry.item.id} hint={`留空＝打开${entry.kind === 'agent' ? '智能体' : '工作流'}「${entry.item.name || entry.item.id}」`} value={selected.cardLinks?.[entry.item.id]} onChange={link => updateLinkMap('cardLinks', entry.item.id, link)} content={content} pages={pages} />)}{!cardEntries.length && <p className="text-xs text-slate-400">这一块当前取不到内容，没有卡片可配跳转。</p>}</div>}
        {panel?.title && <label className="block">区块标题<input value={selected.title} onChange={e => updateSelected({ title: e.target.value })} placeholder={`留空＝显示默认标题「${DEFAULT_TITLES[selected.type]}」`} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>}
        {panel?.placeholder && <label className="block">搜索框提示语<input value={selected.searchPlaceholder || ''} onChange={e => updateSelected({ searchPlaceholder: e.target.value })} placeholder="留空＝显示默认提示语" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>}
        {panel?.more && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><label className="block">「更多」的文字<input value={selected.moreText || ''} onChange={e => updateSelected({ moreText: e.target.value })} disabled={selected.showMore === false} placeholder="留空＝显示默认的「更多>>」" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100 disabled:text-slate-400" /></label><label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={selected.showMore !== false} onChange={e => updateSelected({ showMore: e.target.checked })} />显示「更多」入口</label></div>}
        {panel?.colors && <div className="grid grid-cols-2 gap-3"><label>背景色<input value={selected.backgroundColor} onChange={e => updateSelected({ backgroundColor: e.target.value })} placeholder="#ffffff" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label><label>文字色<input value={selected.textColor} onChange={e => updateSelected({ textColor: e.target.value })} placeholder="#0f172a" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label></div>}
        {panel?.spacing && <label className="block">{selected.type === 'spacer' ? '留白高度（px）' : '区块间距（px）'}<input type="number" min="0" max="120" value={selected.spacing} onChange={e => updateSelected({ spacing: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /></label>}
        {LINK_FIELDS[selected.type] && <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><LinkPicker label={LINK_FIELDS[selected.type].label} hint={LINK_FIELDS[selected.type].hint} value={selected.link} onChange={link => updateSelected({ link })} content={content} pages={pages} /></div>}
        {panel?.dataSource && <label className="block">数据源<select value={selected.dataSource === 'all' ? 'all' : 'recommended'} onChange={e => updateSelected({ dataSource: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"><option value="recommended">推荐位（按后台推荐顺序，与网页版同源）</option><option value="all">全部上架内容（按排序号）</option></select></label>}
        {panel?.limit && <label className="block">展示数量<input type="number" min="1" max="24" value={selected.limit} onChange={e => updateSelected({ limit: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" /><span className="mt-1 block text-xs text-slate-400">{panel.limit}</span></label>}
        </div>}</section>
    </div>}
  </div>;
}
