// 灵感广场（AI全能设计）—— 用户主动发布的生成结果作品墙 + 后台管理面。
//
// 为什么单独一个模块：index.mjs 已经近 6000 行，这类「自成一套的小功能」再往里塞
// 会让路由表更难读。约定与 miniapp-*.mjs 一致：导出 handleInspiration(req,res,u,deps)，
// 命中返回 true，未命中返回 false，由 index.mjs 继续往下走。
//
// 存储：**两个 KV 键**
//   · `inspirationPlaza`         —— 作品数组，新→旧。为什么不按条分键：广场要「按时间倒序 +
//     分类筛选 + 提示词搜索 + 游标分页」，单键数组一次读出来就能全部完成；分键还得额外维护
//     一套索引，得不偿失。代价是每次列表整份读一次，所以加了硬上限 INSPIRATION_MAX_ITEMS
//     条（超出丢最旧），300 条 × ~350 字节 ≈ 100KB 量级，可以接受。
//   · `inspirationPlazaSettings` —— 分类清单（后台可增删改序）。以前分类是写死在代码里的，
//     后台要「管理图片分类」就必须挪进 KV；代码里的 DEFAULT 只当**首次默认值 + 兜底**用。
// ⚠️ 这里**不存用户身份**给前端展示：作品墙只需要图 + 提示词 + 点赞数（参考设计就是如此），
//    少存一份昵称/头像就少一份泄露面。只用 userId 做「是否本人」判断（后台管理面才下发它）。
import crypto from 'node:crypto';

export const INSPIRATION_KEY = 'inspirationPlaza';
export const INSPIRATION_SETTINGS_KEY = 'inspirationPlazaSettings';
export const INSPIRATION_MAX_ITEMS = 300;
export const INSPIRATION_PAGE_MAX = 40;
export const INSPIRATION_PAGE_DEFAULT = 20;
export const INSPIRATION_PROMPT_MAX = 2000;
export const INSPIRATION_CATEGORY_MAX = 12;
export const INSPIRATION_CATEGORY_LABEL_MAX = 12;

// 分类 id 必须自己带英文标识：不能拿中文名现推（拼音化不可靠，且改中文名会打断已有数据）。
export const INSPIRATION_CATEGORY_ID_RE = /^[a-z][a-z0-9_-]{1,23}$/;

// 默认分类（不含「全部」）。**必须与 frontend/src/inspirationCategories.js 的 DEFAULT_CATEGORIES 一致**，
// 守卫 check-inspiration-plaza 会逐项比对 —— 漂移会让后台看到的名字和用户页不一样。
export const INSPIRATION_DEFAULT_CATEGORIES = [
  { id: 'ecommerce', label: '电商营销' },
  { id: 'festival', label: '热点节日' },
  { id: 'season', label: '时令节气' },
  { id: 'poster', label: '海报设计' },
  { id: 'ui', label: 'UI设计' },
];

// 「全部」是筛选用的合成项，**不是真实分类**：不可发布、不可删除、永远是第一个。
export const ALL_CATEGORY = { id: 'all', label: '全部' };
export const INSPIRATION_CATEGORIES = [ALL_CATEGORY, ...INSPIRATION_DEFAULT_CATEGORIES];

// 只接受**本站图床**的生成图（`/api/blob/serve?key=uploads/...`）。
// 允许传外链等于把广场变成一个任意图片代理/外链托管，必须堵死。
const BLOB_PATH = '/api/blob/serve';
const UPLOAD_KEY_RE = /^uploads\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function normalizeOwnImageUrl(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  let key = '';
  try {
    if (text.startsWith(`${BLOB_PATH}?`)) {
      key = new URLSearchParams(text.slice(BLOB_PATH.length + 1)).get('key') || '';
    } else {
      // 兼容绝对地址（老前端 / 反代改写），但域名不限，最终只认 key
      const parsed = new URL(text);
      if (parsed.pathname !== BLOB_PATH) return '';
      key = parsed.searchParams.get('key') || '';
    }
  } catch {
    return '';
  }
  if (!UPLOAD_KEY_RE.test(key)) return '';
  // 统一重建成规范形式，防止原 query 里夹带其它参数
  return `${BLOB_PATH}?key=${encodeURIComponent(key)}`;
}

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * 分类清单收敛：校验 id / 名称 / 数量 / 唯一性。
 * 返回 `{ ok:true, categories }` 或 `{ ok:false, error }` —— 保存失败要给后台看得懂的原因，
 * 不能静默丢弃（静默丢字段是本项目踩过的老坑）。
 */
