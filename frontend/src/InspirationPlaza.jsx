import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ChevronLeft, ChevronRight, Heart, ImageOff, Loader2, Search, Sparkles, X, ZoomIn } from 'lucide-react';
import { apiFetch } from './authFetch.js';
import { useInspirationCategories } from './useInspirationCategories.js';

// 每页条数。**不要调大**：这一页是「向下滚就加载」的瀑布流，
// 首屏只需要铺满可视区，一次给太多会把首屏变慢、还把后面几屏的图片提前解码。
const PAGE_SIZE = 20;

/**
 * 从 "3:4" 解析出占位尺寸。
 * 为什么需要：图片解码前高度是 0，整篇文档会很"矮"，触底判断会误判成"已经在底部"
 * 从而把后面所有页一次性拉下来（实测 5 页全加载）。给 <img> 写死 width/height 属性后，
 * 浏览器按这个比例**先占好位置**，触底判断才准；图片加载完仍是 `h-auto`，比例以真实图为准。
 */
function ratioPlaceholder(value) {
  const matched = /^(\d+)\s*:\s*(\d+)$/.exec(String(value || ''));
  const width = matched ? Number(matched[1]) : 3;
  const height = matched ? Number(matched[2]) : 4;
  if (!width || !height) return { width: 900, height: 1200 };
  const base = 900;
  return { width: base, height: Math.round((base * height) / width) };
}

/**
 * 发现灵感：用户发布的作品墙。
 *
 * 三个设计决定（都不是随手写的）：
 * 1. **瀑布流用 CSS 多列（columns）而不是 JS 计算定位**：多列方案零测量、零重排，
 *    图片用 `loading="lazy"` 交给浏览器按可视区解码；滚动时不需要任何 JS 参与。
 *    代价是列内顺序是「先填满第一列再填第二列」，对浏览型内容无所谓。
 * 2. **游标分页而不是 page/pageSize**：新增作品会让页码整体后移，用页码会出现
 *    「翻到第二页看到第一页已经看过的内容」。游标是绝对偏移，配合按 id 去重最稳。
 * 3. **悬停浮层在小屏常显**：触屏没有 hover，如果照搬桌面「只有悬停才出现做同款」，
 *    手机上这个功能等于不存在。所以 `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`。
 */
