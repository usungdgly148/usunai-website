import { useRef, useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Image as ImageIcon, Upload, X } from 'lucide-react';
import { AdminPageHeader, PrimaryButton, SecondaryButton, Card, Modal } from '../adminUI.jsx';
import { tryUploadToBlob } from '../blobUpload.js';
import { compressImage } from '../imageCompress.js';

const OVERLAY_PRESETS = [
  { label: '深黑', value: 'from-slate-900/80 via-slate-900/40 to-transparent' },
  { label: '品牌蓝', value: 'from-blue-950/80 via-slate-900/40 to-transparent' },
  { label: '玫红', value: 'from-rose-950/80 via-slate-900/40 to-transparent' },
  { label: '翡翠绿', value: 'from-emerald-950/80 via-slate-900/40 to-transparent' },
];

const blankBanner = { image: '', to: '/agents', color: OVERLAY_PRESETS[0].value, overlayOpacity: 80, published: true };

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function AdminRecommend() {
  const {
    banners, addBanner, updateBanner, deleteBanner, toggleBanner, reorderBanner,
    recommended, addRecommended, removeRecommended, reorderRecommended,
    agents, workflows, refreshAllAdminLists, refreshAllConfig,
  } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);

  const [bannerModal, setBannerModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankBanner);
  const [pickModal, setPickModal] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const fileRef = useRef(null);

  // 已上架智能体 / 工作流
  const allItems = [
    ...agents.filter(a => a.published).map(a => ({ ...a, kind: 'agent' })),
    ...workflows.filter(w => w.published).map(w => ({ ...w, kind: 'workflow' })),
  ];
  const recommendedItems = recommended.map(id => allItems.find(x => x.id === id)).filter(Boolean);
  const pickCandidates = allItems.filter(it =>
    !recommended.includes(it.id) &&
    (it.name.toLowerCase().includes(pickQuery.toLowerCase()) ||
      (it.desc || '').toLowerCase().includes(pickQuery.toLowerCase()))
  );

  const openAdd = () => { setEditing(null); setForm(blankBanner); setBannerModal(true); };
  const openEdit = (b) => { setEditing(b); setForm(b); setBannerModal(true); };
  const saveBanner = () => {
    if (!form.image) { window.alert('请上传 Banner 背景图'); return; }
    if (editing) updateBanner(editing.id, form); else addBanner(form);
    setBannerModal(false);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { window.alert('请上传图片文件'); return; }
    // 压缩到 1600px 宽 + JPEG 82%，大幅减小体积（原图常 2MB，压缩后约 200~400KB）
    let processed = file;
    try { processed = await compressImage(file); } catch { /* 压缩失败用原图 */ }
    try {
      const blobUrl = await tryUploadToBlob(processed, { admin: true });
      if (blobUrl) { setForm(prev => ({ ...prev, image: blobUrl })); return; }
    } catch (err) { /* fallthrough to base64 */ }
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({ ...prev, image: reader.result }));
    reader.readAsDataURL(processed);
  };

  const ItemThumb = ({ it, size = 'w-10 h-10', text = 'text-sm' }) => (
    <div className={`${size} rounded-xl ${it.iconColor || 'bg-slate-500'} text-white flex items-center justify-center shrink-0 overflow-hidden`}>
      {it.avatar ? <img src={it.avatar} alt="" className="w-full h-full object-cover" />
        : (it.icon ? <span className={text}>{it.iconText || (it.kind === 'agent' ? '智' : '流')}</span> : <span className={text}>{it.iconText || (it.kind === 'agent' ? '智' : '流')}</span>)}
    </div>
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader title="推荐配置" subtitle="配置首页 Banner 轮播与推荐位，将指定智能体 / 工作流推到前台黄金位置。" />

      {/* Banner 轮播管理 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">首页 Banner 轮播</h2>
            <span className="text-xs text-slate-400">（{banners.filter(b => b.published).length}/{banners.length} 已启用）</span>
          </div>
          <PrimaryButton onClick={openAdd} className="gap-1.5"><Plus size={15} /> 新增 Banner</PrimaryButton>
        </div>

        <div className="space-y-3">
          {/* 按 sortOrder 排序后渲染，与 AdminAgents 的列表排序策略一致；
              swapSort 只交换 sortOrder 值，若不排序渲染，按钮看起来会"不生效"。 */}
          {[...banners].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((b, i, arr) => (
            <div key={b.id} className="flex items-center gap-4 p-3 rounded-xl border border-slate-200/80 hover:border-slate-300 transition">
              <div className="w-40 rounded-lg overflow-hidden shrink-0 bg-slate-100 relative aspect-[21/9]">
                {b.image ? <img src={b.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon size={20} /></div>}
                <div className={`absolute inset-0 bg-gradient-to-r ${b.color}`} style={{ opacity: (b.overlayOpacity ?? 80) / 100 }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500 truncate">跳转：<span className="font-mono text-slate-700">{b.to || '/'}</span></div>
                <div className="text-[11px] text-slate-400 mt-0.5">遮罩：{OVERLAY_PRESETS.find(p => p.value === b.color)?.label || '自定义'} · 透明度 {b.overlayOpacity ?? 80}%</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleBanner(b.id)} title={b.published ? '下架' : '启用'}
                  className={`p-2 rounded-lg ${b.published ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-50'}`}>
                  {b.published ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={() => reorderBanner(b.id, 'up')} disabled={i === 0}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-50 disabled:opacity-30"><ArrowUp size={16} /></button>
                <button onClick={() => reorderBanner(b.id, 'down')} disabled={i === arr.length - 1}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-50 disabled:opacity-30"><ArrowDown size={16} /></button>
                <button onClick={() => openEdit(b)} className="p-2 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"><Pencil size={16} /></button>
                <button onClick={() => { if (window.confirm('确认删除该 Banner？')) deleteBanner(b.id); }}
                  className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {banners.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">暂无 Banner，点击右上角新增。</div>}
        </div>
      </Card>

      {/* 推荐位管理 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">首页推荐位（热门智能体 / 工作流）</h2>
            <span className="text-xs text-slate-400">（{recommended.length} 个）</span>
          </div>
          <PrimaryButton onClick={() => { setPickQuery(''); setPickModal(true); }} className="gap-1.5"
            disabled={pickCandidates.length === 0}><Plus size={15} /> 添加推荐</PrimaryButton>
        </div>
        <p className="text-xs text-slate-400 mb-5">列表按顺序排列，将在首页「热门智能体」区优先展示。留空则前台自动按上架顺序取前 6 个。</p>

        <div className="space-y-2">
          {recommendedItems.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">尚未配置推荐位，前台将自动展示上架内容。</div>
          )}
          {recommendedItems.map((it, i) => (
            <div key={it.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/80 hover:border-slate-300 transition">
              <ItemThumb it={it} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 truncate">{it.name}</div>
                <div className="text-xs text-slate-400 truncate">{it.kind === 'agent' ? '智能体' : '工作流'}{it.category ? ` · ${it.category}` : ''}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => reorderRecommended(it.id, 'up')} disabled={i === 0}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-50 disabled:opacity-30"><ArrowUp size={16} /></button>
                <button onClick={() => reorderRecommended(it.id, 'down')} disabled={i === recommendedItems.length - 1}
                  className="p-2 rounded-lg text-slate-400 hover:bg-slate-50 disabled:opacity-30"><ArrowDown size={16} /></button>
                <button onClick={() => removeRecommended(it.id)} className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Banner 编辑弹窗 */}
      <Modal open={bannerModal} onClose={() => setBannerModal(false)} title={editing ? '编辑 Banner' : '新增 Banner'}
        footer={<>
          <SecondaryButton onClick={() => setBannerModal(false)}>取消</SecondaryButton>
          <PrimaryButton onClick={saveBanner}>保存</PrimaryButton>
        </>}
      >
        <div className="space-y-4">
          {/* 本地上传图片 */}
          <Field label="背景图" hint="支持 JPG / PNG / GIF，图片将转为 base64 本地存储">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            <div className="flex gap-3 items-start">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={`relative w-full aspect-[21/9] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition overflow-hidden ${form.image ? 'border-blue-300 bg-blue-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
              >
                {form.image ? (
                  <>
                    <img src={form.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center">
                      <span className="text-white text-sm font-medium flex items-center gap-1"><Upload size={16} /> 重新上传</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500"><Upload size={20} /></div>
                    <span className="text-sm text-slate-600">点击上传 Banner 图片</span>
                    <span className="text-xs text-slate-400">或拖拽图片到此处</span>
                  </>
                )}
              </button>
              {form.image && (
                <button type="button" onClick={() => setForm(prev => ({ ...prev, image: '' }))}
                  className="shrink-0 p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="清除图片">
                  <X size={18} />
                </button>
              )}
            </div>
          </Field>

          <Field label="跳转链接" hint="前台点击 Banner 时跳转的目标，如 /agents、/chat/a1，留空则不跳转">
            <input value={form.to || ''} onChange={e => setForm({ ...form, to: e.target.value })} placeholder="/agents" className={inputCls} />
          </Field>

          <Field label="遮罩配色">
            <div className="flex gap-2 flex-wrap">
              {OVERLAY_PRESETS.map(p => (
                <button type="button" key={p.value} onClick={() => setForm({ ...form, color: p.value })}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${form.color === p.value ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{p.label}</button>
              ))}
            </div>
            <div className="mt-3 px-1">
              {(() => {
                const cur = form.overlayOpacity ?? 80;
                const isWeak = cur < 20;
                return (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xs ${isWeak ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                        遮罩透明度{isWeak && <span className="ml-1 text-[10px] font-normal text-rose-500">（当前遮罩几乎不可见）</span>}
                      </span>
                      <span className={`text-xs font-mono tabular-nums ${isWeak ? 'text-rose-600 font-semibold' : 'text-slate-700'}`}>
                        {cur}<span className="text-slate-400"> %</span>
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={cur}
                      onChange={e => setForm({ ...form, overlayOpacity: Number(e.target.value) })}
                      className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${isWeak ? 'bg-rose-200 accent-rose-500' : 'bg-slate-200 accent-blue-600'}
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                        ${isWeak ? '[&::-webkit-slider-thumb]:bg-rose-500' : '[&::-webkit-slider-thumb]:bg-blue-600'}
                        [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer
                        ${isWeak ? '[&::-moz-range-thumb]:bg-rose-500' : '[&::-moz-range-thumb]:bg-blue-600'}`}
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-0.5 select-none">
                      <span>全透 0%</span>
                      <span>半透 50%</span>
                      <span>不透明 100%</span>
                    </div>
                    {/* 3 段对比预览：0% / 当前 / 100%，让主人立刻看出差异 */}
                    <div className="mt-2.5 flex items-stretch gap-1.5 h-8">
                      <div className="flex-1 rounded-md border border-slate-200 overflow-hidden relative" title="0%（无遮罩参考）">
                        <div className={`absolute inset-0 bg-gradient-to-r ${form.color}`} style={{ opacity: 0 }} />
                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-slate-500 font-mono">0%</div>
                      </div>
                      <div className="flex-1 rounded-md border-2 border-blue-500 overflow-hidden relative" title={`当前 ${cur}%`}>
                        <div className={`absolute inset-0 bg-gradient-to-r ${form.color}`} style={{ opacity: cur / 100 }} />
                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-mono font-bold drop-shadow">{cur}%</div>
                      </div>
                      <div className="flex-1 rounded-md border border-slate-200 overflow-hidden relative" title="100%（最强遮罩参考）">
                        <div className={`absolute inset-0 bg-gradient-to-r ${form.color}`} style={{ opacity: 1 }} />
                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-white font-mono drop-shadow">100%</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1.5">推荐 30-80%。值越小图片越清晰、遮罩越弱。</div>
                  </>
                );
              })()}
            </div>
          </Field>

          <label className="flex items-center justify-between pt-1">
            <span className="text-sm font-medium text-slate-700">启用（前台展示）</span>
            <button type="button" onClick={() => setForm({ ...form, published: !form.published })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.published ? 'bg-blue-600' : 'bg-slate-200'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.published ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>

          <div className="pt-2">
            <div className="text-xs text-slate-400 mb-1.5">预览（透明度 {form.overlayOpacity ?? 80}%）</div>
            <div className="relative rounded-xl overflow-hidden h-28">
              {form.image ? <img src={form.image} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-slate-200 flex items-center justify-center text-slate-400 text-sm">请先上传图片</div>}
              <div className={`absolute inset-0 bg-gradient-to-r ${form.color}`} style={{ opacity: (form.overlayOpacity ?? 80) / 100 }} />
            </div>
          </div>
        </div>
      </Modal>

      {/* 挑选推荐项弹窗 */}
      <Modal open={pickModal} onClose={() => setPickModal(false)} title="选择推荐智能体 / 工作流"
        footer={<SecondaryButton onClick={() => setPickModal(false)}>完成</SecondaryButton>}
      >
        <div className="mb-3">
          <input value={pickQuery} onChange={e => setPickQuery(e.target.value)} placeholder="搜索名称或描述..." className={inputCls} />
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {pickCandidates.map(it => (
            <button key={it.id} onClick={() => addRecommended(it.id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/40 text-left transition">
              <ItemThumb it={it} size="w-9 h-9" text="text-xs" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">{it.name}</div>
                <div className="text-xs text-slate-400 truncate">{it.kind === 'agent' ? '智能体' : '工作流'}</div>
              </div>
              <Plus size={16} className="text-blue-600 shrink-0" />
            </button>
          ))}
          {pickCandidates.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">没有更多可添加的项目。</div>}
        </div>
      </Modal>
    </div>
  );
}
