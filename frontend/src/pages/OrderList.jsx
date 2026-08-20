import { useStore } from '../store.jsx';
import { ShoppingCart, Crown } from 'lucide-react';

export default function OrderList() {
  const { orders } = useStore();
  const statusMap = { success: '成功', pending: '处理中', failed: '失败' };
  return (
    <div className="max-w-5xl mx-auto w-full bg-white rounded-xl border border-slate-200 p-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">订单记录</h1>
      <div className="space-y-3">
        {orders.map(o => (
          <div key={o.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-100 hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                {o.type === 'vip' ? <Crown size={18} /> : <ShoppingCart size={18} />}
              </div>
              <div>
                <div className="text-sm font-medium text-slate-900">{o.title}</div>
                <div className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-slate-900">¥{o.amount}</span>
              {o.points && <span className="text-xs text-slate-500">+{o.points} 点</span>}
              <span className="text-xs px-2 py-1 rounded bg-green-50 text-green-700">{statusMap[o.status]}</span>
            </div>
          </div>
        ))}
        {orders.length === 0 && <div className="text-center text-slate-400 py-12">暂无订单</div>}
      </div>
    </div>
  );
}
