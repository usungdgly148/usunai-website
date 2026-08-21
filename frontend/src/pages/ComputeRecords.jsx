import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { Search, Zap, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import UserPagination from '../components/UserPagination.jsx';
import { paginate, USER_PAGE_SIZE } from '../pagination.js';

const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'recharge', label: '充值' },
  { key: 'consume', label: '消耗' },
];

const TYPE_LABEL = { recharge: '充值', consume: '消耗' };
const TYPE_STYLE = {
  recharge: 'bg-emerald-50 text-emerald-700',
  consume: 'bg-rose-50 text-rose-700',
};

export default function ComputeRecords() {
  const { user, computeRecords, refreshCurrentUserCompute } = useStore();
  const [type, setType] = useState('all');
  const [task, setTask] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!user?.id) return;
    setPage(1);
    refreshCurrentUserCompute();
  }, [user?.id, refreshCurrentUserCompute]);

  if (!user) return <div className="text-center text-slate-500 py-20">请先登录</div>;

  const userRecords = computeRecords
    .filter(r => r.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const taskOptions = useMemo(() => {
    const set = new Set();
    userRecords.forEach(r => set.add(r.title || r.reason || '其他'));
    return ['all', ...Array.from(set)];
  }, [userRecords]);

  // 倒推每条记录发生后的剩余算力
  const rows = useMemo(() => {
    let balance = user.points || 0;
    return userRecords.map(r => {
      const row = { ...r, remaining: balance };
      if (r.type === 'consume') balance += r.amount;
      else balance -= r.amount;
      return row;
    });
  }, [userRecords, user.points]);

  const filtered = rows
    .filter(r => type === 'all' || r.type === type)
    .filter(r => task === 'all' || (r.title || r.reason || '其他') === task)
    .filter(r => (r.title || r.reason || '').includes(search) || (r.id || '').toString().includes(search));
  const pagination = paginate(filtered, page);

  const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : n);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">算力记录</h1>
        <p className="text-slate-500 text-sm">查看您的算力充值与消耗流水</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {TYPE_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => { setType(t.key); setPage(1); }}
                className={`px-3.5 py-2 rounded-xl text-sm font-medium transition ${type === t.key ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select value={task} onChange={e => { setTask(e.target.value); setPage(1); }} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none bg-white">
            {taskOptions.map(t => <option key={t} value={t}>{t === 'all' ? '所有任务' : t}</option>)}
          </select>
          <div className="relative flex-1 lg:max-w-sm lg:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索流水号 / 备注..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-5 py-3.5 font-medium">流水号</th>
                <th className="text-left px-5 py-3.5 font-medium">类型</th>
                <th className="text-left px-5 py-3.5 font-medium">任务</th>
                <th className="text-left px-5 py-3.5 font-medium">变动</th>
                <th className="text-left px-5 py-3.5 font-medium">剩余</th>
                <th className="text-left px-5 py-3.5 font-medium">备注</th>
                <th className="text-left px-5 py-3.5 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-4 text-slate-500 font-mono text-xs">{r.id}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${TYPE_STYLE[r.type]}`}>
                      {r.type === 'consume' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                      {TYPE_LABEL[r.type]}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-700 max-w-xs truncate">{r.title || r.reason || '-'}</td>
                  <td className={`px-5 py-4 font-semibold ${r.type === 'consume' ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {r.type === 'consume' ? '-' : '+'}{fmt(r.amount)}
                  </td>
                  <td className="px-5 py-4 text-slate-700 tabular-nums">{fmt(r.remaining)}</td>
                  <td className="px-5 py-4 text-slate-500 text-xs max-w-xs truncate">{r.reason || r.title || '-'}{r.meta?.totalTokens != null ? ` · ${r.meta.totalTokens} token（估）` : ''}</td>
                  <td className="px-5 py-4 text-slate-500 text-xs whitespace-nowrap">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-400 text-sm">暂无算力记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-5">
          <UserPagination
            page={pagination.currentPage}
            total={pagination.total}
            totalPages={pagination.totalPages}
            pageSize={USER_PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
}
