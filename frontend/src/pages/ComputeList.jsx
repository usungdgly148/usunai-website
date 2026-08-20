import { useStore } from '../store.jsx';
import { Zap, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function ComputeList() {
  const { computeRecords } = useStore();
  return (
    <div className="max-w-5xl mx-auto w-full bg-white rounded-xl border border-slate-200 p-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">算力记录</h1>
      <div className="space-y-3">
        {computeRecords.map(r => (
          <div key={r.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-100 hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${r.type === 'consume' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {r.type === 'consume' ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
              </div>
              <div>
                <div className="text-sm font-medium text-slate-900">{r.title || r.reason}</div>
                <div className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <div className={`font-semibold ${r.type === 'consume' ? 'text-red-600' : 'text-green-600'}`}>
              {r.type === 'consume' ? '-' : '+'}{r.amount} 点
            </div>
          </div>
        ))}
        {computeRecords.length === 0 && <div className="text-center text-slate-400 py-12">暂无算力记录</div>}
      </div>
    </div>
  );
}
