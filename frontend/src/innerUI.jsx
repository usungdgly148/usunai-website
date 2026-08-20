import { useState, useEffect } from 'react';
import { useStore } from './store.jsx';
import { CategoryIcon, formatCount, genCaptcha } from './components.jsx';
import {
  MessageSquare, Clock, Plus, X, Sparkles, Users, Zap, CheckCircle2, MessageCircle,
} from 'lucide-react';

/* ---------- helpers ---------- */

export function timeAgo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (diff < 86400) return `今天 ${hh}:${mm}`;
  if (diff < 172800) return `昨天 ${hh}:${mm}`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function getSuggestions(entity) {
  const qs = entity?.suggestedQuestions;
  return Array.isArray(qs) && qs.length ? qs.filter(q => typeof q === 'string' && q.trim()) : [];
}

/* 真正返回上一步：优先回退浏览器历史，无历史记录时回首页 */
export function goBack(navigate) {
  if (window.history.length > 1) navigate(-1);
  else navigate('/');
}

/* ---------- left history panel (shared by chat & workflow) ---------- */

export function HistoryPanel({ label, items, activeId, onSelect, onNew, emptyHint }) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-200/70">
        <button
          onClick={onNew}
          className="group flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium shadow-soft hover:shadow-pop hover:-translate-y-0.5 active:translate-y-0 transition"
        >
          <Plus size={16} strokeWidth={2.6} /> {label}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        <div className="flex items-center gap-1.5 px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <Clock size={12} /> 历史记录
        </div>

        {items.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center text-slate-300">
              <MessageSquare size={20} />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">{emptyHint}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((h) => (
              <button
                key={h.id}
                onClick={() => onSelect(h)}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition ${
                  activeId === h.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className={`text-sm truncate ${activeId === h.id ? 'text-blue-700 font-medium' : 'text-slate-600'}`}>
                  {h.title}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{timeAgo(h.updatedAt || h.createdAt)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- right info card (shared by chat & workflow) ---------- */

export function InfoCard({ entity, type }) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6">
      <div className="text-center">
        <div className={`relative w-20 h-20 mx-auto mb-4 rounded-2xl ${entity.iconColor} flex items-center justify-center text-white shadow-pop`}>
          <CategoryIcon name={entity.icon} size={32} avatar={entity.avatar} imgClassName="rounded-2xl" />
          <span className="absolute -bottom-1.5 -right-1.5 px-2 py-0.5 rounded-full bg-white text-[10px] font-semibold text-slate-500 shadow-soft border border-slate-100">
            {type === 'agent' ? '智能体' : '工作流'}
          </span>
        </div>
        <h2 className="text-lg font-bold text-slate-900">{entity.name}</h2>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{entity.desc}</p>
      </div>

      <div className="mt-6 space-y-2.5">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Zap size={14} />
            </span>
            {/* 这个字段是 entity.priceRate（点/千 token 的"单价"），不是本次任务的实际扣点；
                实际扣点由 computeCost 按 totalTokens × 1.15 × priceRate / 1000 算出，
                显示在对话气泡底部。改叫"单价"避免主人误以为"已经扣了 20 点"。 */}
            单价
          </span>
          <span className="text-sm text-slate-900 tabular-nums">
            {entity.priceRate} 点
            <span className="text-xs text-slate-400"> / {type === 'agent' ? '千 token' : '次'}</span>
          </span>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Users size={14} />
            </span>
            使用次数
          </span>
          <span className="text-base text-slate-900 tabular-nums">{formatCount(entity.uses)}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- mobile drawer ---------- */

export function Drawer({ open, onClose, side = 'left', title, children }) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 ${side === 'left' ? 'left-0' : 'right-0'} h-full w-[82%] max-w-[320px] bg-white z-50 shadow-pop transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200/70">
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X size={18} />
          </button>
        </div>
        <div className="h-[calc(100%-3.5rem)]">{children}</div>
      </aside>
    </>
  );
}

/* ---------- inner sub-header (within center column) ---------- */

export function SubHeader({ entity, type, onToggleHistory, onToggleInfo, right }) {
  return (
    <div className="flex items-center gap-3 px-4 lg:px-6 h-14 bg-[#f0f4f9]/85 backdrop-blur-md border-b border-slate-200/60 shrink-0">
      <div className={`relative overflow-hidden w-9 h-9 rounded-xl ${entity.iconColor} text-white flex items-center justify-center shadow-soft shrink-0`}>
        <CategoryIcon name={entity.icon} size={18} avatar={entity.avatar} imgClassName="rounded-xl" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 truncate">{entity.name}</div>
        <div className="text-xs text-slate-400 truncate">
          {type === 'agent' ? 'AI 智能体 · 即时对话创作' : '配置参数 · 一键运行'}
        </div>
      </div>

      {right}

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleHistory}
          className="md:hidden w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
          title="历史记录"
        >
          <MessageSquare size={18} />
        </button>
        <button
          onClick={onToggleInfo}
          className="xl:hidden w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
          title="智能体信息"
        >
          <Sparkles size={18} />
        </button>
      </div>
    </div>
  );
}

/* ---------- lightweight login gate ---------- */

