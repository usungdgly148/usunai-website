// 灵感广场（AI全能设计）—— 用户主动发布的生成结果作品墙。
//
// 为什么单独一个模块：index.mjs 已经近 6000 行，这类「自成一套的小功能」再往里塞
// 会让路由表更难读。约定与 miniapp-*.mjs 一致：导出 handleInspiration(req,res,u,deps)，
// 命中返回 true，未命中返回 false，由 index.mjs 继续往下走。
//
// 存储：**单个 KV 键** `inspirationPlaza` 存一个新→旧的数组。
//   · 为什么不按条分键：广场要「按时间倒序 + 分类筛选 + 提示词搜索 + 游标分页」，
//     单键数组一次读出来就能全部完成；分键还得额外维护一套索引，得不偿失。
//   · 代价是每次列表都整份读一次。所以加了硬上限 INSPIRATION_MAX_ITEMS 条（超出丢最旧），
//     300 条 × ~350 字节 ≈ 100KB 量级，可以接受。
// ⚠️ 这里**不存用户身份**给前端展示：作品墙只需要图 + 提示词 + 点赞数（参考设计就是如此），
//    少存一份昵称/头像就少一份泄露面。只用 userId 做「是否本人」判断。
import crypto from 'node:crypto';

export const INSPIRATION_KEY = 'inspirationPlaza';
export const INSPIRATION_MAX_ITEMS = 300;
export const INSPIRATION_PAGE_MAX = 40;
export const INSPIRATION_PAGE_DEFAULT = 20;
export const INSPIRATION_PROMPT_MAX = 2000;

// 与前端 chips 一一对应。`all` 只用于筛选，不可作为发布分类。
export const INSPIRATION_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'ecommerce', label: '电商营销' },
  { id: 'festival', label: '热点节日' },
  { id: 'season', label: '时令节气' },
  { id: 'poster', label: '海报设计' },
  { id: 'ui', label: 'UI设计' },
];

const PUBLISH_CATEGORIES = INSPIRATION_CATEGORIES
  .filter((item) => item.id !== 'all')
  .map((item) => item.id);

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

/**
 * 路由入口。deps 由 index.mjs 传入，保持与其它 handle* 一致的形状。
 * @returns {Promise<boolean>} 是否已处理（true = 已响应，调用方直接 return）
 */
export async function handleInspiration(req, res, u, deps) {
  const { KV, readBody, requireUser, getSession, isAdminSession } = deps;
  const p = u.pathname;
  if (!p.startsWith('/api/inspiration/')) return false;

  // ---------- 列表：公开可读（未登录也能逛，只是拿不到 liked 状态）----------
  if (p === '/api/inspiration/list' && req.method === 'GET') {
    try {
      const session = getSession(req);
      const items = await readItems(KV);
      const wantedCategory = cleanText(u.searchParams.get('category'), 24) || 'all';
      const category = INSPIRATION_CATEGORIES.some((item) => item.id === wantedCategory) ? wantedCategory : 'all';
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
        categories: INSPIRATION_CATEGORIES,
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
      const askedCategory = cleanText(body && body.category, 24);
      const category = PUBLISH_CATEGORIES.includes(askedCategory) ? askedCategory : 'poster';
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

  // 路径以 /api/inspiration/ 开头但没命中：明确 404，避免被静态资源兜底吞掉
  sendJson(res, 404, { ok: false, error: '接口不存在' });
  return true;
}
