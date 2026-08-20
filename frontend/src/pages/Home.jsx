import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { ChevronLeft, ChevronRight, Zap, BarChart3, Coins, RefreshCw, ArrowRight, ArrowUpRight, ShieldCheck, Users, ThumbsUp, Headphones, Lock, Quote, Star } from 'lucide-react';
import { AgentCard } from '../components.jsx';
import { BANNER_SLIDES } from '../mock.js';

function LinkOrDiv({ to, children, className }) {
  if (!to) return <div className={className}>{children}</div>;
  return <Link to={to} className={className}>{children}</Link>;
}

const FEATURE_ICONS = { Zap, BarChart3, Coins, RefreshCw };

// 信任与转化区兜底默认值：线上已持久化的 landing 配置若缺这些新字段（老配置），
// 用下面的默认值渲染，保证新版首页立即生效、且严格显示主人指定的数据条内容。
const DEFAULT_STATS = [
  { value: '40+', label: '智能体' },
  { value: '6000+', label: '用户' },
  { value: '20w+', label: '使用次数' },
];
const DEFAULT_CASES = [
  { brand: '佛山瓷砖批发 · 李总', metric: '到店咨询 +300%', desc: '用小红书图文智能体批量产出种草笔记，3 个月沉淀 2000+ 精准线索，门店到店量翻了 3 倍。', tag: '瓷砖 / 建材' },
  { brand: '成都定制家居 · 王姐', metric: '抖音涨粉 1.2w', desc: '短视频口播智能体直接生成读稿文案，老板人设 IP 30 天起号成功，第一条视频即破万播放。', tag: '定制家具' },
  { brand: '武汉卫浴 · 陈经理', metric: '内容效率 ×10', desc: 'AI 工作流一键提取竞品爆款并改写，团队内容产出效率提升 10 倍，获客成本下降 60%。', tag: '卫浴' },
];
const DEFAULT_BADGES = [
  { icon: 'ShieldCheck', text: '50+ 品牌在用' },
  { icon: 'Users', text: '3000+ 客户信赖' },
  { icon: 'ThumbsUp', text: '抖音 + 小红书 双平台' },
  { icon: 'Headphones', text: '7×12 专属客服' },
  { icon: 'Lock', text: '数据安全保障' },
];
const DEFAULT_TESTIMONIALS = [
  { quote: '以前请个文案一个月要大几千，现在一个会员顶 19 个智能体，内容天天不断更。', author: '李总', role: '佛山瓷砖批发 · 门店老板' },
  { quote: '老板不懂拍视频，用口播智能体直接读稿，3 天就出了第一条爆款。', author: '王姐', role: '成都定制家居 · 创始人' },
  { quote: '工作流一键提取爆款文案，团队效率直接翻了好几倍，再也不用熬夜憋稿。', author: '陈经理', role: '武汉卫浴 · 运营负责人' },
];
const BADGE_ICONS = { ShieldCheck, Users, ThumbsUp, Headphones, Lock };

// 信任数据条（社会证明）默认文案（2026-08-03 改版：无蓝底+滚动计数动画）
const DEFAULT_STATS_TITLE = 'AI智能创作引擎';
const DEFAULT_STATS_SUBTITLE = '内置多场景文案、图片、视频智能体和工作流，快速完成内容生产和创意生成';

// 把 "40+" / "6000+" / "20w+" 这种含单位的数字字符串解析成纯数字：
//   "20w+" / "10W+" → 200000 / 100000（万级）
//   "1K+"           → 1000（千级）
//   其他纯数字      → 原值
function parseStatTarget(str) {
  const m = String(str || '').trim().match(/^([\d.]+)\s*([kKmMwW])?\s*\+?$/);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'w') return num * 10000;
  if (unit === 'k') return num * 1000;
  return num;
}

