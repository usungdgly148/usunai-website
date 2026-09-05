import { useStore } from '../store.jsx';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertCircle } from 'lucide-react';

export default function AdminLogin() {
  const { adminLogin, siteConfig } = useStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({ account: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!form.account || !form.password) {
      setError('请输入账号和密码');
      return;
    }
    if (form.account !== 'admin') {
      setError('账号不存在，仅超级管理员可登录');
      return;
    }
    setLoading(true);
    // 2026-08-03 商用安全：管理员密码由服务端校验（不再前端比对 localStorage 明文）
    const res = await adminLogin({ account: 'admin', password: form.password });
    setLoading(false);
    if (!res || !res.ok) {
      setError((res && res.msg) || '密码错误');
      return;
    }
    navigate('/admin');
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex w-1/2 bg-slate-950 items-center justify-center relative overflow-hidden">
        <img src="https://images.unsplash.com/photo-1515462277126-2dd0c162007a?w=800&auto=format&fit=crop" alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="relative z-10 text-white text-center px-10">
          <div className="text-3xl font-bold mb-2">{siteConfig.name}</div>
          <p className="text-white/80">管理后台 · 一站式 AI 获客管理</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm"><Sparkles size={18} /></div>
            <span className="font-semibold text-slate-900">{siteConfig.name} 管理后台</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">超级管理员登录</h1>
          <p className="text-sm text-slate-500 mb-8">仅限超级管理员账号登录</p>

          {error && (
            <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-50 text-rose-700 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="text-sm text-slate-700 mb-1 block">管理员账号</label>
              <input type="text" placeholder="admin" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-sm text-slate-700 mb-1 block">密码</label>
              <input type="password" placeholder="" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && submit()}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <button onClick={submit} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98]">
              登录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
