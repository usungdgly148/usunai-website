// 灵感广场分类：以服务端为真值的一次性拉取 + 模块级共享缓存。
//
// 为什么单独一个 hook：这一页有**两处**要用分类清单 ——
//   · InspirationPlaza 的筛选 chips
//   · ImageGen 的「加入灵感广场」弹窗
// 两边各写一份 fetch 会打两次接口、还可能短暂不一致（弹窗里能选、chips 里没有）。
// 这里用模块级 cache + inflight 去重，两个组件同时挂载也只发一个请求。
//
// ⚠️ 缓存**不做 TTL**：分类是低频配置，页面刷新就重新拉，够用；做 TTL 反而会让
//    「后台刚改完、前端半天不生效」这种老问题重现。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './authFetch.js';
import { PLAZA_CATEGORIES, categoryLabel } from './inspirationCategories.js';

let cache = PLAZA_CATEGORIES;
let inflight = null;
const listeners = new Set();

function publish(next) {
  cache = next;
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* 单个订阅者出错不影响其他 */ }
  });
  return next;
}

function load() {
  if (inflight) return inflight;
  inflight = apiFetch('/api/inspiration/categories')
    .then((res) => res.json())
    .then((data) => {
      const list = data && data.ok && Array.isArray(data.categories) ? data.categories : null;
      // 服务端回空清单（配置损坏等）时不覆盖兜底值，页面至少还能用
      return list && list.length ? publish(list) : cache;
    })
    .catch(() => cache)
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * @returns {{categories: Array<{id:string,label:string}>, publishable: Array, labelOf: (id:string)=>string}}
 *   categories  含「全部」合成项，用于 chips
 *   publishable 不含「全部」，用于发布弹窗与默认值
 */
export function useInspirationCategories() {
  const [categories, setCategories] = useState(cache);

  useEffect(() => {
    let alive = true;
    const onUpdate = (next) => { if (alive) setCategories(next); };
    listeners.add(onUpdate);
    load().then((list) => { if (alive && list) setCategories(list); });
    return () => { alive = false; listeners.delete(onUpdate); };
  }, []);

  // 必须 memo：调用方会把它放进 effect 依赖，每次渲染新数组会让 effect 反复触发
  const publishable = useMemo(() => categories.filter((item) => item.id !== 'all'), [categories]);
  const labelOf = useCallback((id) => categoryLabel(id, categories), [categories]);

  return { categories, publishable, labelOf };
}

/** 供后台改完分类后强制刷新（后台页保存成功时调用，用户页下次进入即拿到新清单）。 */
export function invalidateInspirationCategories() {
  inflight = null;
  return load();
}