// 把动画过程中的浮点 value 还原成展示字符串（保留原始单位的格式约定）
//   target="20w+" → 渲染 "20w+"，过程中 0..200000 → "0w+..20w+"
//   target="40+"  → 渲染 "40+"，过程中 0..40 → "0+..40+"
function formatStatDisplay(value, original) {
  const o = String(original || '');
  const wMatch = o.match(/[wW]/);
  const kMatch = o.match(/[kK]/);
  if (wMatch) {
    // 用 floor(value/10000) 保证结尾稳定显示 Nw+，避免 19.x 显示成 19w+
    const w = Math.max(0, Math.floor(value / 10000));
    return w + 'w+';
  }
  if (kMatch) {
    const k = Math.max(0, Math.floor(value / 1000));
    return k + 'k+';
  }
  return Math.max(0, Math.floor(value)) + '+';
}

// 滚动计数 hook：start 由 IntersectionObserver 触发；ease-out cubic，1.8s 收尾
function useCountUp(target, start, duration = 1800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start || !target) return;
    let raf;
    let beginTs;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (ts) => {
      if (!beginTs) beginTs = ts;
      const p = Math.min((ts - beginTs) / duration, 1);
      setVal(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(step);
      else setVal(target);
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [target, start, duration]);
  return val;
}

// 单个统计数字组件：独立调用 hook，遵守 hooks 顶层规则
function StatCounter({ value, label, start }) {
  const target = parseStatTarget(value);
  const v = useCountUp(target, start);
  return (
    <div className="py-2">
      <div className="font-num text-3xl sm:text-4xl md:text-6xl font-extrabold tracking-tight gradient-brand">
        {formatStatDisplay(v, value)}
      </div>
      <div className="mt-2 text-sm md:text-base text-slate-500">{label}</div>
    </div>
  );
}

// 滚动渐入（#10）：元素进入视口后一次性播放 fade-up（带 IO 兼容兜底）
// ⚠️ 必须用 callback ref 而不是 useRef+useEffect：
// 首页区块是 {activeCat==='all' && ...} 条件渲染，Home 组件切分类时不卸载、区块 DOM 节点后挂载，
// useRef 对象身份不变 → effect 不重跑 → 新节点永远没被 observer 监听 → 永久 opacity-0（真实根因）。
// callback ref 在节点每次挂载/卸载时都会触发，保证 observer 一定挂到真实节点上。
// ⚠️ 还必须加 scroll 监听兜底：浏览器恢复滚动位置时，元素可能从「视口下方」直接跳到「视口上方」，
// 交叉比例始终为 0 → IntersectionObserver 回调根本不触发 → 永久 opacity-0（第二重根因）。
function useInViewOnce(threshold = 0.15) {
  const [inView, setInView] = useState(false);
  const observerRef = useRef(null);
  const cleanupRef = useRef(null);
  const ref = useCallback((node) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (!node || inView) return;
    // 判定：元素顶边在视口底边之上（可见或已被滚过上方）→ 显示
    const isShown = () => node.getBoundingClientRect().top < window.innerHeight;
    const show = () => {
      setInView(true);
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    };
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    // 同步检查：挂载瞬间已可见（含浏览器恢复滚动到深处、元素在视口上方的情形）→ 直接显示
    if (isShown()) { setInView(true); return; }
    // 兜底 1：IntersectionObserver 正常触发进入视口
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting || entry.boundingClientRect.top < 0) show();
      },
      { threshold, rootMargin: '0px 0px -48px 0px' }
    );
    obs.observe(node);
    observerRef.current = obs;
    // 兜底 2：scroll 监听，覆盖「下方直接跳到上方、比例恒 0 不触发 IO」的场景
    const onScroll = () => { if (isShown()) show(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanupRef.current = () => window.removeEventListener('scroll', onScroll);
  }, [inView, threshold]);
  return [ref, inView];
}

