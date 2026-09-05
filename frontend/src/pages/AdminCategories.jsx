import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { Plus, Trash2, Edit2, Check, X, ArrowUp, ArrowDown, Tag, Sidebar as SidebarIcon, Bookmark, Home as HomeIcon, Eye, EyeOff, Layers, Image as ImageIcon } from 'lucide-react';
import { CategoryIcon } from '../components.jsx';
import { AdminPageHeader, PrimaryButton, Card, Toggle, Modal } from '../adminUI.jsx';
import { tryUploadToBlob } from '../blobUpload.js';
import { compressImage } from '../imageCompress.js';

const ICON_OPTIONS = [
  'Home', 'FileText', 'Video', 'BookOpen', 'Radio', 'Image', 'Clapperboard', 'MessageCircle', 'Search', 'Briefcase', 'ShoppingBag', 'LayoutGrid', 'Zap', 'PieChart', 'Layers', 'PenTool', 'TrendingUp', 'Shield'
];

const COLOR_OPTIONS = [
  { label: '蓝色', value: 'bg-blue-50 text-blue-600' },
  { label: '红色', value: 'bg-red-50 text-red-600' },
  { label: '橙色', value: 'bg-orange-50 text-orange-600' },
  { label: '绿色', value: 'bg-green-50 text-green-600' },
  { label: '紫色', value: 'bg-purple-50 text-purple-600' },
  { label: '青色', value: 'bg-teal-50 text-teal-600' },
  { label: '粉色', value: 'bg-pink-50 text-pink-600' },
  { label: '靛蓝', value: 'bg-indigo-50 text-indigo-600' },
  { label: '琥珀', value: 'bg-amber-50 text-amber-600' },
  { label: '灰色', value: 'bg-slate-100 text-slate-600' },
];

const EMPTY_DRAFT = { name: '', group: '', icon: 'LayoutGrid', color: 'bg-blue-50 text-blue-600', sortOrder: '', miniappImage: '', miniappLink: '' };

