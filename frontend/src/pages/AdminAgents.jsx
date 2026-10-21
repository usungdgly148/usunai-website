import { useStore } from '../store.jsx';
import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, Plus, Edit2, ToggleLeft, ToggleRight, Eye, Trash2, ArrowUpDown, ChevronDown, ChevronUp, Mic, Clapperboard, GripVertical } from 'lucide-react';
import { AdminPageHeader, AdminPagination, PrimaryButton, Card, renderIcon } from '../adminUI.jsx';

const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'agent', label: '智能体' },
  { key: 'workflow', label: '工作流' },
  { key: 'off', label: '已下架' },
];

// 后台列表每页条数（主人 2026-10-19 指定：每页最多 12 条）
const PAGE_SIZE = 12;

// 「手动排序」下混合列表的分组权重：智能体在前、工作流在后。
// 依据 = 前台 /agents「全部」页的拼装口径（先列全部智能体、再列全部工作流），
// 后台按同一口径排，看到的顺序才和前台一致；也保证上下箭头不会跨类型乱跳。
const KIND_RANK = { agent: 0, workflow: 1 };

/* "使用次数" inline 编辑单元：
 * - 默认态：显示数字（千分位）+ hover 描边提示「可点击编辑」
 * - 点击 → 切换为 number 输入框，自动聚焦全选
 * - Enter / blur 提交；Escape 取消；非负整数校验，非法回退旧值
 * - 保存走 store.updateAgent/updateWorkflow → SERVER_PERSIST 自动同步到后端 KV，
 *   前台 InfoCard/AdminDashboard 共享 entity.uses，刷新即看到新值
 * - v15：提交时 disabled input + 显示 loading 圈，async 完成后失败弹 Toast 并回滚显示 */
function UsesCell({ id, kind, value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value || 0));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(String(value || 0));
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = async () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      setDraft(String(value || 0));
      setEditing(false);
      return;
    }
    if (n === (value || 0)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    let ok = false;
    try {
      ok = await onCommit(n);
    } catch (e) {
      ok = false;
    }
    setSaving(false);
    if (!ok) {
      // 失败时回滚草稿 + Toast 提示（store.persistError 已经在 persistKey 内部 set，App 顶层会弹）
      setDraft(String(value || 0));
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(String(value || 0));
    setEditing(false);
  };

  if (editing || saving) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="1"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-24 px-2 py-1 text-sm border border-blue-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200 tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
        />
        {saving && <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" aria-label="保存中" />}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="点击编辑使用次数"
      className="inline-flex items-center gap-1.5 px-2 py-1 -mx-2 -my-1 rounded-md text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:ring-1 hover:ring-blue-200 transition tabular-nums"
    >
      <span className="font-medium">{(value || 0).toLocaleString()}</span>
    </button>
  );
}

