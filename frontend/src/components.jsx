import { Link, useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useStore, formatPlanDate, getUserPlanStatus } from './store.jsx';
import { apiFetch } from './authFetch.js';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Home, FileText, Video, BookOpen, Radio, Image, Clapperboard, MessageCircle, Search, Briefcase, ShoppingBag,
  Menu, X, User, LogOut, ChevronRight, Sparkles, LayoutGrid, History, Settings, HelpCircle, MessageSquare,
  Grid3X3, Bell, CreditCard, Ticket, Receipt, Flag, Star, Users, Mic, Calendar, ArrowLeft, Archive, Zap, Package,
  Target, Handshake, Crown, UserCircle, Lightbulb, Flame, Copy, Hammer, Boxes, DoorOpen, Layers, Square, Droplets, Sofa, PenTool, HardHat, FileCheck, BadgeCheck, CalendarDays, QrCode, AlertTriangle
} from 'lucide-react';
import QRCode from 'qrcode';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ICON_MAP = {
  Home, FileText, Video, BookOpen, Radio, Image, Clapperboard, MessageCircle, Search, Briefcase, ShoppingBag,
  LayoutGrid, History, Settings, HelpCircle, MessageSquare, Grid3X3, Bell, User, LogOut, Sparkles,
  CreditCard, Ticket, Receipt, Flag, Star, Users, Mic, Calendar,
  Target, Handshake, Crown, UserCircle, Lightbulb, Flame, Copy, Hammer, Boxes, DoorOpen, Layers, Square, Droplets, Sofa, PenTool, HardHat, FileCheck, BadgeCheck, CalendarDays,
};