// 通用滚动渐入容器：未进入视口时 opacity-0，进入后播放 animate-fade-up
function SectionReveal({ children, className = '', delay = 0 }) {
  const [ref, inView] = useInViewOnce();
  return (
    <div
      ref={ref}
      className={`${className} ${inView ? 'animate-fade-up' : 'opacity-0'}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

export default function Home() {
  const { sortedCategories, agents, workflows, banners, recommended, landing, openRechargeModal, refreshAllConfig } = useStore();
  const [searchParams] = useSearchParams();
  const activeCat = searchParams.get('category') || 'all';
  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig, activeCat]);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  // 按 sortOrder 排序：与后台「推荐配置」的上下箭头按钮保持一致，否则前台轮播顺序
  // 不会跟随后台调整（后台 swapSort 只交换 sortOrder 值，不动数组顺序）
  // ⚠️ 必须放在 useEffect 之前！useEffect deps 是同步求值，访问未声明的 const 会触发 TDZ (Cannot access 'X' before initialization)
  const slides = ((banners && banners.length ? banners : BANNER_SLIDES)
    .filter(b => b.published))
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const slideCount = slides.length;

  // 自动轮播：每 3 秒切下一张；手动点击 / 悬停时重置或暂停计时器
  // 依赖只放 [slideCount, paused]，slide 通过 setSlide((s) => ...) 内部自增，
  // 避免 slide 变化触发整个 interval reset（之前依赖里有 slide 会导致每 3 秒重置计时器，UX 无感但浪费）
  useEffect(() => {
    if (slideCount <= 1 || paused) return;
    const t = setInterval(() => setSlide(s => (slideCount ? (s + 1) % slideCount : 0)), 3000);
    return () => clearInterval(t);
  }, [slideCount, paused]);

  // 预加载下一张，避免首次自动切换时的空白闪烁
  // 浏览器对 <img loading="lazy"> + decode async 已自动接管预加载；这里只对 data: base64（不上传 blob 的）才需要手动预热。
  const nextUrl = slideCount > 1 ? slides[(slide + 1) % slideCount]?.image : null;
  useEffect(() => {
    if (!nextUrl || nextUrl.startsWith('data:')) return;
    const img = new Image();
    img.src = nextUrl;
  }, [nextUrl]);

  const sidebarCatIds = new Set(
    sortedCategories
      .filter(c => c.id !== 'all' && c.published && c.showInSidebar)
      .map(c => c.id)
  );

  const items = [
    ...agents.filter(a => a.published).map(a => ({ ...a, kind: 'agent' })),
    ...workflows.filter(w => w.published).map(w => ({ ...w, kind: 'workflow' })),
  ].filter(item => {
    if (activeCat === 'all') return true;
    if (activeCat === 'other') return !sidebarCatIds.has(item.category);
    return activeCat.split(',').includes(item.category);
  });

  const recommendedItems = recommended
    .map(id => {
      const a = agents.find(x => x.id === id && x.published);
      const w = workflows.find(x => x.id === id && x.published);
      return a ? { ...a, kind: 'agent' } : w ? { ...w, kind: 'workflow' } : null;
    })
    .filter(Boolean);

  const displayedItems = activeCat === 'all'
    ? (recommendedItems.length ? recommendedItems : items.slice(0, 8))
    : items;

  // 信任与转化区：老配置缺失新字段时回退默认值，保证线上立即生效
  const stats = (landing.stats && landing.stats.length) ? landing.stats : DEFAULT_STATS;
  // 统计区主/副标题：老配置可能缺这两个字段，回退到主人指定的默认文案（保证线上立即生效）
  const statsTitle = landing.statsTitle || DEFAULT_STATS_TITLE;
  const statsSubtitle = landing.statsSubtitle || DEFAULT_STATS_SUBTITLE;
  // 滚动计数：进入视口时触发一次
  // 与 useInViewOnce 同理用 callback ref：stats 区是 activeCat==='all' 条件渲染，
  // Home 切分类时不卸载、stats 节点后挂载，useRef+useEffect 依赖不变不重跑 → 永久 opacity-0（真实根因）。
  // callback ref 在节点挂载时触发；scroll 监听兜底「下方直接跳到上方、IO 比例恒 0 不触发」的场景。
  const [statsInView, setStatsInView] = useState(false);
  const statsObserverRef = useRef(null);
  const statsCleanupRef = useRef(null);
  const statsRef = useCallback((node) => {
    if (statsCleanupRef.current) { statsCleanupRef.current(); statsCleanupRef.current = null; }
    if (statsObserverRef.current) { statsObserverRef.current.disconnect(); statsObserverRef.current = null; }
    if (!node || statsInView) return;
    // 判定：元素顶边在视口底边之上（可见或已被滚过上方）→ 显示并开始计数
    const isShown = () => node.getBoundingClientRect().top < window.innerHeight;
    const show = () => {
      setStatsInView(true);
      if (statsObserverRef.current) { statsObserverRef.current.disconnect(); statsObserverRef.current = null; }
      if (statsCleanupRef.current) { statsCleanupRef.current(); statsCleanupRef.current = null; }
    };
    if (typeof IntersectionObserver === 'undefined') { setStatsInView(true); return; }
    // 同步检查：挂载瞬间已可见（含浏览器恢复滚动到深处的情形）→ 直接显示
    if (isShown()) { setStatsInView(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => {
        // 进入视口，或已经被滚到视口上方（从分类页/子页返回时常见），都应立即显示
        if (entry.isIntersecting || entry.boundingClientRect.top < 0) show();
      },
      { threshold: 0.35 }
    );
    obs.observe(node);
    statsObserverRef.current = obs;
    const onScroll = () => { if (isShown()) show(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    statsCleanupRef.current = () => window.removeEventListener('scroll', onScroll);
  }, [statsInView]);
  const cases = (landing.cases && landing.cases.length) ? landing.cases : DEFAULT_CASES;
  const badges = (landing.badges && landing.badges.length) ? landing.badges : DEFAULT_BADGES;
  const testimonials = (landing.testimonials && landing.testimonials.length) ? landing.testimonials : DEFAULT_TESTIMONIALS;

  const nextSlide = () => setSlide(s => (slideCount ? (s + 1) % slideCount : 0));
  const prevSlide = () => setSlide(s => (slideCount ? (s - 1 + slideCount) % slideCount : 0));

  const isAll = activeCat === 'all';

  return (
    <div className="max-w-7xl mx-auto">
      {/* 背景质感 overlay：极淡噪点 + 顶部品牌光晕（#8，固定全屏，不拦截事件） */}
      <div className="page-noise" aria-hidden="true" />

      {/* Banner */}
      {slideCount > 0 && activeCat === 'all' && (
        <section
          className="relative rounded-3xl overflow-hidden aspect-[21/9] mb-8 group"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <LinkOrDiv to={slides[slide].to}>
            {/* 只渲染当前 slide 和下一 slide 的图片，避免一次加载 3 张 ~300KB 图卡顿首屏
                （图片真实大小由后端 upload 时 compressImage 压缩到 ≤1600px + JPEG 82%） */}
            {slides.map((b, i) => {
              if (i !== slide && i !== (slide + 1) % slideCount) return null;
              const isCurrent = i === slide;
              return (
                <img key={b.id || i}
                  src={b.image}
                  alt="banner"
                  loading={isCurrent ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchpriority={isCurrent ? 'high' : 'auto'}
                  className={`absolute inset-0 w-full h-full object-cover transition-[transform,opacity] duration-700 ease-out group-hover:scale-105 ${isCurrent ? 'opacity-100' : 'opacity-0'}`} />
              );
            })}
            <div className={`absolute inset-0 bg-gradient-to-r ${slides[slide].color}`} style={{ opacity: (slides[slide].overlayOpacity ?? 80) / 100 }}></div>
          </LinkOrDiv>
          <button onClick={prevSlide} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-600 hover:bg-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
            <ChevronLeft size={20} />
          </button>
          <button onClick={nextSlide} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-600 hover:bg-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
            <ChevronRight size={20} />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {slides.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)} className={`w-2 h-2 rounded-full transition ${i === slide ? 'bg-brand-600' : 'bg-white/70'}`} />
            ))}
          </div>
        </section>
      )}

      {/* 信任数据条（社会证明）：主标题 + 副标题 + 数字（2026-08-03 改版：无蓝底 + 滚动计数动画） */}
      {activeCat === 'all' && stats.length > 0 && (
        <section ref={statsRef} className={`mb-10 text-center ${statsInView ? 'animate-fade-up' : 'opacity-0'}`}>
          <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4">{statsTitle}</h2>
          <p className="text-lg md:text-xl text-slate-500 max-w-3xl mx-auto">{statsSubtitle}</p>
          <div className="mt-8 grid grid-cols-3 gap-4 md:gap-10">
            {stats.map((s, i) => (
              <StatCounter key={i} value={s.value} label={s.label} start={statsInView} />
            ))}
          </div>
        </section>
      )}

      {/* 区块标题 */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-900">
          {activeCat === 'all' ? '热门智能体' : (sortedCategories.find(c => c.id === activeCat)?.name || '全部')}
        </h2>
        <span className="text-sm text-slate-400">{displayedItems.length} 个应用</span>
      </div>

      {/* Items grid（#12 分类切换 stagger：切分类时卡片逐个入场） */}
      <div key={activeCat} className="grid grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {displayedItems.map((item, i) => (
          <div
            key={item.id}
            className={`animate-fade-up ${isAll && i === 0 ? 'md:col-span-2' : ''}`}
            style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}
          >
            <AgentCard item={item} to={item.kind === 'agent' ? `/chat/${item.id}` : `/workflow/${item.id}`} featured={isAll && i === 0} />
          </div>
        ))}
      </div>

      {displayedItems.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <div className="text-5xl mb-4">🤖</div>
          <p>该分类下暂无已上架智能体或工作流</p>
        </div>
      )}

      {activeCat === 'all' && items.length > 8 && (
        <div className="mt-6 text-center">
          <Link to="/agents" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-600 text-white font-medium hover:bg-brand-700 shadow-sm transition">
            查看全部智能体 <ChevronRight size={16} />
          </Link>
        </div>
      )}

      {/* 价值卖点区：上图 + 小标签 + 大标题 + 蓝链接（#10 滚动渐入） */}
      {activeCat === 'all' && (
        <SectionReveal className="mt-8 mb-8">
          <div className="text-center max-w-3xl mx-auto mb-5">
            <span className="inline-block px-4 py-1.5 rounded-full bg-slate-100 text-slate-600 text-sm font-medium mb-6">
              {landing.heroTag}
            </span>
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4">
              {landing.heroTitle}
            </h2>
            <p className="text-lg md:text-xl text-slate-500 leading-relaxed">
              {landing.heroSubtitle}
            </p>
          </div>

          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-2 md:gap-6 md:overflow-visible md:pb-0 xl:grid-cols-4">
            {landing.features.map((f, i) => {
              const Icon = FEATURE_ICONS[f.icon] || Zap;
              const LinkTag = f.linkHref && (f.linkHref.startsWith('http') || f.linkHref.startsWith('#')) ? 'a' : Link;
              const linkProps = LinkTag === 'a' ? { href: f.linkHref || '#' } : { to: f.linkHref || '#' };
              return (
                <div key={i} className="flex min-w-[82vw] snap-start flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm transition duration-300 hover:shadow-lg md:min-w-0">
                  <div className="relative aspect-square bg-slate-50 overflow-hidden">
                    {f.image ? (
                      <img src={f.image} alt={f.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-100">
                        <Icon size={48} className="text-slate-400" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="p-6 md:p-7 flex-1 flex flex-col">
                    {f.label && (
                      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase mb-3">
                        {f.label}
                      </span>
                    )}
                    <h3 className="text-xl font-bold text-slate-900 mb-2">{f.title}</h3>
                    <p className="text-slate-500 text-sm leading-relaxed mb-4 flex-1">{f.desc}</p>
                    {f.linkText && f.linkHref && (
                      <LinkTag {...linkProps} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 transition self-start">
                        {f.linkText} <ArrowUpRight size={16} />
                      </LinkTag>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionReveal>
      )}

      {/* 客户成功案例区：以「标签 / 成效 / 描述 / 品牌」四元组呈现真实获客结果（#10 滚动渐入） */}
      {activeCat === 'all' && cases.length > 0 && (
        <SectionReveal className="mt-8 mb-8">
          <div className="text-center max-w-3xl mx-auto mb-6">
            <span className="inline-block px-4 py-1.5 rounded-full bg-brand-50 text-brand-700 text-sm font-medium mb-4">真实结果</span>
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4">客户用友尚AI拿到了结果</h2>
            <p className="text-lg md:text-xl text-slate-500">不是概念，是看得见的获客增长。</p>
          </div>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:pb-0">
            {cases.map((c, i) => (
              <div key={i} className="flex min-w-[82vw] snap-start flex-col rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition duration-300 hover:shadow-lg md:min-w-0">
                <span className="self-start text-xs font-semibold text-brand-700 bg-brand-50 px-3 py-1 rounded-full mb-4">{c.tag}</span>
                <div className="text-2xl font-extrabold text-slate-900 mb-1">{c.metric}</div>
                <p className="text-slate-600 text-sm leading-relaxed mb-5 flex-1">{c.desc}</p>
                <div className="text-sm font-medium text-slate-900 pt-4 border-t border-slate-100">{c.brand}</div>
              </div>
            ))}
          </div>
        </SectionReveal>
      )}

      {/* 客户口碑评价区：CTA 之前的临门一脚（#10 滚动渐入） */}
      {activeCat === 'all' && testimonials.length > 0 && (
        <SectionReveal className="mb-8">
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:pb-0">
            {testimonials.map((t, i) => (
              <div key={i} className="flex min-w-[82vw] snap-start flex-col rounded-3xl bg-slate-50 p-6 md:min-w-0">
                <Quote size={28} className="text-brand-500/40 mb-3" />
                <p className="text-slate-700 text-sm leading-relaxed flex-1">“{t.quote}”</p>
                <div className="mt-4 flex items-center gap-0.5 text-amber-400">
                  {[...Array(5)].map((_, k) => <Star key={k} size={14} fill="currentColor" />)}
                </div>
                <div className="mt-3">
                  <div className="text-sm font-semibold text-slate-900">{t.author}</div>
                  <div className="text-xs text-slate-400">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionReveal>
      )}

      {/* 信任背书图标条：资质 / 服务保障，强化转化前信任（#10 滚动渐入） */}
      {activeCat === 'all' && badges.length > 0 && (
        <SectionReveal className="mb-8">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 rounded-3xl bg-white border border-slate-100 shadow-sm px-6 py-6">
            {badges.map((b, i) => {
              const Icon = BADGE_ICONS[b.icon] || ShieldCheck;
              return (
                <div key={i} className="flex items-center gap-2 text-slate-600">
                  <Icon size={20} className="text-brand-600" strokeWidth={2} />
                  <span className="text-sm font-medium">{b.text}</span>
                </div>
              );
            })}
          </div>
        </SectionReveal>
      )}

      {/* CTA 行动号召区：浅灰圆角大胶囊 + 深色标题 + 蓝按钮（#10 滚动渐入） */}
      {activeCat === 'all' && (
        <SectionReveal className="mb-5">
          <div className="rounded-[3rem] bg-slate-100 px-6 md:px-12 py-8 md:py-10 text-center">
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-4 max-w-3xl mx-auto leading-tight">
              {landing.cta.title}
            </h2>
            <p className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto mb-7 leading-relaxed">
              {landing.cta.subtitle}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button onClick={() => openRechargeModal(null, { hideExpiry: true })} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-brand-600 text-white font-semibold hover:bg-brand-700 transition">
                {landing.cta.primaryText} <ArrowRight size={18} />
              </button>
              <button onClick={() => openRechargeModal(null, { hideExpiry: true })} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-white border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition">
                {landing.cta.secondaryText}
              </button>
            </div>
          </div>
        </SectionReveal>
      )}
    </div>
  );
}
