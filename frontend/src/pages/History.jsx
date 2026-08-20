import { useStore } from '../store.jsx';
import { Clock, Bot, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function History() {
  const { user, history } = useStore();
  if (!user) return <div className="text-center text-slate-500 py-20">请先登录</div>;

  const userHistory = history.filter(h => h.userId === user.id || !h.userId);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">使用记录</h1>
        <p className="text-slate-500 text-sm">你使用过的智能体、工作流及算力消耗明细</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {userHistory.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Clock size={48} className="mx-auto mb-4 opacity-50" />
            <p>暂无使用记录，去智能体广场试试吧</p>
            <Link to="/agents" className="inline-flex items-center gap-1 mt-4 text-blue-600 font-medium hover:underline">去逛逛 <ArrowRight size={16} /></Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {userHistory.map(h => (
              <div key={h.id} className="p-5 hover:bg-slate-50 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Bot size={18} /></div>
                    <div>
                      <div className="font-semibold text-slate-900">{h.agentName || h.workflowName || h.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{new Date(h.createdAt).toLocaleString('zh-CN')}</div>
                    </div>
                  </div>
                  <div className="text-right"><div className="text-sm font-bold text-red-500">-{h.cost} 点</div></div>
                </div>
                <p className="mt-3 text-sm text-slate-500 line-clamp-2 pl-[52px]">{h.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
