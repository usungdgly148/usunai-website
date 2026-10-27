import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Heart, ImageOff, Loader2, Search, Sparkles, Trash2 } from 'lucide-react';
import { apiFetch } from './authFetch.js';
import { PLAZA_CATEGORIES } from './inspirationCategories.js';

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
  const [category, setCategory] = useState('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [total, setTotal] = useState(0);

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

  const removeItem = async (item) => {
    if (!window.confirm('确定从灵感广场移除这张作品？')) return;
    try {
      const res = await apiFetch('/api/inspiration/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '删除失败');
      setItems((prev) => prev.filter((one) => one.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
      flash('已从灵感广场移除');
    } catch (e) {
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

  return (
    <section className="mt-12">
      {/* 标题行：标题 + 分类 chips + 搜索 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
          <Sparkles size={18} className="text-brand-600" /> 发现灵感
        </h2>

        <div className="order-3 -mx-1 w-full overflow-x-auto px-1 sm:order-2 sm:ml-2 sm:w-auto sm:flex-1">
          <div className="flex w-max items-center gap-2 py-1">
            {PLAZA_CATEGORIES.map((item) => (
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
          {items.map((item) => {
            const box = ratioPlaceholder(item.aspectRatio);
            return (
            <figure
              key={item.id}
              className="group relative mb-3 break-inside-avoid overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5"
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
                  {item.mine && (
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      className="ml-auto inline-flex items-center gap-1 transition hover:text-white"
                      title="从灵感广场移除"
                    >
                      <Trash2 size={12} /> 移除
                    </button>
                  )}
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
    </section>
  );
}