export default function AdminAgents() {
  const { agents, workflows, sortedCategories, togglePublished, deleteAgent, deleteWorkflow, reorderAgentsByIds, reorderWorkflowsByIds, updateAgent, updateWorkflow, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const navigate = useNavigate();

  const [type, setType] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('order');
  const [newMenu, setNewMenu] = useState(false);
  const [page, setPage] = useState(1);

  // 拖拽状态：仅在「手动排序」模式下启用。dragId = 被拖行 id；overId = 鼠标悬停的目标行 id。
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  // 保存跨渲染最新 list 引用，onDrop 拿到的可能是 stale closure
  const listRef = useRef([]);

  const catName = (id) => {
    const c = sortedCategories.find(c => c.id === id);
    return c ? c.name : '未分类';
  };

  const all = [
    ...agents.map(a => ({ ...a, kind: 'agent' })),
    ...workflows.map(w => ({ ...w, kind: 'workflow' })),
  ];
  let list = all;
  if (type === 'agent' || type === 'workflow') list = list.filter(x => x.kind === type);
  if (type === 'off') list = list.filter(x => !x.published);
  if (category !== 'all') list = list.filter(x => x.category === category);
  if (search) list = list.filter(x => x.name.includes(search) || x.desc.includes(search));
  list = [...list].sort((a, b) => {
    if (sort === 'uses') return (b.uses || 0) - (a.uses || 0);
    if (sort === 'name') return a.name.localeCompare(b.name);
    // 手动排序：先按类型分组（智能体在前、工作流在后，与前台 /agents「全部」一致），组内再按 sortOrder 升序。
    // 这样后台列表顺序 = 前台展示顺序，上下箭头也只在同类型内移动，不会跳到另一种类型里。
    const rk = (KIND_RANK[a.kind] ?? 0) - (KIND_RANK[b.kind] ?? 0);
    if (rk !== 0) return rk;
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
  });
  listRef.current = list; // 拖拽 onDrop 闭包内取最新（存整份过滤后的列表，不是当前页）

  // 分页：list 为过滤+排序后的全量，pageItems 才是渲染的那 12 条。
  // 筛选条件变化 → 回到第 1 页；删除/过滤导致页数变少 → 页码自动收拢，不会停在空页。
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [type, category, search, sort]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const remove = (item) => {
    if (!window.confirm(`确定删除「${item.name}」？此操作不可撤销。`)) return;
    if (item.kind === 'agent') deleteAgent(item.id);
    else deleteWorkflow(item.id);
  };

  const open = (item) => navigate(`/admin/${item.kind}s/${item.id}`);

  // 当前筛选结果里的同类型上一行 / 下一行（**跨页也算**，否则第 13 条永远上不到第 1 条）；
  // 越过类型边界或已经到头 → null（箭头置灰）
  const neighborOf = (item, dir) => {
    const vi = list.findIndex(x => x.id === item.id && x.kind === item.kind);
    if (vi === -1) return null;
    const step = dir === 'up' ? -1 : 1;
    for (let i = vi + step; i >= 0 && i < list.length; i += step) {
      if (list[i].kind === item.kind) return list[i];
    }
    return null;
  };

  /* 上下箭头调序（主人 2026-10-19 加的）
   * 口径：以「当前筛选结果」为准（跨页也算），找同类型的上一行 / 下一行，把被点项在该类型的**完整序列**里挪到那个位置，
   * 然后把整条序列按下标重写 sortOrder ＝ 0..n-1。
   * 为什么重写整条而不只交换两个值：
   *   1) 历史拖拽逻辑会写出 2 和 2 / 2.5 和 2.5 这种重复值，只交换值等于没动（线上已有大量重复）；
   *   2) 顺带把小数洗成整数，前后端按 sortOrder 排序时不再靠数组原顺序兜底。
   * 写库走 reorderAgentsByIds / reorderWorkflowsByIds（内部 persistAdminKey → 服务端 KV），
   * 前台网页与小程序都按 sortOrder 升序取数，所以调完刷新即可同步。
   * 过滤/搜索状态下也能用：目标行是筛选结果里的相邻行，在完整序列里可能隔了几条，挪过去后可见相对顺序仍正确。 */
  const moveByStep = (item, dir) => {
    if (sort !== 'order') return;
    const target = neighborOf(item, dir);
    if (!target) return;
    const kindList = (item.kind === 'agent' ? agents : workflows)
      .slice()
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    const from = kindList.findIndex(x => x.id === item.id);
    const to = kindList.findIndex(x => x.id === target.id);
    if (from === -1 || to === -1 || from === to) return;
    const next = kindList.slice();
    const [moved] = next.splice(from, 1);
    // from > to（往上）→ 插到目标之前；from < to（往下）→ 移除后目标下标左移 1，插到 to 即落在目标之后
    next.splice(to, 0, moved);
    const ids = next.map(x => x.id);
    if (item.kind === 'agent') reorderAgentsByIds(ids);
    else reorderWorkflowsByIds(ids);
  };

  // 拖拽实现：HTML5 native drag & drop。手柄列 + 「手动排序」模式下启用。
  // 「全部 / 已下架」等混合列表：拖拽后只**单点改被拖元素的 sortOrder**
  // （newSort = 目标位置 sortOrder − 0.5），下次按 sortOrder 升序排自然到目标位，
  // agent / workflow 各自的数组不被重排，kind 归属不乱。
  const draggable = sort === 'order';
  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 需要 setData 才能触发拖拽
    try { e.dataTransfer.setData('text/plain', id); } catch {}
  };
  const handleDragOver = (e, id) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const cur = listRef.current;
    const srcIdx = cur.findIndex(x => x.id === sourceId);
    const dstIdx = cur.findIndex(x => x.id === targetId);
    if (srcIdx === -1 || dstIdx === -1) return;
    // 单类型 tab（agent / workflow）：整列同 kind，按 id 顺序批量重排 agents/workflows
    if (type === 'agent' || type === 'workflow') {
      const next = cur.slice();
      const [moved] = next.splice(srcIdx, 1);
      next.splice(dstIdx, 0, moved);
      const orderedIds = next.map(x => x.id);
      if (type === 'agent') reorderAgentsByIds(orderedIds);
      else reorderWorkflowsByIds(orderedIds);
      return;
    }
    // 混合 tab（all / off）：仅**单点改被拖元素的 sortOrder** ＝ 目标位置 sortOrder − 0.5。
    // 下次 list 按 sortOrder 升序排，被拖元素自然落在 target 之前；agent / workflow 各自的数组不被动，kind 归属不变。
    const target = cur[dstIdx];
    const newSort = (target?.sortOrder || 0) - 0.5;
    const moved = cur[srcIdx];
    if (moved.kind === 'agent') updateAgent(sourceId, { sortOrder: newSort });
    else updateWorkflow(sourceId, { sortOrder: newSort });
  };
  const handleDragEnd = () => { setDragId(null); setOverId(null); };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="项目管理"
        subtitle="统一管理智能体与工作流的上架、定价、配置与排序"
        actions={
          <div className="relative">
            <PrimaryButton onClick={() => setNewMenu(v => !v)} className="gap-1.5">
              <Plus size={16} /> 新建项目 <ChevronDown size={14} className={`transition ${newMenu ? 'rotate-180' : ''}`} />
            </PrimaryButton>
            {newMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNewMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5">
                  <button onClick={() => { setNewMenu(false); navigate('/admin/agents/new'); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">{renderIcon('Mic', 16)} 新建智能体</button>
                  <button onClick={() => { setNewMenu(false); navigate('/admin/workflows/new'); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">{renderIcon('Clapperboard', 16)} 新建工作流</button>
                </div>
              </>
            )}
          </div>
        }
      />

      {/* 筛选区 */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
        <div className="flex bg-white border border-slate-200 rounded-lg p-1">
          {TYPE_TABS.map(t => (
            <button key={t.key} onClick={() => setType(t.key)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition ${type === t.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white">
          <option value="all">全部分类</option>
          {sortedCategories.filter(c => c.id !== 'all').map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="搜索名称或描述" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <ArrowUpDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white">
              <option value="order">手动排序</option>
              <option value="uses">使用次数</option>
              <option value="name">名称</option>
            </select>
          </div>
        </div>
      </div>

      {/* 主体 */}
      {list.length === 0 ? (
        <Card className="p-16 text-center text-slate-400 text-sm">没有符合条件的项目</Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-2 py-3 font-medium w-8"></th>
                <th className="text-left px-2 py-3 font-medium w-[68px]">排序</th>
                <th className="text-left px-5 py-3 font-medium">项目</th>
                <th className="text-left px-5 py-3 font-medium">类型</th>
                <th className="text-left px-5 py-3 font-medium">分类</th>
                <th className="text-left px-5 py-3 font-medium">算力定价</th>
                <th className="text-left px-5 py-3 font-medium">使用次数</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(item => {
                const isDragging = dragId === item.id;
                const isOver = overId === item.id && dragId && dragId !== item.id;
                return (
                <tr key={item.id}
                  draggable={draggable}
                  onDragStart={draggable ? (e) => handleDragStart(e, item.id) : undefined}
                  onDragOver={draggable ? (e) => handleDragOver(e, item.id) : undefined}
                  onDrop={draggable ? (e) => handleDrop(e, item.id) : undefined}
                  onDragEnd={draggable ? handleDragEnd : undefined}
                  onClick={() => { if (!dragId) open(item); }}
                  className={`border-t border-slate-100 cursor-pointer transition ${isDragging ? 'opacity-40' : ''} ${isOver ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-2 py-3 text-slate-300">
                    {draggable ? (
                      <GripVertical size={16} className="cursor-grab active:cursor-grabbing" />
                    ) : (
                      <span title="切换到「手动排序」后可拖动调整顺序" className="inline-block">
                        <GripVertical size={16} className="text-slate-200" />
                      </span>
                    )}
                  </td>
                  {/* 上/下箭头：仅在「手动排序」下可用；到本类型页首页尾自动置灰。
                      按钮整体 stopPropagation，避免误触行点击进编辑页。 */}
                  <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      {(() => {
                        const upTarget = neighborOf(item, 'up');
                        const downTarget = neighborOf(item, 'down');
                        const btn = 'p-1 rounded-md transition ' + (draggable
                          ? 'text-slate-500 hover:bg-blue-50 hover:text-blue-600'
                          : 'text-slate-200 cursor-not-allowed');
                        const tip = draggable ? '' : '（请先在右上角切到「手动排序」）';
                        return (
                          <>
                            <button type="button" disabled={!draggable || !upTarget}
                              onClick={() => moveByStep(item, 'up')}
                              title={upTarget ? '上移一位' : '已经是本类型的第一条' + tip}
                              aria-label="上移"
                              className={btn + (draggable && upTarget ? '' : ' opacity-30 cursor-not-allowed hover:bg-transparent hover:text-slate-400')}>
                              <ChevronUp size={15} />
                            </button>
                            <button type="button" disabled={!draggable || !downTarget}
                              onClick={() => moveByStep(item, 'down')}
                              title={downTarget ? '下移一位' : '已经是本类型的最后一条' + tip}
                              aria-label="下移"
                              className={btn + (draggable && downTarget ? '' : ' opacity-30 cursor-not-allowed hover:bg-transparent hover:text-slate-400')}>
                              <ChevronDown size={15} />
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg ${item.iconColor || 'bg-blue-600'} text-white flex items-center justify-center overflow-hidden shrink-0`}>
                        {item.avatar ? <img src={item.avatar} alt="" className="w-full h-full object-cover" /> : renderIcon(item.icon, 16)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{item.name}</div>
                        <div className="text-xs text-slate-400 truncate max-w-[220px]">{item.desc}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{item.kind === 'agent' ? '智能体' : '工作流'}</td>
                  <td className="px-5 py-3 text-slate-600">{catName(item.category)}</td>
                  <td className="px-5 py-3 text-slate-700 font-medium">{item.priceRate} <span className="text-xs font-normal text-slate-400">{item.kind === 'agent' ? '点/千token' : '点/次'}</span></td>
                  <td className="px-5 py-3 text-slate-600">
                    <UsesCell
                      id={item.id}
                      kind={item.kind}
                      value={item.uses || 0}
                      onCommit={(n) => item.kind === 'agent' ? updateAgent(item.id, { uses: n }) : updateWorkflow(item.id, { uses: n })}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${item.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.published ? '已上架' : '未上架'}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={e => { e.stopPropagation(); open(item); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="编辑"><Edit2 size={15} /></button>
                      <button onClick={e => { e.stopPropagation(); togglePublished(item.id, item.kind); }} className="p-1.5 rounded-lg hover:bg-slate-100">
                        {item.published ? <ToggleRight size={17} className="text-emerald-600" /> : <ToggleLeft size={17} />}
                      </button>
                      <Link to={item.kind === 'agent' ? `/chat/${item.id}` : `/workflow/${item.id}`} onClick={e => e.stopPropagation()} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="预览"><Eye size={15} /></Link>
                      <button onClick={e => { e.stopPropagation(); remove(item); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {/* 分页：每页 12 条。放在 Card 内部做底部条，与「用户管理 / 订单管理」的 AdminPagination 同款。
              total 传过滤后的全量条数，排序调整后条数不变，页码不会因调序跳动。 */}
          <AdminPagination page={safePage} total={list.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </Card>
      )}
    </div>
  );
}
