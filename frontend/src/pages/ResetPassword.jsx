import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../authFetch.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [valid, setValid] = useState(null); // null=检查中, true=有效, false=失效
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    apiFetch('/api/auth/forgot-password/check-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(r => r.json()).then(j => setValid(!!j?.ok)).catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async () => {
    if (newPwd.length < 6) { setMsg('新密码至少 6 位'); return; }
    if (newPwd !== confirmPwd) { setMsg('两次输入的密码不一致'); return; }
    const r = await apiFetch('/api/auth/forgot-password/email-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: newPwd }),
    });
    const j = await r.json();
    if (j?.ok) { setDone(true); setMsg('密码重置成功！即将跳转到登录页...'); setTimeout(() => navigate('/?login=1'), 2000); }
    else setMsg(j?.msg || '重置失败');
  };

  if (valid === null) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-slate-500">验证链接中...</div>
    </div>
  );

  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-6 text-center">
        <div className="text-rose-500 text-4xl mb-3">⏰</div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">链接已失效</h2>
        <p className="text-sm text-slate-500 mb-6">重置链接已过期（15 分钟有效），请重新申请。</p>
        <button onClick={() => navigate('/?login=1')} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
          返回登录
        </button>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-6 text-center">
        <div className="text-emerald-500 text-4xl mb-3">✓</div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">密码重置成功</h2>
        <p className="text-sm text-slate-500">{msg}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-1">设置新密码</h2>
        <p className="text-sm text-slate-500 mb-6">为您的账号设置一个新密码</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">新密码（至少 6 位）</label>
            <input type="password" value={newPwd} onChange={e => { setNewPwd(e.target.value); setMsg(''); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">确认新密码</label>
            <input type="password" value={confirmPwd} onChange={e => { setConfirmPwd(e.target.value); setMsg(''); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          {msg && <div className={`p-3 rounded-lg text-sm ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{msg}</div>}
          <button onClick={handleSubmit} className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition">
            重置密码
          </button>
        </div>
      </div>
    </div>
  );
}