export default function InspirationPlaza({ onUsePrompt, refreshToken = 0 }) {
  // 分类清单来自服务端（后台可增删改序），这里不再用前端写死的那份
  const { categories } = useInspirationCategories();
  const [category, setCategory] = useState('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [total, setTotal] = useState(0);

  // 大图预览：null = 关闭，数字 = 当前展示的作品在 items 里的下标。
  // 用「下标」而不是「item 对象」，是为了让 ←/→ 切换天然跟着列表走（列表增删后自动收敛）。
  const [viewerIndex, setViewerIndex] = useState(null);
  const viewerTriggerRef = useRef(null);   // 关闭时把焦点还给被点击的那张缩略图
  const touchRef = useRef({ x: 0, y: 0 }); // 移动端滑动起点
  const viewerOpen = viewerIndex !== null;
  const viewerItem = viewerOpen ? items[viewerIndex] || null : null;

  const cursorRef = useRef(0);      // 已加载到的绝对偏移（唯一可信来源）
  const inflightRef = useRef(0);     // 当前进行中的请求序号，0 = 空闲
  const seqRef = useRef(0);          // 请求自增序号，用于丢弃过期响应
  const sentinelRef = useRef(null);
  const noticeTimerRef = useRef(null);
  // 滚动监听里需要读到最新状态，但不能把 loading/hasMore 放进 effect 依赖（否则每次加载都重新绑定监听）
  const stateRef = useRef({ loading: false, hasMore: true });
  const loadMoreRef = useRef(() => {});

  const flash = useCallback((text) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 2600);
  }, []);

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  // 搜索防抖：输入停下来 320ms 才真正请求，避免每敲一个字打一次接口
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 320);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const runLoad = useCallback(async (reset) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    inflightRef.current = seq;
    setLoading(true);
    try {
      const offset = reset ? 0 : cursorRef.current;
      const params = new URLSearchParams({ cursor: String(offset), limit: String(PAGE_SIZE) });
      if (category !== 'all') params.set('category', category);
      if (keyword) params.set('q', keyword);
      const res = await apiFetch(`/api/inspiration/list?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== seqRef.current) return; // 已被更新的请求取代，丢弃
      if (!res.ok || !data.ok) throw new Error(data.error || `加载失败（HTTP ${res.status}）`);
      const fresh = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        if (reset) return fresh;
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...fresh.filter((item) => !seen.has(item.id))];
      });
      cursorRef.current = Number(data.nextCursor) || 0;
      setHasMore(data.hasMore === true);
      setTotal(Number(data.total) || 0);
      setError('');
    } catch (e) {
      if (seq === seqRef.current) setError(String(e.message || e));
    } finally {
      if (inflightRef.current === seq) {
        inflightRef.current = 0;
        setLoading(false);
      }
    }
  }, [category, keyword]);

  // 后台删掉/停用了当前选中的分类 → 回到「全部」，否则会一直卡在一个筛不出东西的分类上
  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((item) => item.id === category)) setCategory('all');
  }, [categories, category]);

  // 分类 / 关键词 / 发布成功后 → 从头加载
  useEffect(() => {
    cursorRef.current = 0;
    setHasMore(true);
    setItems([]);
    setError('');
    runLoad(true);
  }, [runLoad, refreshToken]);

  const loadMore = useCallback(() => {
    if (inflightRef.current) return;      // 防重入：一次只跑一个请求
    if (!hasMore) return;
    runLoad(false);
  }, [hasMore, runLoad]);

  // 把「最新状态」与「最新的 loadMore」同步到 ref，供滚动监听读取（避免闭包过期）
  useEffect(() => { stateRef.current = { loading, hasMore }; }, [loading, hasMore]);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // 触底增量加载。
  //
  // ⚠️ 这里**不用 IntersectionObserver**，虽然它更"现代"。踩过的坑（2026-10-28 实测）：
  //    IO 只在「相交状态发生变化」时回调。真实链路是「哨兵进入视野 → 触发加载 →
  //    新内容把哨兵推下去 → 用户继续滚 → 哨兵又进来」，只要某一次回调正好赶上
  //    请求还在飞行中（被防重入挡掉），这次触发就永久丢失 —— 表现是"滚到第三页就不动了"。
  //    改成「滚动事件 + 位置判断 + 每次加载完再复查一次」：每次滚动都会重新判断，
  //    不存在丢事件的状态机；加载完复查则保证首屏不够高时能自动补满视口。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const trigger = () => {
      if (stateRef.current.loading || !stateRef.current.hasMore) return;
      if (el.getBoundingClientRect().top <= window.innerHeight + 600) loadMoreRef.current();
    };
    window.addEventListener('scroll', trigger, { passive: true });
    window.addEventListener('resize', trigger);
    return () => {
      window.removeEventListener('scroll', trigger);
      window.removeEventListener('resize', trigger);
    };
  }, []);

  // 每次列表变化后复查一次：视口没被填满就继续取下一页（首屏 20 张在 4K 屏上可能不够）。
  // 延迟 120ms 是为了等这一批图片按 width/height 占位完成、文档高度稳定后再判断，
  // 否则会读到"还没撑开"的高度，误判在底部而把后面的页全部拉下来。
  useEffect(() => {
    const timer = setTimeout(() => {
      if (stateRef.current.loading || !stateRef.current.hasMore) return;
      const el = sentinelRef.current;
      if (!el) return;
      if (el.getBoundingClientRect().top <= window.innerHeight + 600) loadMoreRef.current();
    }, 120);
    return () => clearTimeout(timer);
  }, [items.length, hasMore]);

  const toggleLike = async (item) => {
    // 乐观更新：点赞是高频轻操作，等 300ms 往返再变色会显得"卡"
    const optimistic = { ...item, liked: !item.liked, likes: Math.max(0, item.likes + (item.liked ? -1 : 1)) };
    setItems((prev) => prev.map((one) => (one.id === item.id ? optimistic : one)));
    try {
      const res = await apiFetch('/api/inspiration/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '点赞失败');
      setItems((prev) => prev.map((one) => (one.id === item.id
        ? { ...one, liked: data.liked === true, likes: Number(data.likes) || 0 }
        : one)));
    } catch (e) {
      setItems((prev) => prev.map((one) => (one.id === item.id ? item : one))); // 回滚
      flash(String(e.message || e));
    }
  };

  const useAsPrompt = (item) => {
    const text = String(item.prompt || '').trim();
    if (!text) return;
    onUsePrompt?.(text);
    // 回填后把用户带回输入框，否则他还要自己往上滚
    window.scrollTo({ top: 0, behavior: 'smooth' });
    flash('提示词已填入上方输入框');
  };

  // ===== 大图预览 =====
  const openViewer = (index, event) => {
    viewerTriggerRef.current = event?.currentTarget || null;
    setViewerIndex(index);
  };

  const closeViewer = () => setViewerIndex(null);

  const stepViewer = (delta) => {
    if (viewerIndex === null) return;
    const next = viewerIndex + delta;
    if (next < 0) return;
    if (next >= items.length) {
      // 已到「已加载的最后一张」：还有下一页就顺手拉一页，用户不用退出来再滚一次
      if (delta > 0 && hasMore) loadMore();
      return;
    }
    setViewerIndex(next);
  };

  // 锁滚动 + 关闭时还原焦点。
  // ⚠️ 锁滚动必须**补偿滚动条宽度**：`overflow:hidden` 会让滚动条消失、整页右移 15px，
  //    用户在灯箱里能看见背后的瀑布流"跳"了一下（桌面端实测就是 15px）。
  // ⚠️ 焦点用 `preventScroll: true` 还回去，否则浏览器为露出缩略图会再滚一次，
  //    表现是「关掉大图后列表跑到别的位置」。
  useEffect(() => {
    if (!viewerOpen) return undefined;
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      const trigger = viewerTriggerRef.current;
      if (trigger && typeof trigger.focus === 'function') {
        // ⚠️ 必须延到下一帧：用「点空白处」关闭时，mousedown 的**默认聚焦行为**
        //    在 React 事件处理之后才执行，同步 focus 会被它覆盖成 body
        //    （实测 activeElement 变成 BODY，键盘用户"丢失位置"）。
        requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      }
    };
  }, [viewerOpen]);

  // 键盘：Esc 关、← → 切换。只在打开时绑定，避免全局常驻监听。
  useEffect(() => {
    if (!viewerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setViewerIndex(null);
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setViewerIndex((current) => {
        if (current === null) return current;
        const next = current + (event.key === 'ArrowRight' ? 1 : -1);
        if (next < 0 || next >= items.length) return current;
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerOpen, items.length]);

  // 预加载相邻两张：切换时直接命中缓存，不会先看到一段空屏。
  useEffect(() => {
    if (!viewerOpen) return undefined;
    [viewerIndex - 1, viewerIndex + 1].forEach((idx) => {
      const url = items[idx]?.url;
      if (!url) return;
      const img = new Image();
      img.src = url;
    });
    return undefined;
  }, [viewerOpen, viewerIndex, items]);

  // 预览中列表变了（删掉自己的作品 / 切分类 / 发布后刷新）→ 下标必须收敛，否则会空白或越界
  useEffect(() => {
    if (viewerIndex === null) return;
    if (items.length === 0) {
      setViewerIndex(null);
      return;
    }
    if (viewerIndex > items.length - 1) setViewerIndex(items.length - 1);
  }, [items.length, viewerIndex]);

  // 移动端左右滑动切换。竖滑不劫持（否则想上下拖一下图会被误判成翻页）；
  // 位移小于 50px 当作误触，不切换 —— 手机上轻点提示层很容易带出几像素位移。
  const onViewerTouchStart = (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onViewerTouchEnd = (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchRef.current.x;
    const dy = touch.clientY - touchRef.current.y;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) <= Math.abs(dy) * 1.4) return;
    stepViewer(dx < 0 ? 1 : -1);
  };

  return (
    <section className="mt-12">
      {/* 标题行：标题 + 分类 chips + 搜索 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
          <Sparkles size={18} className="text-brand-600" /> 发现灵感
        </h2>

        <div className="order-3 -mx-1 w-full overflow-x-auto px-1 sm:order-2 sm:ml-2 sm:w-auto sm:flex-1">
          <div className="flex w-max items-center gap-2 py-1">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={`ig-chip whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition ${category === item.id
                  ? 'bg-brand-600 font-medium text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative order-2 ml-auto w-full sm:order-3 sm:w-56">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="搜索灵感…"
            maxLength={60}
            className="ig-input w-full rounded-full border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-1.5 flex min-h-[20px] items-center gap-3 text-xs text-slate-400">
        {total > 0 && <span>共 {total} 件作品</span>}
        {notice && <span className="text-brand-600">{notice}</span>}
      </div>

      {/* 瀑布流 */}
      {items.length > 0 && (
        <div className="mt-3 columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
          {items.map((item, index) => {
            const box = ratioPlaceholder(item.aspectRatio);
            return (
            <figure
              key={item.id}
              className="group relative mb-3 break-inside-avoid overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5"
            >
              {/* 点击看大图：整张缩略图就是一个按钮（键盘可 Tab 到、读屏有语义）。
                  提示只在桌面悬停出现 —— 手机上再叠一个徽标会和右上角「做同款」打架。 */}
              <button
                type="button"
                onClick={(event) => openViewer(index, event)}
                aria-label="查看大图"
                title="查看大图"
                className="ig-zoomable relative block w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                <img
                  src={item.url}
                  alt={item.prompt || '灵感作品'}
                  width={box.width}
                  height={box.height}
                  loading="lazy"
                  decoding="async"
                  className="w-full transition-transform duration-[600ms] ease-out sm:group-hover:scale-[1.04]"
                />
                <span className="ig-zoom-hint pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-900/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                  <ZoomIn size={12} /> 查看大图
                </span>
              </button>

              {/* 做同款：右上角，悬停出现（小屏常显，否则手机上没有入口） */}
              <button
                type="button"
                onClick={() => useAsPrompt(item)}
                className="ig-cta absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-slate-800 opacity-100 shadow-sm backdrop-blur transition hover:bg-white sm:opacity-0 sm:group-hover:opacity-100"
                title="把这张图的提示词填到上方输入框"
              >
                <Copy size={12} /> 做同款
              </button>

              {/* 底部信息：提示词 + 点赞（悬停出现） */}
              <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/90 via-slate-900/55 to-transparent p-2.5 pt-10 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
                <p className="line-clamp-2 text-[11px] leading-snug text-white/95">{item.prompt}</p>
                <div className="pointer-events-auto mt-1.5 flex items-center gap-3 text-[11px] text-white/80">
                  <button
                    type="button"
                    onClick={() => toggleLike(item)}
                    className="inline-flex items-center gap-1 transition hover:text-white"
                    title={item.liked ? '取消喜欢' : '喜欢'}
                  >
                    <Heart size={12} className={item.liked ? 'fill-rose-400 text-rose-400' : ''} />
                    {item.likes > 0 ? item.likes : '喜欢'}
                  </button>
                </div>
              </figcaption>
            </figure>
            );
          })}
        </div>
      )}

      {/* 空态：广场刚上线时必然是空的，必须给出去处，不能只留一片白 */}
      {!loading && items.length === 0 && !error && (
        <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-16 text-slate-400">
          <ImageOff size={34} className="ig-float" />
          <p className="text-sm">{keyword || category !== 'all' ? '没有匹配的作品，换个词或分类试试' : '灵感广场还没有作品'}</p>
          {!keyword && category === 'all' && <p className="text-xs text-slate-400">生成一张满意的图，点「加入灵感广场」就会出现在这里</p>}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
      )}

      {/* 哨兵 + 加载态 */}
      <div ref={sentinelRef} className="flex h-16 items-center justify-center text-xs text-slate-400">
        {loading && <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 加载中…</span>}
        {!loading && !hasMore && items.length > 0 && <span>已经看到全部了</span>}
      </div>

      {/* ===== 大图预览（灯箱）=====
          四个要点：
          1. `src` 直接用 `item.url`（列表里就是原图，没有缩略图副本）⇒ 清晰度与原图完全一致；
          2. 尺寸只受视口约束（92vw / 82vh）+ `width/height: auto` + `object-contain`，
             长图（1:5）、超宽图、超大像素图都等比缩进屏幕，绝不拉伸变形、绝不溢出；
          3. 小图保持原生像素**不放大**（auto 而不是 100%）—— 放大只会变糊；
          4. 关闭方式：右上角 ×、点空白处、按 Esc；点图片本身不关闭（防误触）。
             触屏另有左右滑动切换，桌面是 ← → 键 + 两侧箭头。 */}
      {viewerItem && (
        <div
          className="ig-lightbox fixed inset-0 z-[70] flex flex-col bg-slate-950/90 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="查看大图"
          onMouseDown={(event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            // 点按钮、点图片本身不关闭；其余留白（图区两侧、顶栏、底栏）都算「点空白处」
            if (target.closest('button') || target.closest('img')) return;
            closeViewer();
          }}
        >
          {/* 顶栏：位置计数 + 关闭 */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] tabular-nums text-white/80">
              {viewerIndex + 1} / {items.length}
            </span>
            <button
              type="button"
              onClick={closeViewer}
              aria-label="关闭预览"
              title="关闭预览（Esc）"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <X size={20} />
            </button>
          </div>

          {/* 图区：左右滑动切换（关闭判定在对话框根节点上，见上） */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2"
            onTouchStart={onViewerTouchStart}
            onTouchEnd={onViewerTouchEnd}
          >
            <button
              type="button"
              onClick={() => stepViewer(-1)}
              disabled={viewerIndex <= 0}
              aria-label="上一张"
              className="absolute left-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/10 sm:left-4 sm:h-11 sm:w-11"
            >
              <ChevronLeft size={22} />
            </button>

            <img
              src={viewerItem.url}
              alt={viewerItem.prompt || '灵感作品'}
              draggable={false}
              className="ig-lightbox-img rounded-lg shadow-2xl"
              style={{ width: 'auto', height: 'auto', maxWidth: '92vw', maxHeight: '82vh', objectFit: 'contain' }}
            />

            <button
              type="button"
              onClick={() => stepViewer(1)}
              disabled={viewerIndex >= items.length - 1 && !hasMore}
              aria-label="下一张"
              className="absolute right-1 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/10 sm:right-4 sm:h-11 sm:w-11"
            >
              <ChevronRight size={22} />
            </button>
          </div>

          {/* 底栏：提示词 + 操作提示（按设备分文案，触屏看到「按 Esc」等于没提示） */}
          <div className="shrink-0 px-4 pb-4 pt-2 text-center">
            <p className="mx-auto line-clamp-2 max-w-3xl text-[12px] leading-relaxed text-white/75">{viewerItem.prompt}</p>
            <p className="mt-1.5 text-[11px] text-white/45">
              <span className="sm:hidden">左右滑动切换 · 点空白处或右上角 × 关闭</span>
              <span className="hidden sm:inline">← → 切换 · 点击空白处或按 Esc 关闭</span>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
