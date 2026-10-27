import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, Check, Copy, ImageOff, Loader2, Pencil, Plus,
  RefreshCw, Search, Trash2,
} from 'lucide-react';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, Modal, PrimaryButton, SecondaryButton } from '../adminUI.jsx';
import { invalidateInspirationCategories } from '../useInspirationCategories.js';

// 分类标识规则 —— **必须与 server/inspiration.mjs 的 INSPIRATION_CATEGORY_ID_RE 一致**，
// 前端先挡一次只是为了让用户立刻看到原因，服务端那道校验才是安全边界。
const ID_RE = /^[a-z][a-z0-9_-]{1,23}$/;
const LABEL_MAX = 12;
const PAGE_SIZE = 24;
const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';

const fmtDate = (value) => {
  const text = String(value || '');
  if (!text) return '—';
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return text.slice(0, 16).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/**
 * 灵感广场后台管理：**分类**（增删改序、启停）+ **作品**（筛选、改分类、改提示词、删除）。
 *
 * 三个刻意的选择：
 * 1. 分类走「草稿 + 保存」而不是逐项自动保存 —— 删除分类时服务端会因为「分类下还有作品」
 *    而拒绝，逐项保存会让用户点三下才发现白改。草稿模式可以整份校验、一次报错。
 * 2. 列表用游标分页 + 「加载更多」，不用页码：作品是按时间倒序插到最前面的，
 *    页码翻页会重复/漏条（与用户端广场同一个理由）。
 * 3. 改分类是**即时生效**（点选即提交）：这是最高频的整理动作，多一次「保存」纯属添乱。
 */
export default function AdminInspiration() {
  // ===== 分类 =====
  const [draft, setDraft] = useState(null);          // [{id,label,enabled}]
  const [counts, setCounts] = useState({});          // 分类 id → 作品数
  const [totalItems, setTotalItems] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [maxCategories, setMaxCategories] = useState(12);
  const [savingCats, setSavingCats] = useState(false);
  const [catMsg, setCatMsg] = useState(null);        // {ok, msg}
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // ===== 作品 =====
  const [items, setItems] = useState([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsMsg, setItemsMsg] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState(null);      // 正在改提示词的作品
  const [editPrompt, setEditPrompt] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const cursorRef = useRef(0);
  const seqRef = useRef(0);
  const [movingId, setMovingId] = useState('');      // 正在改分类的作品 id
  const [deletingId, setDeletingId] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/inspiration/settings');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '读取分类失败');
      setDraft(Array.isArray(data.categories) ? data.categories : []);
      setCounts(data.counts || {});
      setTotalItems(Number(data.totalItems) || 0);
      setUnknownCount(Number(data.unknownCount) || 0);
      setMaxCategories(Number(data.maxCategories) || 12);
    } catch (e) {
      setCatMsg({ ok: false, msg: String(e.message || e) });
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 搜索防抖（320ms），与用户端广场同一节奏
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 320);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const loadItems = useCallback(async (reset) => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoadingItems(true);
    try {
      const offset = reset ? 0 : cursorRef.current;
      const params = new URLSearchParams({ cursor: String(offset), limit: String(PAGE_SIZE) });
      if (filterCategory !== 'all') params.set('category', filterCategory);
      if (keyword) params.set('q', keyword);
      const res = await adminFetch(`/api/admin/inspiration/items?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== seqRef.current) return;
      if (!res.ok || !data.ok) throw new Error(data.error || '读取作品失败');
      const fresh = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        if (reset) return fresh;
        const seen = new Set(prev.map((one) => one.id));
        return [...prev, ...fresh.filter((one) => !seen.has(one.id))];
      });
      cursorRef.current = Number(data.nextCursor) || 0;
      setHasMore(data.hasMore === true);
      setItemsTotal(Number(data.total) || 0);
      setItemsMsg('');
    } catch (e) {
      if (seq === seqRef.current) setItemsMsg(String(e.message || e));
    } finally {
      if (seq === seqRef.current) setLoadingItems(false);
    }
  }, [filterCategory, keyword]);

  // 筛选 / 关键词 / 分类保存后 → 从头发一次
  useEffect(() => {
    cursorRef.current = 0;
    setHasMore(false);
    loadItems(true);
  }, [loadItems]);

  // ===== 分类草稿操作 =====
  const patchCat = (index, patch) => {
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setCatMsg(null);
  };

  const moveCat = (index, delta) => {
    setDraft((prev) => {
      const next = prev.slice();
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setCatMsg(null);
  };

  const removeCat = (index) => {
    const target = draft[index];
    const used = counts[target.id] || 0;
    if (used > 0) {
      setCatMsg({ ok: false, msg: `「${target.label}」下还有 ${used} 件作品，请先把它们改到别的分类再删除` });
      return;
    }
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setCatMsg(null);
  };

  const addCat = () => {
    const id = newId.trim().toLowerCase();
    const label = newLabel.trim();
    if (!draft) return;
    if (!ID_RE.test(id)) {
      setCatMsg({ ok: false, msg: '标识需 2~24 位：小写字母开头，只能含小写字母/数字/下划线/短横线（如 pet、home-decor）' });
      return;
    }
    if (draft.some((item) => item.id === id)) { setCatMsg({ ok: false, msg: `标识「${id}」已存在` }); return; }
    if (!label) { setCatMsg({ ok: false, msg: '请填写显示名称' }); return; }
    if (label.length > LABEL_MAX) { setCatMsg({ ok: false, msg: `显示名称最多 ${LABEL_MAX} 个字` }); return; }
    if (draft.length >= maxCategories) { setCatMsg({ ok: false, msg: `分类最多 ${maxCategories} 个` }); return; }
    setDraft((prev) => [...prev, { id, label, enabled: true }]);
    setNewId('');
    setNewLabel('');
    setCatMsg({ ok: true, msg: '已加到列表末尾，记得点「保存分类」' });
  };

  const saveCategories = async () => {
    if (!draft || savingCats) return;
    setSavingCats(true);
    setCatMsg(null);
    try {
      const res = await adminFetch('/api/admin/inspiration/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: draft.map((item) => ({ id: item.id, label: item.label, enabled: !!item.enabled })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `保存失败（HTTP ${res.status}）`);
      setDraft(Array.isArray(data.categories) ? data.categories : draft);
      setCounts(data.counts || {});
      setTotalItems(Number(data.totalItems) || 0);
      setCatMsg({ ok: true, msg: '已保存，用户端刷新即生效（无需发版）' });
      // 让前台共享缓存失效，下次进入页面拿到新清单
      invalidateInspirationCategories().catch(() => {});
      // 分类变了，作品列表的筛选下拉与归属显示都要重来
      loadItems(true);
    } catch (e) {
      setCatMsg({ ok: false, msg: String(e.message || e) });
    } finally {
      setSavingCats(false);
    }
  };

  // ===== 作品操作 =====
  const changeCategory = async (item, category) => {
    setMovingId(item.id);
    try {
      const res = await adminFetch('/api/admin/inspiration/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, category }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '修改分类失败');
      const nextCategory = data.item?.category || category;
      setItems((prev) => prev.map((one) => (one.id === item.id ? { ...one, category: nextCategory } : one)));
      // 分类计数变了，同步一份（不改的话分类行上的「N 件」还是旧的）
      setCounts((prev) => {
        const next = { ...prev };
        next[item.category] = Math.max(0, (next[item.category] || 0) - 1);
        next[nextCategory] = (next[nextCategory] || 0) + 1;
        return next;
      });
      setItemsMsg('');
    } catch (e) {
      setItemsMsg(String(e.message || e));
    } finally {
      setMovingId('');
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm('确定从灵感广场删除这张作品？删除后用户端立即消失，且不可恢复。')) return;
    setDeletingId(item.id);
    try {
      const res = await adminFetch('/api/admin/inspiration/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '删除失败');
      setItems((prev) => prev.filter((one) => one.id !== item.id));
      setItemsTotal((prev) => Math.max(0, prev - 1));
      setTotalItems((prev) => Math.max(0, prev - 1));
      setCounts((prev) => ({ ...prev, [item.category]: Math.max(0, (prev[item.category] || 0) - 1) }));
      setItemsMsg('');
    } catch (e) {
      setItemsMsg(String(e.message || e));
    } finally {
      setDeletingId('');
    }
  };

  const openEditPrompt = (item) => {
    setEditing(item);
    setEditPrompt(item.prompt || '');
  };

  const savePrompt = async () => {
    if (!editing || editSaving) return;
    const text = editPrompt.trim();
    if (!text) { setItemsMsg('提示词不能为空'); return; }
    setEditSaving(true);
    try {
      const res = await adminFetch('/api/admin/inspiration/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, prompt: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '保存失败');
      setItems((prev) => prev.map((one) => (one.id === editing.id ? { ...one, prompt: text } : one)));
      setEditing(null);
      setItemsMsg('');
    } catch (e) {
      setItemsMsg(String(e.message || e));
    } finally {
      setEditSaving(false);
    }
  };

  const categoryOptions = useMemo(() => (draft || []).map((item) => ({ id: item.id, label: item.label, enabled: item.enabled })),
    [draft]);
  const labelOf = useCallback((id) => {
    const found = (draft || []).find((item) => item.id === id);
    return found ? found.label : `${id}（已删除）`;
  }, [draft]);

  const enabledCount = (draft || []).filter((item) => item.enabled).length;

  return (
    <div>
      <AdminPageHeader
        title="灵感广场"
        subtitle="管理用户端「发现灵感」的分类与作品。分类顺序即用户端 chips 顺序；停用的分类不再出现在用户端，但已有作品不会丢。"
        actions={(
          <SecondaryButton onClick={() => { loadSettings(); loadItems(true); }}>
            <RefreshCw size={15} /> 刷新
          </SecondaryButton>
        )}
      />

      {/* ===== 分类管理 ===== */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-700">分类管理</div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
              共 {(draft || []).length} 个分类（启用 {enabledCount} 个，上限 {maxCategories}）。
              「全部」是系统固定的筛选入口，不在此列、不能删。
              删除分类前必须先把它下面的作品改到别的分类，否则会被拦住 —— 这是故意的，
              否则那些作品会变成用户端永远筛不出来的孤儿。
            </p>
          </div>
          <PrimaryButton onClick={saveCategories} disabled={savingCats || !draft}>
            {savingCats ? '保存中…' : '保存分类'}
          </PrimaryButton>
        </div>

        {!draft && <p className="text-sm text-slate-400">正在读取分类…</p>}

        {draft && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left font-medium px-2 py-1 w-20">顺序</th>
                  <th className="text-left font-medium px-2 py-1 w-40">标识（不可改）</th>
                  <th className="text-left font-medium px-2 py-1">显示名称</th>
                  <th className="text-center font-medium px-2 py-1 w-24">用户端</th>
                  <th className="text-center font-medium px-2 py-1 w-24">作品数</th>
                  <th className="text-center font-medium px-2 py-1 w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {draft.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-3 text-slate-400">还没有分类，请先在下方添加。</td></tr>
                )}
                {draft.map((item, index) => (
                  <tr key={item.id} className={`${item.enabled ? 'bg-slate-50/60' : 'bg-slate-100/60'} `}>
                    <td className="px-2 py-1.5 align-middle">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveCat(index, -1)}
                          disabled={index === 0}
                          title="上移"
                          className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCat(index, 1)}
                          disabled={index === draft.length - 1}
                          title="下移"
                          className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <span className="ml-1 text-xs text-slate-400">{index + 1}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <span className="font-mono text-xs text-slate-500">{item.id}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        value={item.label}
                        maxLength={LABEL_MAX}
                        onChange={(e) => patchCat(index, { label: e.target.value })}
                        placeholder="显示名称"
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle text-center">
                      <input
                        type="checkbox"
                        checked={!!item.enabled}
                        title={item.enabled ? '用户端可见' : '用户端隐藏'}
                        onChange={(e) => patchCat(index, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1.5 align-middle text-center text-xs text-slate-500">
                      {counts[item.id] || 0}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-center">
                      <button
                        type="button"
                        onClick={() => removeCat(index)}
                        title="从列表移除（保存后生效）"
                        className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-500 transition hover:border-rose-300 hover:text-rose-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-600 mb-1">新增标识</label>
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="如 pet"
                maxLength={24}
                className={inputCls}
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-slate-600 mb-1">显示名称</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="如 宠物用品"
                maxLength={LABEL_MAX}
                className={inputCls}
              />
            </div>
            <SecondaryButton onClick={addCat} disabled={draft.length >= maxCategories}>
              <Plus size={15} /> 添加到列表
            </SecondaryButton>
            <p className="text-xs text-slate-400">
              标识只能用英文：它是写进作品数据的字段值，改标识会打断已有数据（改名称不会）。
            </p>
          </div>
        )}

        {catMsg && (
          <p className={`mt-2 flex items-start gap-1.5 text-xs ${catMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
            {catMsg.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
            <span>{catMsg.msg}</span>
          </p>
        )}
      </Card>

      {/* ===== 作品管理 ===== */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-medium text-slate-700">作品管理</div>
            <p className="text-xs text-slate-400 mt-1">
              共 {totalItems} 件作品{unknownCount > 0 ? `，其中 ${unknownCount} 件挂在已删除的分类下` : ''}。
              改分类即时生效；删除后用户端立即消失。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">全部分类</option>
              {categoryOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.label}（{counts[item.id] || 0}）</option>
              ))}
              {unknownCount > 0 && <option value="unknown">未分类 / 已删除分类（{unknownCount}）</option>}
            </select>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="搜索提示词或用户 ID"
                maxLength={60}
                className="w-56 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {itemsMsg && (
          <p className="mb-3 flex items-start gap-1.5 text-xs text-rose-600">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{itemsMsg}</span>
          </p>
        )}

        {!loadingItems && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 py-16 text-slate-400">
            <ImageOff size={32} />
            <p className="text-sm">
              {keyword || filterCategory !== 'all' ? '没有匹配的作品' : '还没有作品。用户在前端生成后点「加入灵感广场」就会出现在这里。'}
            </p>
          </div>
        )}

        {items.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="relative bg-slate-100">
                  <img src={item.url} alt={item.prompt || '作品'} loading="lazy" className="h-44 w-full object-cover" />
                  <span className="absolute left-2 top-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[11px] text-white">
                    {labelOf(item.category)}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <p className="line-clamp-3 text-xs leading-relaxed text-slate-600" title={item.prompt}>{item.prompt}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span>{fmtDate(item.createdAt)}</span>
                    <span>·</span>
                    <span>{item.likes} 赞</span>
                    {item.model && <><span>·</span><span className="truncate">{item.model}</span></>}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    用户 {item.userId ? `${item.userId.slice(0, 6)}…${item.userId.slice(-4)}` : '—'}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <select
                      value={item.category}
                      disabled={movingId === item.id}
                      onChange={(e) => changeCategory(item, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 disabled:opacity-60"
                    >
                      {!categoryOptions.some((one) => one.id === item.category) && (
                        <option value={item.category}>{labelOf(item.category)}</option>
                      )}
                      {categoryOptions.map((one) => (
                        <option key={one.id} value={one.id}>{one.label}</option>
                      ))}
                    </select>
                    {movingId === item.id && <Loader2 size={13} className="shrink-0 animate-spin text-slate-400" />}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditPrompt(item)}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
                    >
                      <Pencil size={12} /> 改提示词
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(String(item.prompt || '')).catch(() => {});
                      }}
                      title="复制提示词"
                      className="rounded-lg border border-slate-300 p-1.5 text-slate-500 transition hover:bg-slate-50"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteItem(item)}
                      disabled={deletingId === item.id}
                      title="删除"
                      className="rounded-lg border border-slate-300 p-1.5 text-slate-500 transition hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                    >
                      {deletingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-slate-400">
          {loadingItems && <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 加载中…</span>}
          {!loadingItems && hasMore && (
            <button
              type="button"
              onClick={() => loadItems(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50"
            >
              加载更多（已显示 {items.length}/{itemsTotal}）
            </button>
          )}
          {!loadingItems && !hasMore && items.length > 0 && <span>已显示全部 {items.length} 件</span>}
        </div>
      </Card>

      {/* ===== 改提示词弹窗 ===== */}
      <Modal
        open={Boolean(editing)}
        onClose={() => { if (!editSaving) setEditing(null); }}
        title="修改提示词"
        footer={(
          <>
            <SecondaryButton onClick={() => setEditing(null)} disabled={editSaving}>取消</SecondaryButton>
            <PrimaryButton onClick={savePrompt} disabled={editSaving}>
              {editSaving ? '保存中…' : '保存'}
            </PrimaryButton>
          </>
        )}
      >
        <p className="mb-2 text-xs text-slate-400">
          用户点「做同款」时填进输入框的就是这段文字，改完立即生效。
        </p>
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          rows={8}
          maxLength={2000}
          className={`${inputCls} resize-y leading-relaxed`}
        />
        <p className="mt-1 text-right text-xs text-slate-400">{editPrompt.length}/2000</p>
        {editing && (
          <img src={editing.url} alt="作品" className="mt-2 max-h-48 w-full rounded-lg border border-slate-200 object-contain" />
        )}
      </Modal>
    </div>
  );
}
