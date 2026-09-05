import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Search, Receipt, CreditCard, RotateCcw, XCircle, CheckCircle2 } from 'lucide-react';
import { ORDER_TYPE_LABELS } from '../mock.js';
import UserPagination from '../components/UserPagination.jsx';
import { paginate, USER_PAGE_SIZE } from '../pagination.js';

const STATUS_LABEL = { paid: '已支付', pending: '待支付', refunded: '已退款', closed: '已关闭' };
const STATUS_STYLE = {
  paid: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  refunded: 'bg-slate-100 text-slate-500',
  closed: 'bg-rose-50 text-rose-700',
};

const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'compute', label: '算力' },
  { key: 'source', label: '源码' },
];

export default function Orders() {
  const { user, orders } = useStore();
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  if (!user) return <div className="text-center text-slate-500 py-20">请先登录</div>;

  const filtered = orders
    .filter(o => o.userId === user.id)
    .filter(o => type === 'all' || o.type === type)
    .filter(o => o.name.includes(search) || o.id.includes(search))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pagination = paginate(filtered, page);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">订单记录</h1>
        <p className="text-slate-500 text-sm">查看您的历史订单</p>
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
          <div className="relative flex-1 lg:max-w-sm lg:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索订单号 / 商品..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-5 py-3.5 font-medium">订单号</th>
                <th className="text-left px-5 py-3.5 font-medium">类型</th>
                <th className="text-left px-5 py-3.5 font-medium">动作</th>
                <th className="text-left px-5 py-3.5 font-medium">商品名称</th>
                <th className="text-left px-5 py-3.5 font-medium">金额</th>
                <th className="text-left px-5 py-3.5 font-medium">状态</th>
                <th className="text-left px-5 py-3.5 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map(o => (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-4 text-slate-500 font-mono text-xs">{o.id}</td>
                  <td className="px-5 py-4 text-slate-700">{ORDER_TYPE_LABELS[o.type] || o.type}</td>
                  <td className="px-5 py-4 text-slate-600">{o.action || '充值'}</td>
                  <td className="px-5 py-4 text-slate-900 font-medium">{o.name}</td>
                  <td className="px-5 py-4 font-semibold text-slate-900">¥{o.amount}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${STATUS_STYLE[o.status]}`}>
                      {o.status === 'paid' && <CheckCircle2 size={12} />}
                      {o.status === 'pending' && <Receipt size={12} />}
                      {o.status === 'refunded' && <RotateCcw size={12} />}
                      {o.status === 'closed' && <XCircle size={12} />}
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-500 text-xs">{new Date(o.createdAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-400 text-sm">暂无订单记录</td></tr>
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
