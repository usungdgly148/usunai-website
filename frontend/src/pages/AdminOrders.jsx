import { useStore } from '../store.jsx';
import { useState, useEffect } from 'react';
import { Search, Receipt, RotateCcw, XCircle, CheckCircle2, CreditCard } from 'lucide-react';
import { AdminPageHeader, AdminPagination, Card } from '../adminUI.jsx';
import { ORDER_TYPE_LABELS } from '../mock.js';

const STATUS_LABEL = {
  paid: '已支付',
  pending: '待支付',
  refunded: '已退款',
  closed: '已关闭',
};

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

export default function AdminOrders() {
  const { orders, adminUsers, updateOrderStatus, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const filtered = orders.filter(o => {
    const user = adminUsers.find(u => u.id === o.userId);
    const matchSearch = o.name.includes(search) || o.id.includes(search) || user?.name.includes(search) || user?.phone?.includes(search) || user?.email?.includes(search);
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchType = typeFilter === 'all' || o.type === typeFilter;
    return matchSearch && matchStatus && matchType;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedOrders = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const todayRevenue = orders.filter(o => o.status === 'paid' && new Date(o.createdAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((s, o) => s + o.amount, 0);
  const weekRevenue = orders.filter(o => o.status === 'paid' && new Date(o.createdAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).reduce((s, o) => s + o.amount, 0);
  const monthRevenue = orders.filter(o => o.status === 'paid' && new Date(o.createdAt).getMonth() === new Date().getMonth()).reduce((s, o) => s + o.amount, 0);
  const totalPaid = orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0);

  const Stat = ({ label, value }) => (
    <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">¥{value.toLocaleString()}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="订单财务"
        subtitle="算力套餐订单、微信支付记录与退款核销管理"
      />

      {/* 营收概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="今日营收" value={todayRevenue} />
        <Stat label="近 7 日营收" value={weekRevenue} />
        <Stat label="本月营收" value={monthRevenue} />
        <Stat label="累计实收" value={totalPaid} />
      </div>

      {/* 订单列表 */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 font-bold text-slate-900"><Receipt size={18} /> 订单列表</div>
          <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
            <div className="flex bg-slate-50 rounded-lg p-1">
              {TYPE_TABS.map(key => (
                <button key={key.key} onClick={() => setTypeFilter(key.key)} className={`px-3 py-1 rounded text-xs font-medium transition ${typeFilter === key.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                  {key.label}
                </button>
              ))}
            </div>
            <div className="flex bg-slate-50 rounded-lg p-1">
              {['all', 'paid', 'pending', 'refunded', 'closed'].map(key => (
                <button key={key} onClick={() => setStatusFilter(key)} className={`px-3 py-1 rounded text-xs font-medium transition ${statusFilter === key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                  {key === 'all' ? '全部' : STATUS_LABEL[key]}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索订单号 / 用户 / 套餐" className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-5 py-3 font-medium">订单号</th>
              <th className="text-left px-5 py-3 font-medium">类型</th>
              <th className="text-left px-5 py-3 font-medium">动作</th>
              <th className="text-left px-5 py-3 font-medium">用户</th>
              <th className="text-left px-5 py-3 font-medium">商品</th>
              <th className="text-left px-5 py-3 font-medium">金额</th>
              <th className="text-left px-5 py-3 font-medium">状态</th>
              <th className="text-left px-5 py-3 font-medium">时间</th>
              <th className="text-left px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {pagedOrders.map(o => {
              const user = adminUsers.find(u => u.id === o.userId);
              return (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500 font-mono text-xs">{o.id}</td>
                  <td className="px-5 py-3 text-slate-700">{ORDER_TYPE_LABELS[o.type] || o.type}</td>
                  <td className="px-5 py-3 text-slate-600">{o.action || '充值'}</td>
                  <td className="px-5 py-3">
                    <div className="text-slate-900">{user?.name || o.userId}</div>
                    <div className="text-xs text-slate-400">{user?.phone || user?.email}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-700">{o.name}</td>
                  <td className="px-5 py-3 font-semibold text-slate-900">¥{o.amount}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-1 rounded text-xs ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span></td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {o.status === 'paid' && (
                        <button onClick={() => { if (window.confirm('确认对该订单执行退款？')) updateOrderStatus(o.id, 'refunded'); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600" title="退款"><RotateCcw size={15} /></button>
                      )}
                      {(o.status === 'pending' || o.status === 'paid') && (
                        <button onClick={() => { if (window.confirm('确认关闭该订单？')) updateOrderStatus(o.id, 'closed'); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="关闭"><XCircle size={15} /></button>
                      )}
                      {o.status === 'closed' && (
                        <button onClick={() => updateOrderStatus(o.id, 'paid')} className="p-1.5 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600" title="恢复为已支付"><CheckCircle2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-400 text-sm">没有符合条件的订单</td></tr>}
          </tbody>
        </table>
        <AdminPagination page={page} total={filtered.length} pageSize={pageSize} onPageChange={setPage} />
      </Card>
    </div>
  );
}