export function RequireLoginModal({ onClose }) {
  const { login, register, loginWithEmail } = useStore();
  const [mode, setMode] = useState('phone'); // 'phone' | 'email'

  // 手机号模式
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [showCode, setShowCode] = useState('');
  const [error, setError] = useState('');

  // 邮箱模式（与 LoginModal 一致：登录/注册切换 + 人机校验码防止暴力）
  const [emailMode, setEmailMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState(() => genCaptcha());
  const [captchaInput, setCaptchaInput] = useState('');
  useEffect(() => {
    if (mode === 'email') { setCaptcha(genCaptcha()); setCaptchaInput(''); }
  }, [mode]);

  const sendCode = async () => {
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setError('请输入有效的手机号'); return; }
    try {
      const r = await (await fetch('/api/auth/phone-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })).json();
      if (!r.ok) { setError(r.msg || '获取验证码失败'); return; }
      setSent(true);
      setShowCode(r.devCode || ''); // 演示环境直接展示验证码；真实环境 devCode 为空，提示查收短信
    } catch { setError('网络异常，请稍后重试'); }
  };

  const goPhone = async () => {
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setError('请输入有效的手机号'); return; }
    if (!code.trim()) { setError('请先获取并输入验证码'); return; }
    try {
      const r = await (await fetch('/api/auth/phone-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      })).json();
      if (!r.ok) { setError(r.msg || '验证失败'); return; }
      login(r.user, r.token || ''); // 手机号验证码登录：服务端已签发会话 token
      onClose();
    } catch { setError('网络异常，请稍后重试'); }
  };

  const goEmail = (e) => {
    e.preventDefault();
    setError('');
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email.trim())) { setError('请输入有效的邮箱地址'); return; }
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    if (captchaInput.trim().toLowerCase() !== captcha.toLowerCase()) {
      setError('校验码错误，请重新输入');
      setCaptcha(genCaptcha());
      setCaptchaInput('');
      return;
    }
    if (emailMode === 'register') {
      if (password !== confirm) { setError('两次输入的密码不一致'); return; }
      const ok = register(email.trim(), password);
      if (!ok) { setError('该邮箱已注册，请直接登录'); return; }
    } else {
      const ok = loginWithEmail(email.trim(), password);
      if (!ok) { setError('邮箱或密码错误'); return; }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-pop w-full max-w-sm overflow-hidden animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="p-7">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white flex items-center justify-center mb-4 shadow-soft">
            <Sparkles size={22} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">登录后开始创作</h3>
          <p className="text-sm text-slate-500 mt-1 mb-5">登录即可使用智能体，并为你保存每一次对话历史</p>

          {/* 手机号 / 邮箱 切换 */}
          <div className="flex bg-slate-100 rounded-lg p-1 mb-4">
            <button type="button" onClick={() => { setMode('phone'); setError(''); }} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${mode === 'phone' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>手机号</button>
            <button type="button" onClick={() => { setMode('email'); setError(''); }} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${mode === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>邮箱</button>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</div>}

          {mode === 'phone' && (
            <div className="space-y-3">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="输入手机号"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition"
              />
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="请输入验证码"
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                >
                  {sent ? '重新发送' : '获取验证码'}
                </button>
              </div>
              {sent && (
                <div className="text-xs text-slate-500">
                  {showCode ? (
                    <>演示验证码：<span className="font-mono px-1.5 py-0.5 bg-slate-100 rounded">{showCode}</span>（真实环境将发送短信）</>
                  ) : (
                    <span className="text-emerald-600">验证码已发送，请查收手机短信</span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={goPhone}
                disabled={!phone.trim() || !code.trim()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white font-medium shadow-soft disabled:opacity-40 hover:shadow-pop transition"
              >
                登录 / 注册
              </button>
            </div>
          )}

          {mode === 'email' && (
            <form onSubmit={goEmail} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入邮箱" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition" required />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码（至少 6 位）" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition" required />
              {emailMode === 'register' && (
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="请再次输入密码" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition" required />
              )}
              <div className="flex items-center gap-2">
                <span className="px-3 py-2 bg-slate-100 rounded-md font-mono tracking-[0.3em] text-lg select-none text-slate-700">{captcha}</span>
                <button type="button" onClick={() => { setCaptcha(genCaptcha()); setCaptchaInput(''); }} className="text-xs text-blue-600 hover:underline whitespace-nowrap">换一张</button>
                <input value={captchaInput} onChange={e => setCaptchaInput(e.target.value)} placeholder="输入上方校验码" maxLength={4} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition" required />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white font-medium shadow-soft hover:shadow-pop transition">
                {emailMode === 'login' ? '登录' : '注册'}
              </button>
              <div className="text-center">
                {emailMode === 'login' ? (
                  <button type="button" onClick={() => { setEmailMode('register'); setError(''); }} className="text-xs text-blue-600 hover:underline">还没有账号？去注册</button>
                ) : (
                  <button type="button" onClick={() => { setEmailMode('login'); setError(''); }} className="text-xs text-blue-600 hover:underline">已有账号？去登录</button>
                )}
              </div>
            </form>
          )}

          <div className="flex items-center gap-3 my-4">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-xs text-slate-400">其他登录方式</span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>
          <div className="w-full py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-sm font-medium flex items-center justify-center gap-2 cursor-not-allowed">
            <MessageCircle size={16} /> 微信扫码登录（功能待开放）
          </div>
          <p className="text-xs text-slate-400 text-center mt-4">登录即同意用户协议与隐私政策</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- toast ---------- */

export function Toast({ msg }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] animate-fade-up px-4 py-2.5 rounded-full bg-slate-900/90 text-white text-sm shadow-pop flex items-center gap-2 pointer-events-none">
      <CheckCircle2 size={15} className="text-green-400" />
      {msg}
    </div>
  );
}