export function Logo({ className = '', collapsed = false }) {
  const { logo, siteConfig } = useStore();
  return (
    <Link to="/" className={`flex items-center gap-3 font-bold text-2xl tracking-tight ${className}`}>
      <div className="w-10 h-10 flex items-center justify-center overflow-hidden">
        {logo ? (
          <img src={logo} alt="Logo" className="w-full h-full object-contain" />
        ) : (
          <Sparkles size={26} className="text-brand-600" />
        )}
      </div>
      {!collapsed && <span className="text-slate-900">{siteConfig.name}</span>}
    </Link>
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarOpen, setSidebarOpen, sortedCategories, agents, workflows, categoryGroups } = useStore();
  const search = new URLSearchParams(location.search);
  const activeCategory = search.get('category') || 'all';

  const isHomeActive = location.pathname === '/' && activeCategory === 'all';

  // 动态菜单：首页 + 所有 showInSidebar 且已上架、且已归属分组的分类（按 sortOrder 排序）按 group 分组
  const sidebarCats = sortedCategories
    .filter(c => c.id !== 'all' && c.showInSidebar && c.published && c.group?.trim())
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const groupsMap = new Map();
  sidebarCats.forEach(c => {
    const groupName = c.group.trim();
    if (!groupsMap.has(groupName)) groupsMap.set(groupName, []);
    groupsMap.get(groupName).push(c);
  });
  // group 顺序：优先按后台注册表 sortOrder，未知分组靠后
  const groupSortOrder = (name) => {
    const g = categoryGroups.find(x => x.name === name);
    return g ? (g.sortOrder || 0) : 9999;
  };
  const groupEntries = Array.from(groupsMap.entries()).map(([name, items]) => ({
    name,
    items,
    order: Math.min(...items.map(i => i.sortOrder || Infinity)),
  })).sort((a, b) => (groupSortOrder(a.name) - groupSortOrder(b.name)) || (a.order - b.order));

  const isActive = (cat) => activeCategory === cat;


  const homeItemClass = (active) =>
    `group relative flex items-center gap-4 px-5 py-3.5 rounded-full text-[15px] font-medium transition-all duration-200 ease-out hover:translate-x-1 hover:text-brand-700 active:scale-[0.98] motion-reduce:hover:translate-x-0 motion-reduce:active:scale-100 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:rounded-full before:bg-brand-600 before:content-[''] before:origin-center before:transition-transform before:duration-200 ${active ? 'bg-brand-100 text-slate-900 before:scale-y-100' : 'text-slate-700 hover:bg-slate-200/50 before:scale-y-0'}`;

  const subItemClass = (active) =>
    `group relative flex items-center gap-3 px-5 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 ease-out hover:translate-x-1 hover:text-brand-700 active:scale-[0.98] motion-reduce:hover:translate-x-0 motion-reduce:active:scale-100 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:rounded-full before:bg-brand-600 before:content-[''] before:origin-center before:transition-transform before:duration-200 ${active ? 'bg-brand-100 text-brand-700 before:scale-y-100' : 'text-slate-600 hover:bg-slate-200/50 before:scale-y-0'}`;

  return (
    <>
      {/* 手机端遮罩 */}
      {sidebarOpen && (
        <div className="overlay-fade fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed left-0 top-0 h-screen w-[280px] max-w-[85vw] bg-[#f0f4f9] flex flex-col z-50 transition-transform duration-300 md:w-1/4 md:max-w-[320px] md:min-w-[240px] md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center px-5 gap-3">
          {/* 桌面端装饰性汉堡 */}
          <button className="hidden md:flex w-10 h-10 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-200/50 transition">
            <Menu size={22} />
          </button>
          {/* 手机端关闭按钮 */}
          <button onClick={() => setSidebarOpen(false)} className="md:hidden w-10 h-10 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-200/50 transition">
            <X size={22} />
          </button>
          <Logo />
        </div>

        <nav className="flex-1 px-4 py-2 overflow-y-auto apple-scrollbar">
          {/* 首页：单独放在最上方 */}
          <Link to="/" onClick={() => { setSidebarOpen(false); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' }); }}>
            <div className={homeItemClass(isHomeActive)}>
              <Home size={22} strokeWidth={1.8} className="transition-transform duration-200 group-hover:scale-110 motion-reduce:group-hover:scale-100" />
              <span>首页</span>
            </div>
          </Link>

          {/* 分组 */}
          <div className="mt-2 space-y-0">
            {groupEntries.map((group, gIdx) => (
              <div key={group.name} className="pt-4 sidebar-stagger" style={{ animationDelay: `${gIdx * 70}ms` }}>
                {gIdx > 0 && <div className="border-t border-slate-300/60 mb-4 mx-1" />}
                <div className="px-5 mb-1.5 text-[13px] font-medium text-slate-600 tracking-wide">{group.name}</div>
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const Icon = ICON_MAP[item.icon] || Home;
                    const cat = item.cat || item.id;
                    return (
                      <Link key={item.id} to={item.href || `/?category=${item.id}`} onClick={() => setSidebarOpen(false)}>
                        <div className={subItemClass(isActive(cat))}>
                          <Icon size={18} strokeWidth={1.8} className="transition-transform duration-200 group-hover:scale-110 motion-reduce:group-hover:scale-100" />
                          <span>{item.name}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      </aside>
    </>
  );
}

function UserMenuDropdown({ user, onClose, onLogout, onRecharge }) {
  const navigate = useNavigate();
  // 算力套餐有效期（与拦截/续费逻辑同口径，来自 store.getUserPlanStatus）
  const plan = getUserPlanStatus(user);
  // 小字文案：永久 / 已到期 / 有固定到期日 / 未绑定套餐
  let planHint = null;
  if (plan.permanent) {
    planHint = { text: '长期有效', tone: 'text-slate-400' };
  } else if (plan.expired && plan.validTo) {
    planHint = { text: `已到期 ${formatPlanDate(plan.validTo)} · 剩余算力已为您保留`, tone: 'text-amber-600' };
  } else if (plan.hasPlan && plan.validTo) {
    const remainDays = plan.remainingDays;
    planHint = { text: `有效期至 ${formatPlanDate(plan.validTo)}${Number.isFinite(remainDays) ? `（剩 ${remainDays} 天）` : ''}`, tone: 'text-slate-400' };
  }
  const menu = [
    { label: '个人中心', icon: User, to: '/profile' },
    { label: '我的资产', icon: Archive, to: '/assets' },
    { label: '订单记录', icon: Receipt, to: '/orders' },
    { label: '算力记录', icon: Zap, to: '/compute-records' },
  ];
  return (
    <div className="absolute right-0 top-full mt-2 w-[280px] bg-white rounded-2xl shadow-xl border border-slate-100 p-3 z-50 origin-top-right">
      <div className="flex items-center gap-3 p-3">
        <div className="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center text-lg font-bold overflow-hidden shrink-0">
          {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.name?.[0] || 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-900 truncate">{user.name}</div>
        </div>
      </div>
      <div className="flex items-center justify-between p-3 mb-1 rounded-xl bg-gradient-to-r from-violet-50 to-indigo-50">
        <div className="flex flex-col gap-0.5 text-sm text-slate-700">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-violet-600" />
            <span>剩余算力: {user.points || 0}</span>
          </div>
          {planHint && (
            <span className={`pl-6 text-[11px] ${planHint.tone}`}>{planHint.text}</span>
          )}
        </div>
      </div>
      <div className="border-t border-slate-100 my-1"></div>
      {menu.map(item => (
        <button key={item.label} onClick={() => { navigate(item.to); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition">
          <item.icon size={18} className="text-slate-500" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronRight size={16} className="text-slate-300" />
        </button>
      ))}
      <div className="border-t border-slate-100 my-1"></div>
      <button onClick={() => { onLogout(); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-rose-600 hover:bg-rose-50 transition">
        <LogOut size={18} />
        <span>退出登录</span>
      </button>
    </div>
  );
}

export function Header() {
  const { user, sidebarOpen, setSidebarOpen, logout, announcements, computePackages, customerService, rechargeInfo, openRechargeModal, refreshCurrentUser } = useStore();
  const [loginOpen, setLoginOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const menuRef = useRef(null);
  const bellRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isInternal = location.pathname.startsWith('/chat/') || location.pathname.startsWith('/workflow/');

  // 公告未读红点：记录最近一次查看的最新发布时间，有新公告则显示红点
  const LAST_SEEN_KEY = 'clone_ann_last_seen';
  const [lastSeen, setLastSeen] = useState(() => { try { return localStorage.getItem(LAST_SEEN_KEY) || ''; } catch { return ''; } });
  const sortedAnn = useMemo(() => [...(announcements || [])].sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0)), [announcements]);
  const newestIso = sortedAnn.length ? (sortedAnn[0].publishedAt || sortedAnn[0].createdAt || '') : '';
  const hasUnread = !!newestIso && newestIso > lastSeen;

  const openBell = () => {
    setBellOpen(true);
    if (newestIso) { setLastSeen(newestIso); try { localStorage.setItem(LAST_SEEN_KEY, newestIso); } catch { /* ignore */ } }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [menuOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    const handle = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [bellOpen]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-[#f0f4f9]/80 backdrop-blur-md border-b border-slate-200/60 flex items-center justify-between px-4 md:px-6 gap-3">
      <div className="flex items-center gap-3 md:gap-4 shrink-0">
        {!isInternal && (
          <button onClick={() => setSidebarOpen(true)} className="md:hidden w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Menu size={20} />
          </button>
        )}
        {isInternal && (
          <button
            onClick={handleBack}
            className="group flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white/60 hover:bg-white hover:shadow-soft border border-slate-200/70 hover:border-brand-200 text-slate-600 hover:text-brand-600 transition shrink-0"
            title="返回上一步"
            aria-label="返回"
          >
            <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-0.5" />
            <span className="text-sm font-medium hidden sm:inline">返回</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 md:gap-4 ml-auto">
        <button onClick={() => setSearchOpen(true)} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          <Search size={18} />
        </button>
        <div className="hidden sm:block relative" ref={bellRef}>
          <button
            onClick={() => (bellOpen ? setBellOpen(false) : openBell())}
            title="公告通知"
            aria-label="公告通知"
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 relative shrink-0"
          >
            <Bell size={18} />
            {sortedAnn.length > 0 && (
              <span className={`absolute top-1.5 right-2 w-2 h-2 rounded-full ${hasUnread ? 'bg-red-500' : 'bg-slate-300'}`}></span>
            )}
          </button>
          {bellOpen && (
            <AnnouncementPanel
              announcements={sortedAnn}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((v) => (v === id ? null : id))}
              onClose={() => setBellOpen(false)}
            />
          )}
        </div>
        <button
          onClick={() => openRechargeModal()}
          title="算力充值"
          aria-label="算力充值"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-sm shadow-sm transition-colors shrink-0"
        >
          <span className="text-base leading-none" aria-hidden="true">💎</span>
          <span>算力充值</span>
        </button>
        {user ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button data-testid="user-avatar-menu" onClick={() => { if (refreshCurrentUser) refreshCurrentUser(); setMenuOpen(v => !v); }} className="w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold hover:bg-orange-600 overflow-hidden shrink-0">
              {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.name?.slice(0, 1) || 'U'}
            </button>
            {menuOpen && (
              <UserMenuDropdown
                user={user}
                onClose={() => setMenuOpen(false)}
                onLogout={() => logout()}
              />
            )}
          </div>
        ) : (
          <button onClick={() => setLoginOpen(true)} className="inline-flex items-center h-9 px-4 rounded-full bg-brand-600 text-white hover:bg-brand-700 text-sm transition-colors shrink-0" aria-label="登录">
            登录
          </button>
        )}
      </div>
      {loginOpen && createPortal(<LoginModal onClose={() => setLoginOpen(false)} />, document.body)}
      {searchOpen && createPortal(<SearchModal onClose={() => setSearchOpen(false)} />, document.body)}
    </header>
  );
}

// 前台公告通知弹窗：右上角铃铛点开，列表显版本号/类型/标题/时间，可展开 Markdown 图文内容
const ANN_TYPE_META = {
  feature: { label: '新增功能', cls: 'bg-emerald-50 text-emerald-700' },
  optimize: { label: '功能优化', cls: 'bg-blue-50 text-blue-700' },
  fix: { label: '问题修复', cls: 'bg-amber-50 text-amber-700' },
  other: { label: '其他', cls: 'bg-slate-100 text-slate-600' },
};
const ANN_FMT = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
};
function AnnouncementPanel({ announcements, expandedId, onToggle, onClose }) {
  return (
    <div className="fixed top-[4.5rem] right-4 z-[60] w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-semibold">
            <Bell size={16} className="text-brand-500" /> 公告通知
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {announcements.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">暂无公告</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {announcements.map((a) => {
                const meta = ANN_TYPE_META[a.type] || ANN_TYPE_META.other;
                const expanded = expandedId === a.id;
                return (
                  <li key={a.id} className="px-4 py-3">
                    <button
                      onClick={() => onToggle(a.id)}
                      className="w-full text-left flex items-start gap-2"
                    >
                      <span className={`mt-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${meta.cls}`}>{meta.label}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{a.version}</span>
                          <span className="text-sm text-slate-800 font-medium truncate">{a.title}</span>
                        </span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">{ANN_FMT(a.publishedAt)}</span>
                      </span>
                      <ChevronRight size={15} className={`mt-1 text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="mt-2 pl-1">
                        {a.content && a.content.trim() ? (
                          <div className="md-render text-sm text-slate-700 bg-slate-50/60 rounded-lg px-3 py-2">
                            <Markdown remarkPlugins={[remarkGfm]}>{a.content}</Markdown>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">（无详细内容）</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// 前台「算力充值」弹窗：仅展示后台算力套餐 + 客服二维码 + 提示信息，不提供真实充值
export function RechargeDialog({ packages, qr, info, expiryDate, hideExpiry, onClose }) {
  const list = Array.isArray(packages) ? packages : [];
  // 套餐有效期文案：固定生效日显示具体到期日；购买日起算则显示购买后天数
  const pkgEndDate = (from, days) => {
    const base = new Date(from);
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    return formatPlanDate(d);
  };
  const pkgValidityText = (pkg) => {
    const days = Number(pkg.validDays) || 0;
    if (days > 0 && pkg.validFrom) return `有效期至 ${pkgEndDate(pkg.validFrom, days)}`;
    if (days > 0) return `购买后 ${days} 天到期`;
    if (pkg.validFrom) return `长期有效（${pkg.validFrom} 起）`;
    return '长期有效';
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-violet-600" />
              <h2 className="text-xl font-bold text-slate-900">算力充值</h2>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          <p className="text-sm text-slate-500 mb-5">以下为当前可选的算力套餐。算力充值由客服人工办理，请扫码联系客服完成。</p>

          {/* 套餐已到期提示横幅：由收银台/到期拦截传入 expiryDate 触发；新访客入口(底部 CTA)由 hideExpiry 跳过 */}
          {expiryDate && !hideExpiry && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-5">
              <div className="flex items-center gap-2 text-amber-800 font-semibold">
                <AlertTriangle size={18} /> 算力套餐已到期
              </div>
              <p className="text-sm text-amber-700 mt-1.5 leading-relaxed">
                您的算力套餐已于 <span className="font-semibold">{formatPlanDate(expiryDate)}</span> 到期。您账户中剩余的算力已为您保留，但套餐有效期结束后需联系客服续费，才能继续使用智能体 / 工作流。
              </p>
              <p className="text-sm text-amber-700 mt-1.5 leading-relaxed">请扫描下方客服二维码完成充值，或直接选择套餐联系客服办理。</p>
            </div>
          )}

          {/* 算力套餐卡片：后台设置多少种就显示多少张 */}
          <h3 className="font-semibold text-slate-900 mb-3 text-sm">算力套餐</h3>
          {list.length === 0 ? (
            <div className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-xl">后台暂未设置算力套餐</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {list.map(pkg => (
                <div key={pkg.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{pkg.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{Number(pkg.points || 0).toLocaleString()} 点</div>
                    </div>
                    <div className="text-brand-600 font-bold shrink-0">¥{pkg.price}</div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${pkg.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {pkg.published ? '已上架' : '未上架'}
                    </span>
                    <span className="text-[11px] text-slate-400">{pkgValidityText(pkg)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 联系客服二维码 + 提示信息 两栏 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <div className="rounded-xl bg-slate-50 p-4">
              <h3 className="font-semibold text-slate-900 mb-3 text-sm">联系客服充值</h3>
              {qr ? (
                <img src={qr} alt="客服微信二维码" className="w-32 h-32 object-contain mx-auto rounded-lg border border-slate-100 bg-white" />
              ) : (
                <div className="w-32 h-32 rounded-lg bg-white border border-dashed border-slate-200 flex items-center justify-center text-xs text-slate-400 text-center px-2">后台未上传客服二维码</div>
              )}
              <p className="text-xs text-slate-500 text-center mt-2">扫码添加客服微信，人工充值</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <h3 className="font-semibold text-slate-900 mb-3 text-sm">提示信息</h3>
              {info && info.trim() ? (
                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{info}</p>
              ) : (
                <p className="text-xs text-slate-400">管理员暂未设置提示信息</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 真实模式：后端返回 oauth 二维码，前端轮询 check 接口；模拟模式：显示「模拟扫码」按钮直接走登录流程
export function WechatQrPanel({ onSuccess, tip = '使用微信扫一扫，安全快捷登录' }) {
  const [mode, setMode] = useState(null); // 'real' | 'mock'
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | scanning | done | expired | error
  const [msg, setMsg] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const init = async () => {
      try {
        const cfg = await (await fetch('/api/wechat/config')).json();
        if (!alive) return;
        if (cfg.mode === 'real') {
          setMode('real');
          const r = await (await fetch('/api/wechat/qrcode', { method: 'POST' })).json();
          if (!alive) return;
          if (r.mode === 'real' && r.url) {
            setQrDataUrl(await QRCode.toDataURL(r.url, { width: 200, margin: 1 }));
            setStatus('ready');
            startPoll(r.state);
          } else {
            setMode('mock'); setStatus('ready');
          }
        } else {
          setMode('mock'); setStatus('ready');
        }
      } catch {
        if (!alive) return;
        setMode('mock'); setStatus('ready');
      }
    };
    init();
    return () => {
      alive = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line
  }, []);

  const startPoll = (state) => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await (await fetch('/api/wechat/check?state=' + state)).json();
        if (r.status === 'done' && r.user) {
          clearInterval(pollRef.current);
          setStatus('done');
          onSuccess && onSuccess(r.user);
        } else if (r.status === 'expired') {
          clearInterval(pollRef.current);
          setStatus('expired');
        } else if (r.status === 'pending') {
          setStatus('scanning');
        }
      } catch { /* ignore */ }
    }, 2000);
  };

  const handleMockScan = async () => {
    setStatus('scanning');
    try {
      const r = await (await fetch('/api/wechat/mock-scan', { method: 'POST' })).json();
      if (r.user) { setStatus('done'); onSuccess && onSuccess(r.user); }
    } catch {
      setStatus('error'); setMsg('模拟扫码失败，请重试');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <div className="w-48 h-48 rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
        {status === 'loading' && <span className="text-sm text-slate-400">加载中...</span>}
        {qrDataUrl && <img src={qrDataUrl} alt="微信扫码登录" className="w-44 h-44" />}
        {mode === 'mock' && !qrDataUrl && (
          <div className="text-center px-4">
            <div className="w-20 h-20 mx-auto mb-2 rounded-lg bg-green-500/10 flex items-center justify-center text-green-600">
              <QrCode size={40} />
            </div>
            <span className="text-xs text-slate-400">演示模式二维码</span>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-500 mt-4 text-center">{tip}</p>
      {mode === 'mock' && (
        <button onClick={handleMockScan} disabled={status === 'scanning' || status === 'done'} className="mt-3 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition">
          {status === 'scanning' ? '扫码中...' : '模拟扫码'}
        </button>
      )}
      {mode === 'real' && status === 'scanning' && <p className="text-xs text-green-600 mt-2">已扫描，请在手机上确认登录</p>}
      {status === 'done' && <p className="text-xs text-green-600 mt-2">登录成功，正在跳转...</p>}
      {status === 'expired' && (
        <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm">二维码已过期，刷新重试</button>
      )}
      {status === 'error' && <p className="text-xs text-red-500 mt-2">{msg}</p>}
    </div>
  );
}

// 生成 4 位「字母 + 数字」随机校验码（人机校验，前端展示给用户）
export const genCaptcha = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

function LoginModal({ onClose }) {
  const { login, register, loginWithEmail, loginWithWechat, forgotPasswordVerify, forgotPasswordReset } = useStore();
  const [mode, setMode] = useState('phone');

  // 手机号模式
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [showCode, setShowCode] = useState('');

  // 邮箱模式
  const [emailMode, setEmailMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  // 邮箱人机校验码（4 位字母 + 数字）
  const [captcha, setCaptcha] = useState(() => genCaptcha());
  const [captchaInput, setCaptchaInput] = useState('');
  useEffect(() => {
    if (mode === 'email') { setCaptcha(genCaptcha()); setCaptchaInput(''); }
  }, [mode]);

  // 忘记密码
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMaskedPhone, setForgotMaskedPhone] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPwd, setForgotNewPwd] = useState('');
  const [forgotStep, setForgotStep] = useState(1); // 1=输入邮箱, 2=输入验证码+新密码
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setError('请输入有效的手机号'); return; }
    if (!code.trim()) { setError('请先获取并输入验证码'); return; }
    try {
      const r = await (await fetch('/api/auth/phone-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      })).json();
      if (!r.ok) { setError(r.msg || '验证失败，请重试'); return; }
      login(r.user, r.token || ''); // 手机号验证码登录：服务端已签发会话 token
      onClose();
    } catch {
      setError('网络异常，请稍后重试');
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email.trim())) { setError('请输入有效的邮箱地址'); return; }
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    if (captchaInput.trim().toLowerCase() !== captcha.toLowerCase()) {
      setError('校验码错误，请重新输入正确的校验码');
      setCaptcha(genCaptcha());
      setCaptchaInput('');
      return;
    }
    if (emailMode === 'register') {
      if (password !== confirm) { setError('两次输入的密码不一致'); return; }
      const res = await register(email.trim(), password);
      if (!res || !res.ok) { setError((res && res.msg) || '注册失败，请重试'); return; }
    } else {
      const ok = await loginWithEmail(email.trim(), password);
      if (!ok) { setError('邮箱或密码错误'); return; }
    }
    onClose();
  };

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
    } catch {
      setError('网络异常，请稍后重试');
    }
  };

  const tabCls = (active) => `flex-1 py-2 text-sm font-medium rounded-md transition ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`;

  return (<>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-8 overflow-y-auto">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">欢迎来到友尚Ai+</h2>
              <p className="text-sm text-slate-500 mt-1">登录后即可使用全部智能体</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>

          <div className="flex bg-slate-100 rounded-lg p-1 mb-6">
            <button onClick={() => setMode('phone')} className={tabCls(mode === 'phone')}>手机号</button>
            <button onClick={() => setMode('email')} className={tabCls(mode === 'email')}>邮箱</button>
            <button onClick={() => setMode('wechat')} className={tabCls(mode === 'wechat')}>微信</button>
          </div>

          {mode === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">手机号</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="请输入手机号" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">验证码</label>
                <div className="flex gap-3">
                  <input value={code} onChange={e => setCode(e.target.value)} placeholder="请输入验证码" className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" required />
                  <button type="button" onClick={sendCode} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap">{sent ? '重新发送' : '获取验证码'}</button>
                </div>
                {sent && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    {showCode ? (
                      <>
                        <span className="px-2 py-1 bg-slate-100 rounded font-mono">{showCode}</span>
                        <span>（模拟验证码，真实环境将发送短信）</span>
                      </>
                    ) : (
                      <span className="text-emerald-600">验证码已发送，请查收手机短信</span>
                    )}
                  </div>
                )}
              </div>
              <button type="submit" className="w-full py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition">登录 / 注册</button>
            </form>
          )}
          {mode === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">邮箱</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="请输入邮箱" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码（至少 6 位）" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" required />
              </div>
              {emailMode === 'register' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">确认密码</label>
                  <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="请再次输入密码" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" required />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">人机校验</label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2 bg-slate-100 rounded-md font-mono tracking-[0.3em] text-lg select-none text-slate-700">{captcha}</span>
                  <button type="button" onClick={() => { setCaptcha(genCaptcha()); setCaptchaInput(''); }} className="text-xs text-brand-600 hover:underline whitespace-nowrap">换一张</button>
                  <input value={captchaInput} onChange={e => setCaptchaInput(e.target.value)} placeholder="输入上方校验码" maxLength={4} className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" />
                </div>
                <p className="text-xs text-slate-400 mt-1">请输入上方 4 位校验码（含字母和数字，不区分大小写）</p>
              </div>
              <button type="submit" className="w-full py-3 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition">
                {emailMode === 'login' ? '登录' : '注册'}
              </button>
              {emailMode === 'login' && (
                <div className="text-right">
                  <button type="button" onClick={() => { setForgotEmail(''); setForgotMaskedPhone(''); setForgotCode(''); setForgotNewPwd(''); setForgotStep(1); setForgotMsg(''); setForgotOpen(true); }} className="text-xs text-brand-600 hover:underline">忘记密码？</button>
                </div>
              )}
              <div className="text-center">
                {emailMode === 'login' ? (
                  <button type="button" onClick={() => { setEmailMode('register'); setError(''); }} className="text-xs text-brand-600 hover:underline">还没有账号？去注册</button>
                ) : (
                  <button type="button" onClick={() => { setEmailMode('login'); setError(''); }} className="text-xs text-brand-600 hover:underline">已有账号？去登录</button>
                )}
              </div>
            </form>
          )}
          {mode === 'wechat' && (
            <div className="py-6 text-center">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                <MessageCircle size={28} />
              </div>
              <p className="text-slate-700 font-medium">微信登录功能待开放</p>
              <p className="text-xs text-slate-400 mt-1">我们正在加紧接入，敬请期待</p>
            </div>
          )}
          <p className="text-xs text-slate-400 text-center mt-4">登录即表示同意用户协议与隐私政策</p>
        </div>
      </div>
    </div>

    {/* 忘记密码弹窗（z-110 需 > login modal 的 z-100，避免被遮住） */}
    {forgotOpen && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/30">
        <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setForgotOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          <h3 className="text-lg font-semibold text-slate-900 mb-4">忘记密码</h3>

          {forgotStep === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">注册邮箱</label>
                <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="输入注册时使用的邮箱"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              {forgotMsg && <div className={`p-3 rounded-lg text-sm ${forgotMsg.includes('已发送') ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700'}`}>{forgotMsg}</div>}
              <button onClick={async () => {
                setForgotSending(true); setForgotMsg('');
                try {
                  const r = await apiFetch('/api/auth/forgot-password/email', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: forgotEmail }),
                  });
                  const j = await r.json();
                  setForgotMsg(j?.msg || '发送失败');
                } catch { setForgotMsg('网络异常'); }
                setForgotSending(false);
              }} disabled={forgotSending || !forgotEmail}
                className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition">
                {forgotSending ? '发送中...' : '发送重置邮件（推荐）'}
              </button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">或</span></div>
              </div>

              <button onClick={async () => {
                setForgotSending(true); setForgotMsg('');
                const r = await forgotPasswordVerify(forgotEmail);
                if (r.ok) { setForgotMaskedPhone(r.phone); setForgotStep(2); setForgotMsg(`验证码已发送到 ${r.phone}`); }
                else setForgotMsg(r.msg || '验证失败');
                setForgotSending(false);
              }}               disabled={forgotSending || !forgotEmail}
                className="w-full py-2.5 rounded-lg border border-brand-600 text-brand-600 text-sm font-medium hover:bg-brand-50 disabled:opacity-50 transition">
                {forgotSending ? '发送中...' : '发送短信验证码'}
              </button>

              <p className="text-xs text-slate-400">系统将向该邮箱绑定的手机号发送验证码。如未绑定手机号，请联系管理员重置。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">{forgotMsg}</div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">短信验证码</label>
                <input type="text" value={forgotCode} onChange={e => setForgotCode(e.target.value)} placeholder="6 位验证码" maxLength={6}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">新密码（至少 6 位）</label>
                <input type="password" value={forgotNewPwd} onChange={e => setForgotNewPwd(e.target.value)} placeholder="设置新密码"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              {forgotMsg && !forgotMsg.includes('已发送') && <div className="p-3 rounded-lg text-sm bg-rose-50 text-rose-700">{forgotMsg}</div>}
              <button onClick={async () => {
                const r = await forgotPasswordReset(forgotEmail, forgotCode, forgotNewPwd);
                if (r.ok) { setForgotMsg('密码重置成功！请返回登录'); }
                else setForgotMsg(r.msg || '重置失败');
              }} disabled={!forgotCode || !forgotNewPwd}
                className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition">
                重置密码
              </button>
              {forgotMsg === '密码重置成功！请返回登录' && (
                <button onClick={() => setForgotOpen(false)} className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition">返回登录</button>
              )}
              <button type="button" onClick={() => { setForgotStep(1); setForgotMsg(''); }} className="text-xs text-brand-600 hover:underline">&larr; 重新输入邮箱</button>
            </div>
          )}
        </div>
      </div>
    )}
  </>);
}

// ⚠️ VipModal（"开通会员"弹框）已删除——主人取消"体验卡"卡类与对应机制。
//   之前的代码包含月付/年付/终身会员三种套餐、写入 membership 字段、生成 type='member' 订单。
//   算力仅通过"用户主动购买套餐 / 管理员后台调整"获得，会员体系不再存在。

function SearchModal({ onClose }) {
  const { agents, workflows } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const allItems = [
    ...agents.filter(a => a.published).map(a => ({ ...a, kind: 'agent' })),
    ...workflows.filter(w => w.published).map(w => ({ ...w, kind: 'workflow' })),
  ];

  const results = query.trim()
    ? allItems.filter(item =>
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.desc.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  const handleSelect = (item) => {
    const path = item.kind === 'agent' ? `/chat/${item.id}` : `/workflow/${item.id}`;
    navigate(path);
    onClose();
  };

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-24" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <Search size={20} className="text-slate-400" />
          <input
            autoFocus
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索智能体、工作流..."
            className="flex-1 text-base outline-none text-slate-900 placeholder:text-slate-400"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {results.length > 0 ? (
            <div className="p-2">
              {results.map(item => {
                const Icon = ICON_MAP[item.icon] || Grid3X3;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition text-left"
                  >
                    <div className={`w-12 h-12 rounded-full ${item.iconColor} text-white flex items-center justify-center shrink-0`}>
                      <Icon size={20} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900 truncate">{item.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${item.kind === 'agent' ? 'bg-brand-50 text-brand-600' : 'bg-orange-50 text-orange-600'}`}>
                          {item.kind === 'agent' ? '智能体' : '工作流'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 line-clamp-1">{item.desc}</p>
                    </div>
                    <div className="hidden sm:flex flex-col items-end text-xs text-slate-400 gap-1">
                      <div className="flex items-center gap-1"><Users size={11} /> {formatCount(item.uses)}</div>
                      <div className="flex items-center gap-1 text-amber-500"><Star size={11} fill="currentColor" /> {item.rating}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : query.trim() ? (
            <div className="p-10 text-center text-slate-400">
              <div className="text-4xl mb-3">🔍</div>
              <p>未找到与「{query}」相关的智能体或工作流</p>
            </div>
          ) : (
            <div className="p-10 text-center text-slate-400">
              <div className="text-4xl mb-3">🤖</div>
              <p>输入关键词搜索智能体或工作流</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-white border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-1">
            <Logo />
            <p className="mt-4 text-sm text-slate-500">让每一家实体企业都能用得起、用得好 AI 获客工具。</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs hover:bg-slate-200 cursor-pointer">抖</div>
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs hover:bg-slate-200 cursor-pointer">视</div>
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs hover:bg-slate-200 cursor-pointer">书</div>
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs hover:bg-slate-200 cursor-pointer">信</div>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">产品</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link to="/agents" className="hover:text-blue-600">AI 智能体</Link></li>
              <li><Link to="/workflows" className="hover:text-blue-600">AI 工作流</Link></li>
              <li><Link to="/history" className="hover:text-blue-600">数据看板</Link></li>
              <li><Link to="#" className="hover:text-blue-600">定价方案</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">资源</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><a href="#" className="hover:text-blue-600">帮助中心</a></li>
              <li><a href="#" className="hover:text-blue-600">使用教程</a></li>
              <li><a href="#" className="hover:text-blue-600">行业案例</a></li>
              <li><a href="#" className="hover:text-blue-600">博客更新</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-900 mb-4">公司</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><a href="#" className="hover:text-blue-600">关于我们</a></li>
              <li><a href="#" className="hover:text-blue-600">加入我们</a></li>
              <li><a href="#" className="hover:text-blue-600">联系我们</a></li>
              <li><a href="#" className="hover:text-blue-600">商务合作</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-400">
          <span>© 2025 友尚 Ai+ 企业实体获客平台. All rights reserved.</span>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-slate-600">隐私政策</a>
            <a href="#" className="hover:text-slate-600">服务条款</a>
            <a href="#" className="hover:text-slate-600">ICP 备案</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PageTitle({ title, subtitle, children }) {
  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      {children}
    </div>
  );
}

export function Badge({ children, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
    red: 'bg-red-50 text-red-700',
  };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.blue}`}>{children}</span>;
}

export function CategoryIcon({ name, size = 18, avatar, imgClassName = '' }) {
  if (avatar) {
    return <img src={avatar} alt="" className={`w-full h-full object-cover ${imgClassName}`} />;
  }
  const Icon = ICON_MAP[name] || Grid3X3;
  return <Icon size={size} />;
}

export function formatCount(n) {
  const num = Number(n) || 0;
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return num.toString();
}

const GRADIENT_PRESETS = {
  'bg-blue-600': { from: '#DBEAFE', to: '#FFFFFF' },
  'bg-rose-600': { from: '#FFE4E6', to: '#FFFFFF' },
  'bg-green-600': { from: '#DCFCE7', to: '#FFFFFF' },
  'bg-emerald-600': { from: '#D1FAE5', to: '#FFFFFF' },
  'bg-amber-600': { from: '#FEF3C7', to: '#FFFFFF' },
  'bg-violet-600': { from: '#EDE9FE', to: '#FFFFFF' },
  'bg-slate-700': { from: '#F1F5F9', to: '#FFFFFF' },
  'bg-cyan-600': { from: '#CFFAFE', to: '#FFFFFF' },
  'bg-teal-600': { from: '#CCFBF1', to: '#FFFFFF' },
  'bg-lime-600': { from: '#ECFCCB', to: '#FFFFFF' },
  'bg-purple-600': { from: '#F3E8FF', to: '#FFFFFF' },
  'bg-indigo-600': { from: '#E0E7FF', to: '#FFFFFF' },
  'bg-red-600': { from: '#FEE2E2', to: '#FFFFFF' },
};

// 分类差异化主题（2026-08-03 视觉升级 #7）：让不同类目智能体/工作流有不同头部气质
const CATEGORY_THEME = {
  // 短视频：红橙斜角 ribbon，强视觉冲击
  'short-video': { dark: false, header: 'linear-gradient(135deg, #FFF1F0 0%, #FFFFFF 100%)', accent: '#F4511E', ribbon: true },
  // 私域 / 个人 IP：深色渐变，沉稳高级
  'private': { dark: true, header: 'linear-gradient(135deg, #1E293B 0%, #334155 70%, #475569 100%)', accent: '#C8881A' },
  // GEO / 本地获客：网格纹理，科技感
  'geo': { dark: false, header: 'linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 100%)', accent: '#1E4A78', grid: true },
};

export function AgentCard({ item, to, featured = false, className = '' }) {
  const Icon = ICON_MAP[item.icon] || Grid3X3;
  const preset = GRADIENT_PRESETS[item.iconColor] || { from: '#F8FAFC', to: '#FFFFFF' };
  const gradientFrom = item.gradientFrom || preset.from;
  const gradientTo = item.gradientTo || preset.to;
  const gradientAngle = Number(item.gradientAngle) || 30;
  const theme = CATEGORY_THEME[item.category] || null;
  const isDark = !!theme?.dark;
  const headerBg = theme ? theme.header : `linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo})`;

  const kindBadge = (
    <span className={`absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium backdrop-blur-sm ${isDark ? 'bg-white/15 text-white' : 'bg-white/70 text-slate-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${item.kind === 'agent' ? (isDark ? 'bg-brand-400' : 'bg-brand-500') : (isDark ? 'bg-accent-400' : 'bg-orange-500')}`}></span>
      {item.kind === 'agent' ? '智能体' : '工作流'}
    </span>
  );

  const vipBadge = item.vip && (
    <span className="absolute top-3 right-3 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
      VIP
    </span>
  );

  // 头部装饰：短视频=红橙斜角 ribbon；geo=网格纹理
  const headerDecor = theme?.ribbon ? (
    <div className="absolute -top-3 -right-3 w-10 h-10 rotate-45" style={{ background: 'linear-gradient(135deg, #F4511E, #FB8C00)' }} />
  ) : theme?.grid ? (
    <div className="absolute inset-0 opacity-[0.10]" style={{ backgroundImage: 'linear-gradient(#1E4A78 1px, transparent 1px), linear-gradient(90deg, #1E4A78 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
  ) : null;

  const Header = ({ cls }) => (
    <div className={`relative overflow-hidden ${cls}`} style={{ background: headerBg }}>
      {headerDecor}
      {kindBadge}
      {vipBadge}
      {!featured && (
        <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full ${item.iconColor || (isDark ? 'bg-white/20' : 'bg-slate-400')} text-white flex items-center justify-center shadow-md overflow-hidden`}>
          {item.avatar ? (
            <img src={item.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon size={22} strokeWidth={1.8} />
          )}
        </div>
      )}
      {featured && (
        <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:left-4 md:top-auto md:bottom-4 md:translate-x-0 md:translate-y-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl ${item.iconColor || (isDark ? 'bg-white/20' : 'bg-white/70')} ${isDark ? 'text-white' : 'text-brand-700'} flex items-center justify-center shadow-md overflow-hidden`}>
          {item.avatar ? (
            <img src={item.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon size={26} strokeWidth={1.8} />
          )}
        </div>
      )}
    </div>
  );

  const body = (
    <div className={`flex flex-col ${featured ? 'p-4 md:p-7 flex-1 justify-center' : 'p-4 flex-1'}`}>
      <h3 className={`font-semibold text-slate-900 leading-snug mb-1 truncate group-hover:text-brand-600 transition ${featured ? 'text-lg md:text-3xl' : 'text-lg'}`}>{item.name}</h3>
      <p className={`text-slate-500 leading-relaxed flex-1 ${featured ? 'text-xs md:text-base line-clamp-2 md:line-clamp-3 md:max-w-md min-h-[2.25rem]' : 'text-xs line-clamp-2 min-h-[2.25rem]'}`}>{item.desc}</p>
      <div className={`mt-3 flex min-w-0 items-center justify-between gap-2 text-[11px] text-slate-400 ${featured ? 'md:mt-4' : ''}`}>
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {(item.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="max-w-[5rem] truncate rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{tag}</span>
          ))}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1"><Users size={13} /> {formatCount(item.uses)}人使用</span>
      </div>
    </div>
  );

  return (
    <Link
      to={to}
      className={`group flex flex-col h-full rounded-2xl bg-white border border-slate-200 overflow-hidden hover:shadow-[0_10px_28px_-8px_rgba(15,23,42,0.14)] hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${className}`}
    >
      {featured ? (
        <div className="flex flex-col md:flex-row h-full">
          <Header cls="h-28 md:h-auto md:w-5/12 shrink-0" />
          <div className="flex-1 flex">{body}</div>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          <Header cls="h-28 shrink-0" />
          {body}
        </div>
      )}
    </Link>
  );
}