export function normalizeCategoryList(raw) {
  if (!Array.isArray(raw)) return { ok: false, error: '分类清单格式不正确' };
  if (!raw.length) return { ok: false, error: '至少要保留一个分类' };
  if (raw.length > INSPIRATION_CATEGORY_MAX) {
    return { ok: false, error: `分类最多 ${INSPIRATION_CATEGORY_MAX} 个` };
  }
  const seen = new Set();
  const categories = [];
  for (const item of raw) {
    const id = cleanText(item && item.id, 40).toLowerCase();
    const label = cleanText(item && item.label, 80);
    // 「all」是合成项，不是真分类：允许它入库会直接打乱筛选逻辑
    if (id === ALL_CATEGORY.id) {
      return { ok: false, error: '「all」是系统保留标识，请换一个' };
    }
    if (!INSPIRATION_CATEGORY_ID_RE.test(id)) {
      return { ok: false, error: `标识「${id || '空'}」不合法：需 2~24 位小写字母开头，只能含字母/数字/下划线/短横线` };
    }
    if (seen.has(id)) return { ok: false, error: `标识「${id}」重复` };
    if (!label) return { ok: false, error: `标识「${id}」缺少显示名称` };
    // 超长要**拒绝**而不是截断：静默截断会让人以为改成功了，刷新才发现少了几个字
    if (label.length > INSPIRATION_CATEGORY_LABEL_MAX) {
      return { ok: false, error: `「${id}」的名称太长（最多 ${INSPIRATION_CATEGORY_LABEL_MAX} 个字）` };
    }
    seen.add(id);
    categories.push({ id, label, enabled: item.enabled !== false });
  }
  if (!categories.some((item) => item.enabled)) {
    return { ok: false, error: '至少要启用一个分类，否则用户端没有分类可选' };
  }
  return { ok: true, categories };
}

/** 读分类：KV 有合法配置就用它，否则回落到默认清单（首次上线 / 配置损坏）。 */
async function readCategories(KV) {
  const raw = await KV.kvGet(INSPIRATION_SETTINGS_KEY);
  const stored = raw && Array.isArray(raw.categories) ? normalizeCategoryList(raw.categories) : null;
  if (stored && stored.ok) return stored.categories;
  return INSPIRATION_DEFAULT_CATEGORIES.map((item) => ({ ...item, enabled: true }));
}

/** 下发给用户端的分类（含合成项「全部」，且只含已启用的）。 */
function toPublicCategories(list) {
  const enabled = list.filter((item) => item.enabled !== false);
  // 防御：即便全被停用也不能下发空清单（页面上会一个 chip 都没有）
  const usable = enabled.length ? enabled : INSPIRATION_DEFAULT_CATEGORIES.map((item) => ({ ...item, enabled: true }));
  return [ALL_CATEGORY, ...usable.map((item) => ({ id: item.id, label: item.label }))];
}

function toPublicItem(item, session) {
  const uid = session && session.userId ? String(session.userId) : '';
  const likedBy = Array.isArray(item.likedBy) ? item.likedBy : [];
  return {
    id: item.id,
    url: item.url,
    prompt: item.prompt,
    category: item.category,
    model: item.model || '',
    aspectRatio: item.aspectRatio || '',
    resolution: item.resolution || '',
    likes: likedBy.length,
    liked: uid ? likedBy.includes(uid) : false,
    mine: uid ? String(item.userId || '') === uid : false,
    createdAt: item.createdAt,
  };
}

