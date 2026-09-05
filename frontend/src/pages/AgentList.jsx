import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { CategoryIcon, AgentCard, PageTitle } from '../components.jsx';

const PAGE_SIZE = 9;

export default function AgentList({ mode }) {
  const { sortedCategories, agents, workflows, refreshAllConfig } = useStore();
  const [activeCat, setActiveCat] = useState('all');
  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig, activeCat]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const isWorkflow = mode === 'workflow';

  // 筛选 chips = 已上架且出现在侧栏或首页标签的分类（按 sortOrder 排序）
  const filterCats = sortedCategories
    .filter(c => c.id !== 'all' && c.published && (c.showInSidebar || c.showInTags))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  // 列表装配：
  // - /workflows 路由 → 只列工作流（保持原行为）
  // - /agents 路由 + 非"全部" → 只列该分类的智能体（保持原筛选）
  // - /agents 路由 + "全部"  → 智能体 + 工作流混排（新增）
  let items;
  if (isWorkflow) {
    items = workflows.filter(w => w.published);
  } else if (activeCat === 'all') {
    items = [
      ...agents.filter(a => a.published).map(a => ({ ...a, kind: 'agent' })),
      ...workflows.filter(w => w.published).map(w => ({ ...w, kind: 'workflow' })),
    ];
  } else {
    items = agents.filter(a => a.published);
  }
  const q = (search || '').trim().toLowerCase();
  items = items.filter(item => {
    if (activeCat !== 'all' && item.category !== activeCat) return false;
    if (!q) return true;
    return (item.name || '').toLowerCase().includes(q) || (item.desc || '').toLowerCase().includes(q);
  });

  // 任何筛选/搜索变化 → 回到第 1 页（防残留页码越界）
  useEffect(() => { setPage(1); }, [activeCat, search, isWorkflow]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto">
      <PageTitle title={isWorkflow ? 'AI 工作流' : 'AI 智能体'} subtitle={isWorkflow ? '把复杂任务变成可复用的自动化流程' : '选择适合你业务场景的智能体，开始获客'} />

      <div className="sticky top-16 z-20 bg-[#f0f4f9]/95 backdrop-blur py-4 mb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-slate-200/60">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`搜索${isWorkflow ? '工作流' : '智能体'}...`} className="w-full pl-9 pr-4 py-2 rounded-full border border-slate-200 bg-white text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            <button onClick={() => setActiveCat('all')} className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${activeCat === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>全部</button>
            {filterCats.map(cat => (
              <button key={cat.id} onClick={() => setActiveCat(cat.id)} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${activeCat === cat.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <CategoryIcon name={cat.icon} size={14} /> {cat.name}
                {cat.showInHome && <span className="text-amber-400 leading-none">🔥</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pageItems.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="text-5xl mb-4">🤖</div>
          <p>未找到符合条件的{isWorkflow ? '工作流' : '智能体'}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {pageItems.map(item => (
              <AgentCard
                key={`${item.kind || (isWorkflow ? 'workflow' : 'agent')}-${item.id}`}
                item={item}
                to={item.kind === 'workflow' || isWorkflow ? `/workflow/${item.id}` : `/chat/${item.id}`}
              />
            ))}
          </div>

          {/* 分页导航：每页 PAGE_SIZE 张，底部上一页/下一页 + 页码 */}
          {items.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 mt-10">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={16} /> 上一页
              </button>
              <span className="text-sm text-slate-500 tabular-nums">
                第 {safePage} / {totalPages} 页 · 共 {items.length} 个
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                下一页 <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