export default function AdminCategories() {
  const { sortedCategories, addCategory, updateCategory, deleteCategory, reorderCategory, categoryGroups, addCategoryGroup, updateCategoryGroup, deleteCategoryGroup, reorderCategoryGroup, categories, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const list = sortedCategories.filter(c => c.id !== 'all');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [isUploadingMiniappImage, setIsUploadingMiniappImage] = useState(false);

  // 大分组管理
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [groupDraft, setGroupDraft] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteTargetCatCount = deleteTarget ? categories.filter(c => c.id !== 'all' && c.group === deleteTarget.name).length : 0;

  const startGroupEdit = (g) => { setEditingGroupId(g.id); setGroupDraft(g.name); };
  const cancelGroupEdit = () => { setEditingGroupId(null); setGroupDraft(''); };
  const saveGroup = (id) => {
    if (updateCategoryGroup(id, { name: groupDraft })) cancelGroupEdit();
  };
  const confirmAddGroup = () => {
    const id = addCategoryGroup(groupNameDraft);
    if (id) { setAddingGroup(false); setGroupNameDraft(''); }
  };

  const startEdit = (cat) => {
    setEditing(cat.id);
    setDraft({ name: cat.name, group: cat.group || '', icon: cat.icon, color: cat.color, sortOrder: cat.sortOrder, miniappImage: cat.miniappImage || '', miniappLink: cat.miniappLink || '' });
  };
  const cancelEdit = () => { setEditing(null); setDraft(EMPTY_DRAFT); };
  const saveEdit = (id) => {
    if (!draft.name.trim()) return;
    updateCategory(id, {
      name: draft.name.trim(),
      group: draft.group || '',
      icon: draft.icon,
      color: draft.color,
      sortOrder: Number(draft.sortOrder) || 0,
      miniappImage: draft.miniappImage || '',
      miniappLink: draft.miniappLink.trim(),
    });
    setEditing(null);
  };
  const startAdd = () => { setAdding(true); setDraft(EMPTY_DRAFT); };
  const cancelAdd = () => { setAdding(false); };
  const confirmAdd = () => {
    if (!draft.name.trim()) return;
    const maxOrder = list.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    addCategory({
      name: draft.name.trim(),
      group: draft.group || '',
      icon: draft.icon,
      color: draft.color,
      sortOrder: Number(draft.sortOrder) || maxOrder + 10,
      miniappImage: draft.miniappImage || '',
      miniappLink: draft.miniappLink.trim(),
    });
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  };

  const handleMiniappImageUpload = async (file) => {
    if (!file?.type?.startsWith('image/')) return;
    setIsUploadingMiniappImage(true);
    try {
      let processed = file;
      try { processed = await compressImage(file, { maxWidth: 1200, maxHeight: 900, quality: 0.82 }); } catch { /* 压缩失败时保留原图 */ }
      const imageUrl = await tryUploadToBlob(processed, { admin: true });
      if (!imageUrl) throw new Error('upload failed');
      setDraft(current => ({ ...current, miniappImage: imageUrl }));
    } catch {
      window.alert('分类快捷图上传失败，请重试。');
    } finally {
      setIsUploadingMiniappImage(false);
    }
  };

  // 开关：直接写入 store（即时生效，无需进入编辑态）
  const flip = (id, field) => {
    const cat = list.find(c => c.id === id);
    if (cat) updateCategory(id, { [field]: !cat[field] });
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="分类管理"
        subtitle="配置网页端分类展示与小程序首页快捷入口，可自由增删改、排序并控制前台展示"
        actions={
          <PrimaryButton onClick={startAdd}>
            <Plus size={16} /> 新增分类
          </PrimaryButton>
        }
      />

      {/* 大分组管理：新建 / 重命名 / 删除 / 排序 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Layers size={18} className="text-blue-600" /> 大分组管理</h3>
          {!addingGroup && (
            <PrimaryButton onClick={() => { setAddingGroup(true); setGroupNameDraft(''); }} className="!py-2">
              <Plus size={16} /> 新建大分组
            </PrimaryButton>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-4">新建、重命名、删除、排序前台左侧导航的大分组标题。删除大分组时，其下的分类会自动归入「无分组」。</p>
        <div className="flex flex-wrap items-center gap-2.5">
          {categoryGroups.map((g, idx) => (
            <div key={g.id} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl pl-2 pr-1 py-1">
              {editingGroupId === g.id ? (
                <>
                  <input autoFocus value={groupDraft} onChange={e => setGroupDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveGroup(g.id)} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:border-blue-500" placeholder="分组名称" />
                  <button onClick={() => saveGroup(g.id)} className="p-1 rounded hover:bg-emerald-100 text-emerald-600" title="保存"><Check size={15} /></button>
                  <button onClick={cancelGroupEdit} className="p-1 rounded hover:bg-red-100 text-red-600" title="取消"><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="px-1.5 py-1 text-sm font-medium text-slate-700">{g.name}</span>
                  <button onClick={() => reorderCategoryGroup(g.id, 'up')} disabled={idx === 0} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30" title="上移"><ArrowUp size={14} /></button>
                  <button onClick={() => reorderCategoryGroup(g.id, 'down')} disabled={idx === categoryGroups.length - 1} className="p-1 rounded hover:bg-slate-200 disabled:opacity-30" title="下移"><ArrowDown size={14} /></button>
                  <button onClick={() => startGroupEdit(g)} className="p-1 rounded hover:bg-blue-100 text-blue-600" title="重命名"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteTarget(g)} className="p-1 rounded hover:bg-red-100 text-red-600" title="删除"><Trash2 size={15} /></button>
                </>
              )}
            </div>
          ))}
          {addingGroup && (
            <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-xl pl-2 pr-1 py-1">
              <input autoFocus value={groupNameDraft} onChange={e => setGroupNameDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirmAddGroup()} className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:border-blue-500" placeholder="分组名称" />
              <button onClick={confirmAddGroup} className="p-1 rounded hover:bg-emerald-100 text-emerald-600" title="确认"><Check size={15} /></button>
              <button onClick={() => setAddingGroup(false)} className="p-1 rounded hover:bg-red-100 text-red-600" title="取消"><X size={15} /></button>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1160px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-6 py-3 font-medium w-20">排序</th>
                <th className="text-left px-6 py-3 font-medium">分类</th>
                <th className="text-left px-6 py-3 font-medium w-32">大分组</th>
                <th className="text-left px-4 py-3 font-medium">小程序快捷入口</th>
                <th className="text-center px-4 py-3 font-medium">左侧导航</th>
                <th className="text-center px-4 py-3 font-medium">首页标签</th>
                <th className="text-center px-4 py-3 font-medium">首页热门</th>
                <th className="text-center px-4 py-3 font-medium">状态</th>
                <th className="text-left px-6 py-3 font-medium w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((cat, idx) => (
                <tr key={cat.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => reorderCategory(cat.id, 'up')} disabled={idx === 0} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ArrowUp size={14} /></button>
                      <button onClick={() => reorderCategory(cat.id, 'down')} disabled={idx === list.length - 1} className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"><ArrowDown size={14} /></button>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    {editing === cat.id ? (
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${draft.color} flex items-center justify-center shrink-0`}><CategoryIcon name={draft.icon} size={20} /></div>
                        <div className="space-y-2">
                          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:border-blue-500 focus:outline-none" placeholder="分类名称" />
                          <div className="flex items-center gap-2">
                            <select value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none">
                              {ICON_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                            <select value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none">
                              {COLOR_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                            <input
                              type="number"
                              value={draft.sortOrder}
                              onChange={e => setDraft({ ...draft, sortOrder: e.target.value })}
                              className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-20 focus:outline-none focus:border-blue-500"
                              title="排序权重（越小越靠前）"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl ${cat.color} flex items-center justify-center shrink-0`}><CategoryIcon name={cat.icon} size={20} /></div>
                        <span className="font-medium text-slate-900">{cat.name}</span>
                      </div>
                    )}
                  </td>

                  {/* 大分组 */}
                  <td className="px-6 py-4">
                    {editing === cat.id ? (
                      <select value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-blue-500">
                        <option value="">无分组</option>
                        {categoryGroups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm text-slate-500">{cat.group || '-'}</span>
                    )}
                  </td>

                  <td className="min-w-[250px] px-4 py-4">
                    {editing === cat.id ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
                            {isUploadingMiniappImage ? '上传中…' : '上传 4:3 图'}
                            <input hidden type="file" accept="image/*" disabled={isUploadingMiniappImage} onChange={e => handleMiniappImageUpload(e.target.files?.[0])} />
                          </label>
                          {draft.miniappImage && <button type="button" onClick={() => setDraft({ ...draft, miniappImage: '' })} className="text-xs text-slate-500 hover:text-red-600">清除图片</button>}
                        </div>
                        <input value={draft.miniappLink} onChange={e => setDraft({ ...draft, miniappLink: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" placeholder="可选：自定义跳转链接" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {cat.miniappImage ? <img src={cat.miniappImage} alt="" className="h-12 w-16 rounded-lg border border-slate-200 object-cover" /> : <span className="inline-flex h-12 w-16 items-center justify-center rounded-lg bg-slate-100 text-[11px] text-slate-400">默认图</span>}
                        <span>{cat.miniappLink ? '自定义链接' : '进入该分类'}</span>
                      </div>
                    )}
                  </td>

                  {/* 左侧导航 */}
                  <td className="px-4 py-4 text-center">
                    <div className="flex justify-center">
                      <Toggle checked={!!cat.showInSidebar} onChange={() => flip(cat.id, 'showInSidebar')} label="显示在左侧导航" />
                    </div>
                  </td>

                  {/* 首页标签 */}
                  <td className="px-4 py-4 text-center">
                    <div className="flex justify-center">
                      <Toggle checked={!!cat.showInTags} onChange={() => flip(cat.id, 'showInTags')} label="显示在首页标签" />
                    </div>
                  </td>

                  {/* 首页热门 */}
                  <td className="px-4 py-4 text-center">
                    <div className="flex justify-center">
                      <Toggle checked={!!cat.showInHome} onChange={() => flip(cat.id, 'showInHome')} label="作为首页热门入口" />
                    </div>
                  </td>

                  {/* 状态 */}
                  <td className="px-4 py-4 text-center">
                    <button
                      onClick={() => flip(cat.id, 'published')}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${cat.published ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
                      title={cat.published ? '已上架，点击软下架' : '已下架，点击上架'}
                    >
                      {cat.published ? <><Eye size={13} /> 已上架</> : <><EyeOff size={13} /> 已下架</>}
                    </button>
                  </td>

                  {/* 操作 */}
                  <td className="px-6 py-4">
                    {editing === cat.id ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => saveEdit(cat.id)} className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600" title="保存"><Check size={16} /></button>
                        <button onClick={cancelEdit} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600" title="取消"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(cat)} className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600" title="编辑"><Edit2 size={16} /></button>
                        <button onClick={() => deleteCategory(cat.id)} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600" title="删除"><Trash2 size={16} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {adding && (
                <tr className="border-t border-slate-100 bg-blue-50/40">
                  <td className="px-6 py-4 text-slate-400">—</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${draft.color} flex items-center justify-center shrink-0`}><CategoryIcon name={draft.icon} size={20} /></div>
                      <div className="space-y-2">
                        <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="分类名称" className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:border-blue-500 focus:outline-none" autoFocus />
                        <div className="flex items-center gap-2">
                          <select value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none">
                            {ICON_OPTIONS.map(i => <option key={i} value={i}>{i}</option>)}
                          </select>
                          <select value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none">
                            {COLOR_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <input
                            type="number"
                            value={draft.sortOrder}
                            onChange={e => setDraft({ ...draft, sortOrder: e.target.value })}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-xs w-20 focus:outline-none focus:border-blue-500"
                            placeholder="权重"
                            title="排序权重（越小越靠前）"
                          />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-blue-500">
                      <option value="">无分组</option>
                      {categoryGroups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
                    </select>
                  </td>
                  <td className="min-w-[250px] px-4 py-4">
                    <div className="space-y-2">
                      <label className="inline-flex cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
                        {isUploadingMiniappImage ? '上传中…' : '上传 4:3 图'}
                        <input hidden type="file" accept="image/*" disabled={isUploadingMiniappImage} onChange={e => handleMiniappImageUpload(e.target.files?.[0])} />
                      </label>
                      <input value={draft.miniappLink} onChange={e => setDraft({ ...draft, miniappLink: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" placeholder="可选：自定义跳转链接" />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center text-slate-400 text-xs">默认开</td>
                  <td className="px-4 py-4 text-center text-slate-400 text-xs">默认开</td>
                  <td className="px-4 py-4 text-center text-slate-400 text-xs">默认关</td>
                  <td className="px-4 py-4 text-center"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600"><Eye size={13} /> 已上架</span></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={confirmAdd} className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600" title="确认新增"><Check size={16} /></button>
                      <button onClick={cancelAdd} className="p-1.5 rounded-lg hover:bg-red-100 text-red-600" title="取消"><X size={16} /></button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="bg-blue-50 rounded-2xl p-5 border border-blue-100">
        <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2"><Tag size={18} /> 使用说明</h3>
        <ul className="text-sm text-blue-800 space-y-1.5">
          <li className="flex gap-2"><SidebarIcon size={15} className="mt-0.5 shrink-0" /> <span><b>左侧导航</b>：开启后该分类出现在前台左侧菜单，用户可据此筛选智能体/工作流。</span></li>
          <li className="flex gap-2"><Bookmark size={15} className="mt-0.5 shrink-0" /> <span><b>首页标签</b>：开启后该分类出现在首页 Banner 下方的分类标签区。</span></li>
          <li className="flex gap-2"><HomeIcon size={15} className="mt-0.5 shrink-0" /> <span><b>首页热门</b>：开启后该分类标签带 🔥 标记，作为首页重点推荐入口。</span></li>
          <li className="flex gap-2"><ImageIcon size={15} className="mt-0.5 shrink-0" /> <span><b>小程序快捷入口</b>：可上传默认 4:3 的分类快捷图，并可设置可选跳转链接；未设置链接时进入该分类页。</span></li>
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0" /> <span><b>状态</b>：关闭「已上架」即软下架，前台任何位置都不再出现该分类（不影响其下已上架的智能体/工作流本身）。</span></li>
          <li className="flex gap-2"><Tag size={15} className="mt-0.5 shrink-0" /> <span>「全部」为系统保留分类，不参与以上开关，仅用于前台「全部」筛选。</span></li>
          <li className="flex gap-2"><Layers size={15} className="mt-0.5 shrink-0 text-blue-600" /> <span><b>大分组</b>：上方「大分组管理」可自由新建 / 重命名 / 删除 / 排序左侧导航的分组标题；删除时其下分类自动归入「无分组」，不会随分组被删除。</span></li>
        </ul>
      </div>

      {/* 删除大分组确认 */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除大分组"
        footer={(
          <>
            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition">取消</button>
            <button onClick={() => { deleteCategoryGroup(deleteTarget.id); setDeleteTarget(null); }} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition">确认删除</button>
          </>
        )}
      >
        <p className="text-sm text-slate-600 leading-relaxed">
          确定要删除大分组「<b className="text-slate-900">{deleteTarget?.name}</b>」吗？
          {deleteTargetCatCount > 0
            ? ` 其下 ${deleteTargetCatCount} 个分类将自动归入「无分组」，不会随分组一起被删除。`
            : ' 该分组下暂无分类。'}
          <br />此操作不可撤销。
        </p>
      </Modal>
    </div>
  );
}