/** 后台版：多带 userId 与点赞人（管理员需要定位是谁发的，也便于排查刷赞）。 */
function toAdminItem(item) {
  const likedBy = Array.isArray(item.likedBy) ? item.likedBy : [];
  return {
    id: item.id,
    url: item.url,
    prompt: item.prompt,
    category: item.category,
    model: item.model || '',
    aspectRatio: item.aspectRatio || '',
    resolution: item.resolution || '',
    userId: String(item.userId || ''),
    likes: likedBy.length,
    likedBy,
    createdAt: item.createdAt,
  };
}

async function readItems(KV) {
  const raw = await KV.kvGet(INSPIRATION_KEY);
  if (!Array.isArray(raw)) return [];
  // 读取侧也做一次收敛：KV 里可能留有早期版本的脏数据
  return raw.filter((item) => item && item.id && item.url && item.prompt);
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function countByCategory(items) {
  const map = {};
  for (const item of items) {
    const key = String(item.category || '');
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

/**
 * 路由入口。deps 由 index.mjs 传入，保持与其它 handle* 一致的形状。
 * 同时接两套前缀：
 *   /api/inspiration/*        —— 用户端（列表公开，发布/点赞/删除需登录）
 *   /api/admin/inspiration/*  —— 后台管理（全部需要管理员会话）
 * @returns {Promise<boolean>} 是否已处理（true = 已响应，调用方直接 return）
 */
export async function handleInspiration(req, res, u, deps) {
  const { KV, readBody, requireUser, getSession, isAdminSession } = deps;
  const p = u.pathname;
  const adminApi = p.startsWith('/api/admin/inspiration/');
  if (!adminApi && !p.startsWith('/api/inspiration/')) return false;

  /** 后台接口统一鉴权：这里不用 deps.requireAdmin（它不在此模块的依赖里），
   *  用同一套 isAdminSession 判定，语义与 requireAdmin 完全一致（401 = 没登录/不是管理员）。 */
  const needAdmin = () => {
    const session = getSession(req);
    if (session && typeof isAdminSession === 'function' && isAdminSession(session)) return session;
    sendJson(res, 401, { ok: false, error: '需要管理员权限' });
    return null;
  };

  // ======================================================================
  // 用户端
  // ======================================================================

  // ---------- 分类清单（公开；发布弹窗与广场 chips 都读这里）----------
  if (p === '/api/inspiration/categories' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, categories: toPublicCategories(await readCategories(KV)) });
    } catch (error) {
      console.error('[inspiration:categories] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '分类加载失败' });
    }
    return true;
  }

  // ---------- 列表：公开可读（未登录也能逛，只是拿不到 liked 状态）----------
  if (p === '/api/inspiration/list' && req.method === 'GET') {
    try {
      const session = getSession(req);
      const items = await readItems(KV);
      const categories = await readCategories(KV);
      const known = new Set(categories.map((item) => item.id));
      const wantedCategory = cleanText(u.searchParams.get('category'), 24) || 'all';
      // 只认「现存分类」；已删除分类的残留作品仍然存在于库里，但不能再被单独筛出来
      const category = wantedCategory === 'all' || known.has(wantedCategory) ? wantedCategory : 'all';
      const keyword = cleanText(u.searchParams.get('q'), 60).toLowerCase();
      const cursor = Math.max(0, Math.floor(Number(u.searchParams.get('cursor')) || 0));
      const askedLimit = Math.floor(Number(u.searchParams.get('limit')) || 0);
      const limit = Math.min(INSPIRATION_PAGE_MAX, Math.max(1, askedLimit || INSPIRATION_PAGE_DEFAULT));

      let filtered = items;
      if (category !== 'all') filtered = filtered.filter((item) => item.category === category);
      if (keyword) {
        filtered = filtered.filter((item) => String(item.prompt || '').toLowerCase().includes(keyword));
      }

      const page = filtered.slice(cursor, cursor + limit);
      const nextCursor = cursor + page.length;
      sendJson(res, 200, {
        ok: true,
        items: page.map((item) => toPublicItem(item, session)),
        total: filtered.length,
        nextCursor,
        hasMore: nextCursor < filtered.length,
        categories: toPublicCategories(categories),
      });
    } catch (error) {
      console.error('[inspiration:list] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '灵感广场加载失败' });
    }
    return true;
  }

  // ---------- 发布 ----------
  if (p === '/api/inspiration/publish' && req.method === 'POST') {
    const session = requireUser(req, res, '未登录，无法发布到灵感广场');
    if (!session) return true;
    try {
      const body = await readBody(req);
      const url = normalizeOwnImageUrl(body && body.url);
      if (!url) {
        sendJson(res, 400, { ok: false, error: '只能发布本平台生成的图片', code: 'INSPIRATION_BAD_URL' });
        return true;
      }
      const prompt = cleanText(body && body.prompt, INSPIRATION_PROMPT_MAX);
      if (!prompt) {
        sendJson(res, 400, { ok: false, error: '缺少提示词，无法发布', code: 'INSPIRATION_PROMPT_REQUIRED' });
        return true;
      }
      // 分类白名单**从 KV 现读**（后台随时会增删分类）；「全部」永远不是可发布分类。
      const enabled = (await readCategories(KV)).filter((item) => item.enabled !== false && item.id !== ALL_CATEGORY.id);
      const askedCategory = cleanText(body && body.category, 24);
      const category = enabled.some((item) => item.id === askedCategory)
        ? askedCategory
        : (enabled[0] || { id: INSPIRATION_DEFAULT_CATEGORIES[0].id }).id;
      const items = await readItems(KV);
      if (items.some((item) => item.url === url)) {
        sendJson(res, 409, { ok: false, error: '这张图已经在灵感广场里了', code: 'INSPIRATION_DUPLICATE' });
        return true;
      }
      const item = {
        id: `insp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        url,
        prompt,
        category,
        model: cleanText(body && body.model, 60),
        aspectRatio: cleanText(body && body.aspectRatio, 12),
        resolution: cleanText(body && body.resolution, 12),
        userId: String(session.userId),
        likedBy: [],
        createdAt: new Date().toISOString(),
      };
      const next = [item, ...items].slice(0, INSPIRATION_MAX_ITEMS);
      await KV.kvPut(INSPIRATION_KEY, next);
      sendJson(res, 200, { ok: true, item: toPublicItem(item, session), total: next.length });
    } catch (error) {
      console.error('[inspiration:publish] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '发布失败，请稍后重试' });
    }
    return true;
  }

  // ---------- 点赞 / 取消（切换）----------
  if (p === '/api/inspiration/like' && req.method === 'POST') {
    const session = requireUser(req, res, '登录后才能点赞');
    if (!session) return true;
    try {
      const body = await readBody(req);
      const id = cleanText(body && body.id, 80);
      if (!id) { sendJson(res, 400, { ok: false, error: '缺少作品 id' }); return true; }
      const uid = String(session.userId);
      const items = await readItems(KV);
      const index = items.findIndex((item) => String(item.id) === id);
      if (index < 0) { sendJson(res, 404, { ok: false, error: '作品不存在或已被删除' }); return true; }
      const target = items[index];
      const likedBy = Array.isArray(target.likedBy) ? target.likedBy.slice() : [];
      const at = likedBy.indexOf(uid);
      if (at >= 0) likedBy.splice(at, 1); else likedBy.push(uid);
      const nextItem = { ...target, likedBy };
      const next = items.map((item, i) => (i === index ? nextItem : item));
      await KV.kvPut(INSPIRATION_KEY, next);
      sendJson(res, 200, { ok: true, ...toPublicItem(nextItem, session) });
    } catch (error) {
      console.error('[inspiration:like] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '点赞失败，请稍后重试' });
    }
    return true;
  }

  // ---------- 删除（本人或管理员）----------
  if (p === '/api/inspiration/delete' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) { sendJson(res, 401, { ok: false, error: '未登录' }); return true; }
    try {
      const body = await readBody(req);
      const id = cleanText(body && body.id, 80);
      if (!id) { sendJson(res, 400, { ok: false, error: '缺少作品 id' }); return true; }
      const items = await readItems(KV);
      const target = items.find((item) => String(item.id) === id);
      if (!target) { sendJson(res, 404, { ok: false, error: '作品不存在或已被删除' }); return true; }
      const isOwner = String(target.userId || '') === String(session.userId || '');
      const admin = typeof isAdminSession === 'function' ? isAdminSession(session) : false;
      if (!isOwner && !admin) { sendJson(res, 403, { ok: false, error: '只能删除自己发布的作品' }); return true; }
      const next = items.filter((item) => String(item.id) !== id);
      await KV.kvPut(INSPIRATION_KEY, next);
      sendJson(res, 200, { ok: true, total: next.length });
    } catch (error) {
      console.error('[inspiration:delete] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '删除失败，请稍后重试' });
    }
    return true;
  }

  // ======================================================================
  // 后台管理（/api/admin/inspiration/*）
  // ======================================================================

  // ---------- 读设置：分类清单 + 每个分类的作品数 ----------
  if (p === '/api/admin/inspiration/settings' && req.method === 'GET') {
    if (!needAdmin()) return true;
    try {
      const categories = await readCategories(KV);
      const items = await readItems(KV);
      sendJson(res, 200, {
        ok: true,
        categories,
        defaults: INSPIRATION_DEFAULT_CATEGORIES.map((item) => ({ ...item, enabled: true })),
        counts: countByCategory(items),
        totalItems: items.length,
        maxCategories: INSPIRATION_CATEGORY_MAX,
        maxItems: INSPIRATION_MAX_ITEMS,
        // 老数据可能挂着已删除分类，后台要能提示「有 N 件作品游离在未知分类」
        unknownCount: items.filter((item) => !categories.some((one) => one.id === item.category)).length,
      });
    } catch (error) {
      console.error('[inspiration:admin-settings-get] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '读取分类配置失败' });
    }
    return true;
  }

  // ---------- 写设置：整份替换分类清单（顺序即前端 chips 顺序）----------
  if (p === '/api/admin/inspiration/settings' && req.method === 'POST') {
    if (!needAdmin()) return true;
    try {
      const body = await readBody(req);
      const validated = normalizeCategoryList(body && body.categories);
      if (!validated.ok) {
        sendJson(res, 400, { ok: false, error: validated.error, code: 'INSPIRATION_CATEGORY_INVALID' });
        return true;
      }
      // 删掉的分类如果还挂着作品，先拦下来：否则那些作品会变成"永远筛不出来"的孤儿。
      const categories = validated.categories;
      const removed = (await readCategories(KV)).filter((item) => !categories.some((one) => one.id === item.id));
      if (removed.length) {
        const counts = countByCategory(await readItems(KV));
        const blocked = removed.filter((item) => (counts[item.id] || 0) > 0);
        if (blocked.length) {
          const detail = blocked.map((item) => `「${item.label}」${counts[item.id]} 件`).join('、');
          sendJson(res, 409, {
            ok: false,
            error: `${detail}作品还在该分类下，请先把它们移到其他分类再删除分类`,
            code: 'INSPIRATION_CATEGORY_IN_USE',
          });
          return true;
        }
      }
      await KV.kvPut(INSPIRATION_SETTINGS_KEY, { categories, updatedAt: new Date().toISOString() });
      const items = await readItems(KV);
      sendJson(res, 200, {
        ok: true,
        categories,
        counts: countByCategory(items),
        totalItems: items.length,
      });
    } catch (error) {
      console.error('[inspiration:admin-settings-save] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '保存分类配置失败' });
    }
    return true;
  }

  // ---------- 作品列表（后台版：含 userId / 点赞人）----------
  if (p === '/api/admin/inspiration/items' && req.method === 'GET') {
    if (!needAdmin()) return true;
    try {
      const items = await readItems(KV);
      const categories = await readCategories(KV);
      const wantedCategory = cleanText(u.searchParams.get('category'), 24) || 'all';
      const keyword = cleanText(u.searchParams.get('q'), 60).toLowerCase();
      const cursor = Math.max(0, Math.floor(Number(u.searchParams.get('cursor')) || 0));
      const askedLimit = Math.floor(Number(u.searchParams.get('limit')) || 0);
      const limit = Math.min(100, Math.max(1, askedLimit || 24));

      let filtered = items;
      if (wantedCategory === 'unknown') {
        // 分类已被删除的孤儿作品 —— 后台必须能找出来处理掉
        filtered = filtered.filter((item) => !categories.some((one) => one.id === item.category));
      } else if (wantedCategory !== 'all') {
        filtered = filtered.filter((item) => item.category === wantedCategory);
      }
      if (keyword) {
        const byPrompt = String(keyword);
        filtered = filtered.filter((item) => String(item.prompt || '').toLowerCase().includes(byPrompt)
          || String(item.userId || '').toLowerCase().includes(byPrompt));
      }

      const page = filtered.slice(cursor, cursor + limit);
      const nextCursor = cursor + page.length;
      sendJson(res, 200, {
        ok: true,
        items: page.map(toAdminItem),
        total: filtered.length,
        nextCursor,
        hasMore: nextCursor < filtered.length,
        categories,
      });
    } catch (error) {
      console.error('[inspiration:admin-items] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '读取作品列表失败' });
    }
    return true;
  }

  // ---------- 改单件作品（分类 / 提示词）----------
  if (p === '/api/admin/inspiration/update' && req.method === 'POST') {
    if (!needAdmin()) return true;
    try {
      const body = await readBody(req);
      const id = cleanText(body && body.id, 80);
      if (!id) { sendJson(res, 400, { ok: false, error: '缺少作品 id' }); return true; }
      const items = await readItems(KV);
      const index = items.findIndex((item) => String(item.id) === id);
      if (index < 0) { sendJson(res, 404, { ok: false, error: '作品不存在或已被删除' }); return true; }

      const patch = {};
      if (body && typeof body.category === 'string' && body.category.trim()) {
        const wanted = cleanText(body.category, 24);
        const categories = await readCategories(KV);
        if (!categories.some((item) => item.id === wanted)) {
          sendJson(res, 400, { ok: false, error: '目标分类不存在', code: 'INSPIRATION_CATEGORY_NOT_FOUND' });
          return true;
        }
        patch.category = wanted;
      }
      if (body && typeof body.prompt === 'string') {
        const prompt = cleanText(body.prompt, INSPIRATION_PROMPT_MAX);
        if (!prompt) { sendJson(res, 400, { ok: false, error: '提示词不能为空' }); return true; }
        patch.prompt = prompt;
      }
      if (!Object.keys(patch).length) {
        sendJson(res, 400, { ok: false, error: '没有要修改的内容' });
        return true;
      }
      const nextItem = { ...items[index], ...patch };
      const next = items.map((item, i) => (i === index ? nextItem : item));
      await KV.kvPut(INSPIRATION_KEY, next);
      sendJson(res, 200, { ok: true, item: toAdminItem(nextItem), total: next.length });
    } catch (error) {
      console.error('[inspiration:admin-update] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '修改失败，请稍后重试' });
    }
    return true;
  }

  // ---------- 批量删除（后台）----------
  if (p === '/api/admin/inspiration/delete' && req.method === 'POST') {
    if (!needAdmin()) return true;
    try {
      const body = await readBody(req);
      const ids = Array.isArray(body && body.ids)
        ? body.ids.map((one) => cleanText(one, 80)).filter(Boolean)
        : [cleanText(body && body.id, 80)].filter(Boolean);
      if (!ids.length) { sendJson(res, 400, { ok: false, error: '缺少作品 id' }); return true; }
      const wanted = new Set(ids);
      const items = await readItems(KV);
      const next = items.filter((item) => !wanted.has(String(item.id)));
      const removed = items.length - next.length;
      if (!removed) { sendJson(res, 404, { ok: false, error: '作品不存在或已被删除' }); return true; }
      await KV.kvPut(INSPIRATION_KEY, next);
      sendJson(res, 200, { ok: true, removed, total: next.length });
    } catch (error) {
      console.error('[inspiration:admin-delete] CRASH err=' + (error && (error.stack || error.message || error)));
      sendJson(res, 500, { ok: false, error: '删除失败，请稍后重试' });
    }
    return true;
  }

  // 路径以两套前缀开头但没命中：明确 404，避免被静态资源兜底吞掉
  sendJson(res, 404, { ok: false, error: '接口不存在' });
  return true;
}
