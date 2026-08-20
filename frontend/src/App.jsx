import { Routes, Route, useLocation, Link, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sidebar, Header, RechargeDialog } from './components.jsx';
import { useStore } from './store.jsx';
import { getToken, getAdminToken } from './authFetch.js';
import { ADMIN_NAV, findNavMeta } from './adminUI.jsx';
import { Sparkles, Menu, ArrowLeft, Building2, KeyRound, X, Check, MessageCircle, AtSign, Music, QrCode, AlertTriangle } from 'lucide-react';
import Home from './pages/Home.jsx';
import AgentList from './pages/AgentList.jsx';
import Chat from './pages/Chat.jsx';
import Workflow from './pages/Workflow.jsx';
import History from './pages/History.jsx';
import Profile from './pages/Profile.jsx';
import Assets from './pages/Assets.jsx';
import Orders from './pages/Orders.jsx';
import ComputeRecords from './pages/ComputeRecords.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AdminAgents from './pages/AdminAgents.jsx';
import AdminAgentEdit from './pages/AdminAgentEdit.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import AdminWorkflowEdit from './pages/AdminWorkflowEdit.jsx';
import AdminCategories from './pages/AdminCategories.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminAssets from './pages/AdminAssets.jsx';
import AdminCompute from './pages/AdminCompute.jsx';
import AdminOrders from './pages/AdminOrders.jsx';
import AdminSettings from './pages/AdminSettings.jsx';
import AdminRecommend from './pages/AdminRecommend.jsx';
import AdminLanding from './pages/AdminLanding.jsx';
import AdminAuthProviders from './pages/AdminAuthProviders.jsx';
import AdminAnnouncements from './pages/AdminAnnouncements.jsx';
import AdminLegalAgreements from './pages/AdminLegalAgreements.jsx';
import CustomerService from './CustomerService.jsx';

function FrontLayout() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return null;

  const isInternal = location.pathname.startsWith('/chat/') || location.pathname.startsWith('/workflow/');
  const { computePackages, customerService, rechargeInfo, rechargeModalOpen, rechargeExpiryDate, rechargeHideExpiry, closeRechargeModal } = useStore();

  return (
    <div className="min-h-screen bg-[#f0f4f9]">
      {!isInternal && <Sidebar />}
      <div className={`min-h-screen flex flex-col ${isInternal ? '' : 'ml-0 md:ml-[25%]'}`}>
        <Header />
        <main className={`flex-1 ${isInternal ? '' : 'px-4 sm:px-6 md:px-8 py-6'}`}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/agents" element={<AgentList />} />
            <Route path="/workflows" element={<AgentList mode="workflow" />} />
            <Route path="/chat/:id" element={<Chat />} />
            <Route path="/workflow/:id" element={<Workflow />} />
            <Route path="/history" element={<History />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/compute-records" element={<ComputeRecords />} />
          </Routes>
        </main>
        {!isInternal && <Footer />}
        <CustomerService />
      </div>
      {/* 充值弹窗提升到 App 顶层，由 store 全局控制（Header / 到期拦截 均可触发） */}
      {rechargeModalOpen && createPortal(
        <RechargeDialog packages={computePackages} qr={customerService?.qr} info={rechargeInfo} expiryDate={rechargeExpiryDate} hideExpiry={rechargeHideExpiry} onClose={closeRechargeModal} />,
        document.body
      )}
    </div>
  );
}

function AdminLayout() {
  const location = useLocation();
  const { adminUser, changeAdminPassword, siteConfig } = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pwdModal, setPwdModal] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new: '', confirm: '' });
  const [pwdMsg, setPwdMsg] = useState(null);
  if (!location.pathname.startsWith('/admin')) return null;
  if (location.pathname === '/admin/login') {
    return <Routes><Route path="/admin/login" element={<AdminLogin />} /></Routes>;
  }
  // 登录守卫：未登录/无有效 token 的超级管理员一律跳转到登录页
  // 2026-08-04：admin token 已独立为 clone_admin_token，必须用 getAdminToken() 检查。
  // 因为 admin 登录后 clone_token 被清空（避免污染手机用户 token），getToken() 永远返回空。
  if (!adminUser || !getAdminToken()) {
    return <Navigate to="/admin/login" replace />;
  }

  const meta = findNavMeta(location.pathname);

  return (
    <div className="min-h-screen bg-[#f0f4f9] flex">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center px-5 border-b border-slate-100">
          <Link to="/admin" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm"><Sparkles size={18} /></div>
            <div className="leading-tight">
              <div className="font-bold text-slate-900 text-[15px]">{siteConfig.name}</div>
              <div className="text-[11px] text-slate-400 -mt-0.5">管理后台</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-6 overflow-y-auto scrollbar-thin">
          {ADMIN_NAV.map(group => (
            <div key={group.label}>
              <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
              <div className="space-y-1">
                {group.items.map(item => {
                  const active = item.href === '/admin'
                    ? location.pathname === '/admin'
                    : location.pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.label}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition relative ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                    >
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-blue-600" />}
                      <item.icon size={18} className={active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-500'} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-100 space-y-1.5">
          <button
            onClick={() => { setPwdForm({ old: '', new: '', confirm: '' }); setPwdMsg(null); setPwdModal(true); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
          >
            <KeyRound size={18} className="text-slate-400" /> 更改登录密码
          </button>
          <Link to="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition">
            <ArrowLeft size={18} className="text-slate-400" /> 返回前台
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200/70 sticky top-0 z-20 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-400 leading-none">{meta.group}</div>
              <div className="text-sm font-semibold text-slate-900 leading-tight truncate">{meta.item}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              <Building2 size={13} /> {adminUser?.tenant || 'my-shop'}
            </span>
            <div className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold shadow-sm">
              {adminUser?.name?.slice(0, 1) || 'A'}
            </div>
            <span className="hidden sm:inline text-sm text-slate-700 font-medium">{adminUser?.name || '管理员'}</span>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8">
          <Routes>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/agents" element={<AdminAgents />} />
            <Route path="/admin/agents/new" element={<AdminAgentEdit isNew />} />
            <Route path="/admin/agents/:id" element={<AdminAgentEdit />} />
            <Route path="/admin/auth-providers" element={<AdminAuthProviders />} />
            <Route path="/admin/workflows/new" element={<AdminWorkflowEdit isNew />} />
            <Route path="/admin/workflows/:id" element={<AdminWorkflowEdit />} />
            <Route path="/admin/categories" element={<AdminCategories />} />
            <Route path="/admin/recommend" element={<AdminRecommend />} />
            <Route path="/admin/landing" element={<AdminLanding />} />
            <Route path="/admin/announcements" element={<AdminAnnouncements />} />
            <Route path="/admin/legal-agreements" element={<AdminLegalAgreements />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/assets" element={<AdminAssets />} />
            <Route path="/admin/compute" element={<AdminCompute />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Routes>
        </main>
      </div>

      {/* 更改密码弹窗 */}
      {pwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setPwdModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">更改超级管理员登录密码</h2>
            {pwdMsg && (
              <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${pwdMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{pwdMsg.msg}</div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">原密码</label>
                <input type="password" value={pwdForm.old} onChange={e => setPwdForm({ ...pwdForm, old: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" placeholder="输入当前密码" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">新密码</label>
                <input type="password" value={pwdForm.new} onChange={e => setPwdForm({ ...pwdForm, new: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" placeholder="至少 6 位" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">确认新密码</label>
                <input type="password" value={pwdForm.confirm} onChange={e => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" placeholder="再次输入新密码" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setPwdModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">取消</button>
              <button onClick={async () => {
                if (pwdForm.new !== pwdForm.confirm) { setPwdMsg({ ok: false, msg: '两次输入的新密码不一致' }); return; }
                const r = await changeAdminPassword(pwdForm.old, pwdForm.new);
                setPwdMsg(r);
                if (r.ok) setTimeout(() => setPwdModal(false), 1000);
              }} className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition flex items-center justify-center gap-1.5">
                <Check size={16} /> 确认修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const { landing, siteConfig, legalAgreements } = useStore();
  const { footer } = landing;
  const [openAgreement, setOpenAgreement] = useState(null);
  const agreement = openAgreement ? legalAgreements?.[openAgreement] : null;
  const extraLegalLinks = (footer.legalLinks || []).filter(l => {
    const text = String(l.label || '');
    return !/隐私政策|服务条款|ICP|备案/.test(text);
  });

  return (
    <footer className="bg-transparent border-t border-slate-200/40">
      <div className="max-w-7xl mx-auto px-6 pt-5 md:pt-6 pb-6 md:pb-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 md:gap-5">
          {/* 品牌区 */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm">
                <Sparkles size={18} />
              </div>
              <span className="font-bold text-slate-900 text-lg">{siteConfig.name}</span>
            </div>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-xs">
              {footer.tagline}
            </p>
            <div className="flex items-center gap-3">
              <a href="#" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition" aria-label="微信"><MessageCircle size={18} /></a>
              <a href="#" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition" aria-label="微博"><AtSign size={18} /></a>
              <a href="#" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition" aria-label="抖音"><Music size={18} /></a>
              <a href="#" className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition" aria-label="公众号"><QrCode size={18} /></a>
            </div>
          </div>

          {/* 链接列 */}
          {footer.columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-semibold text-slate-900 mb-4 text-sm">{col.title}</h4>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href === '#' ? (
                      <a href="#" className="text-sm text-slate-500 hover:text-brand-600 transition">{l.label}</a>
                    ) : (
                      <Link to={l.href} className="text-sm text-slate-500 hover:text-brand-600 transition">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200/60 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <span>{footer.copyright}</span>
          <div className="flex flex-wrap items-center gap-4 md:gap-6">
            {extraLegalLinks.map(l => (
              <a key={l.label} href={l.href} className="hover:text-slate-600" target={l.href && l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{l.label}</a>
            ))}
            <button type="button" onClick={() => setOpenAgreement('privacy')} className="hover:text-slate-600">隐私政策</button>
            <button type="button" onClick={() => setOpenAgreement('terms')} className="hover:text-slate-600">服务条款</button>
            {/* ICP 备案号（合规必挂，2026-07-29 上线，从站点设置读取） */}
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600">{siteConfig.icp}</a>
            {/* 公安联网备案：数据码 52f49c065ac090ca842c1359deccefbd。待主人从公安平台「复制代码」粘贴完整片段后启用（见 store.jsx 同名注释）。 */}
          </div>
        </div>
      </div>
      {openAgreement && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4" onClick={() => setOpenAgreement(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 px-5 md:px-7 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{agreement?.title || (openAgreement === 'privacy' ? '隐私政策' : '服务条款')}</h2>
              <button type="button" onClick={() => setOpenAgreement(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 md:px-7 py-5 text-sm leading-7 text-slate-700 prose prose-slate max-w-none">
              {agreement?.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{agreement.content}</ReactMarkdown>
              ) : (
                <p className="text-slate-400">协议内容暂未配置。</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </footer>
  );
}

// 持久化失败提示：admin 显式操作（addAgent / updateBanner / updateLanding ...）写回服务端失败时，
// store 设置 persistError，这里在顶层弹出 Toast 告知用户「同步失败，请刷新重试」。
// 这是 2026-07-29 silent overwrite 修复的一部分：失败不再被 .catch(()=>null) 静默吞掉。
function PersistErrorToast() {
  const { persistError, dismissPersistError } = useStore();
  useEffect(() => {
    if (!persistError) return;
    const t = setTimeout(() => dismissPersistError(), 6000);
    return () => clearTimeout(t);
  }, [persistError, dismissPersistError]);
  if (!persistError) return null;
  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[calc(100%-2rem)] pointer-events-none">
      <div className="pointer-events-auto flex items-start gap-3 bg-rose-600 text-white rounded-xl shadow-lg px-4 py-3 ring-1 ring-rose-700/30">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div className="text-sm leading-relaxed flex-1">{persistError.msg}</div>
        <button onClick={dismissPersistError} className="shrink-0 opacity-80 hover:opacity-100 transition" aria-label="关闭">
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  );
}

export default function App() {
  const { siteConfig } = useStore();
  // 站点名称 + 标语 同步到浏览器标题（后台「站点设置」修改后实时生效）
  useEffect(() => {
    document.title = siteConfig.slogan ? `${siteConfig.name} · ${siteConfig.slogan}` : siteConfig.name;
  }, [siteConfig.name, siteConfig.slogan]);
  return (
    <>
      <FrontLayout />
      <AdminLayout />
      <PersistErrorToast />
    </>
  );
}
