import crypto from 'node:crypto';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;
const MAX_RECORD_SCAN = 5000;

const AGENT_PUBLIC_FIELDS = [
  'id', 'kind', 'name', 'description', 'category', 'avatar', 'icon', 'iconColor',
  'cardGradient', 'cardBg', 'tags', 'tutorialImage', 'tutorialUrl', 'tutorialTitle',
  'published', 'sortOrder', 'views', 'uses', 'works', 'rating', 'vip', 'featured',
  'priceType', 'priceRate', 'opening', 'suggestedQuestions', 'assetCategory',
];

const WORKFLOW_PUBLIC_FIELDS = [
  'id', 'kind', 'name', 'description', 'category', 'avatar', 'icon', 'iconColor',
  'cardGradient', 'cardBg', 'tags', 'tutorialImage', 'tutorialUrl', 'tutorialTitle',
  'published', 'sortOrder', 'views', 'uses', 'works', 'rating', 'vip', 'featured',
  'priceType', 'priceRate', 'resultKind', 'formFields', 'outputFields', 'assetCategory',
];

const CATEGORY_PUBLIC_FIELDS = ['id', 'key', 'name', 'label', 'icon', 'color', 'sortOrder', 'published', 'groupId'];
const CATEGORY_GROUP_PUBLIC_FIELDS = ['id', 'key', 'name', 'label', 'sortOrder', 'published'];
const BANNER_PUBLIC_FIELDS = ['id', 'title', 'subtitle', 'image', 'imageUrl', 'link', 'linkUrl', 'sortOrder', 'published'];
const ANNOUNCEMENT_PUBLIC_FIELDS = ['id', 'title', 'content', 'type', 'link', 'linkUrl', 'startAt', 'endAt', 'published'];

const NESTED_BLOCKED_FIELDS = new Set([
  'apikey', 'apikeyencrypted', 'privatekey', 'clientsecret', 'password', 'token',
  'accesstoken', 'refreshtoken', 'authorization', 'authproviderid', 'systemprompt',
  'baseurl', 'projectid', 'botid', 'workflowid', 'workspaceid',
]);

function cleanNested(value) {
  if (Array.isArray(value)) return value.map(cleanNested);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !NESTED_BLOCKED_FIELDS.has(String(key).toLowerCase()))
    .map(([key, item]) => [key, cleanNested(item)]));
}

function pickPublic(value, fields) {
  if (!value || typeof value !== 'object') return null;
  const allowed = new Set(fields);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => allowed.has(key))
    .map(([key, item]) => [key, cleanNested(item)]));
}

function asCollection(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function isPublished(value) {
  return value && value.published !== false;
}

function bySortOrder(a, b) {
  return (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0);
}

export function sanitizePublicContent(config = {}) {
  const agents = asCollection(config.agents)
    .filter((item) => item?.published === true)
    .map((item) => ({
      ...pickPublic(item, AGENT_PUBLIC_FIELDS),
      supportsImages: item.platform === 'deepseek-native' || item.supportsImages === true,
    }))
    .filter(Boolean)
    .sort(bySortOrder);
  const workflows = asCollection(config.workflows)
    .filter((item) => item?.published === true)
    .map((item) => pickPublic(item, WORKFLOW_PUBLIC_FIELDS))
    .filter(Boolean)
    .sort(bySortOrder);
  const publishedIds = new Set([...agents, ...workflows].map((item) => String(item.id)));
  return {
    agents,
    workflows,
    categories: asCollection(config.categories).filter(isPublished)
      .map((item) => pickPublic(item, CATEGORY_PUBLIC_FIELDS)).filter(Boolean).sort(bySortOrder),
    categoryGroups: asCollection(config.categoryGroups).filter(isPublished)
      .map((item) => pickPublic(item, CATEGORY_GROUP_PUBLIC_FIELDS)).filter(Boolean).sort(bySortOrder),
    banners: asCollection(config.banners).filter(isPublished)
      .map((item) => pickPublic(item, BANNER_PUBLIC_FIELDS)).filter(Boolean).sort(bySortOrder),
    announcements: asCollection(config.announcements).filter(isPublished)
      .map((item) => pickPublic(item, ANNOUNCEMENT_PUBLIC_FIELDS)).filter(Boolean),
    recommended: asCollection(config.recommended).map(String).filter((id) => publishedIds.has(id)),
  };
}

export function parsePagination(searchParams) {
  const rawPage = Number(searchParams?.get?.('page'));
  const rawPageSize = Number(searchParams?.get?.('pageSize'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0
    ? Math.min(rawPageSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize };
}

export function paginate(items, { page, pageSize }) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}

export function successEnvelope(data, requestId, meta = {}) {
  return { ok: true, data, meta: { requestId, timestamp: new Date().toISOString(), ...meta } };
}

export function errorEnvelope(code, message, requestId) {
  return { ok: false, error: { code, message }, meta: { requestId, timestamp: new Date().toISOString() } };
}

export function requestIdFor(req) {
  const supplied = String(req.headers?.['x-request-id'] || '').trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export function sendJson(res, statusCode, payload, requestId, cacheControl = 'no-store') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Request-Id', requestId);
  res.end(JSON.stringify(payload));
}

export function safeUser(reg, user, getPlanValidity) {
  const merged = { ...(reg || {}), ...(user || {}) };
  delete merged.password;
  const validity = getPlanValidity(merged);
  return {
    id: merged.id,
    name: merged.name || merged.nickname || '',
    nickname: merged.nickname || merged.name || '',
    avatar: merged.avatar || '',
    email: merged.email || '',
    phone: merged.phone || '',
    provider: merged.provider || '',
    status: merged.status || 'active',
    points: Math.max(0, Number(merged.points) || 0),
    balance: Math.max(0, Number(merged.balance) || 0),
    planValidFrom: merged.planValidFrom || null,
    planValidDays: Number.isFinite(Number(merged.planValidDays)) ? Number(merged.planValidDays) : null,
    validTo: validity.validTo,
    expired: validity.expired,
    hasPassword: !!(merged.hasPassword || reg?.password),
  };
}

function timestampOf(item) {
  return Date.parse(item?.updatedAt || item?.createdAt || item?.time || item?.timestamp || '') || Number(item?.createdAt) || 0;
}

async function loadUserRecords(KV, prefix, userId) {
  const keys = await KV.kvList(prefix, MAX_RECORD_SCAN);
  const rows = await Promise.all(keys.map((key) => KV.kvGet(key)));
  return rows.filter((item) => item && String(item.userId || '') === String(userId)).sort((a, b) => timestampOf(b) - timestampOf(a));
}

function filterItems(items, searchParams) {
  const type = String(searchParams.get('type') || '').trim().toLowerCase();
  const query = String(searchParams.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (type && String(item.type || item.kind || item.category || '').toLowerCase() !== type) return false;
    if (!query) return true;
    return JSON.stringify(item).toLowerCase().includes(query);
  });
}

function userSession(req, res, requestId, { getSession, isAdminSession }) {
  const session = getSession(req);
  if (!session || isAdminSession(session)) {
    sendJson(res, session ? 403 : 401, errorEnvelope('USER_AUTH_REQUIRED', '需要用户登录', requestId), requestId);
    return null;
  }
  if (session.client !== 'miniapp' || !session.identityKey) {
    sendJson(res, 403, errorEnvelope('MINIAPP_SESSION_REQUIRED', '需要小程序登录状态', requestId), requestId);
    return null;
  }
  return session;
}

export async function handleMiniappApi(req, res, url, deps) {
  const path = url.pathname;
  if (!path.startsWith('/api/miniapp/v1/')) return false;
  const requestId = requestIdFor(req);
  const { KV, getSession, isAdminSession, getPlanValidity, sanitizeId } = deps;

  try {

  if (req.method !== 'GET') {
    sendJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', '该接口不支持当前请求方法', requestId), requestId);
    return true;
  }

  if (path === '/api/miniapp/v1/health') {
    sendJson(res, 200, successEnvelope({ status: 'ok', apiVersion: 'v1' }, requestId), requestId, 'public, max-age=30');
    return true;
  }

  if (path === '/api/miniapp/v1/content') {
    const keys = ['agents', 'workflows', 'categories', 'categoryGroups', 'banners', 'announcements', 'recommended'];
    const values = await Promise.all(keys.map((key) => KV.kvGet(key)));
    const config = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    sendJson(res, 200, successEnvelope(sanitizePublicContent(config), requestId), requestId, 'public, max-age=30');
    return true;
  }

  const session = userSession(req, res, requestId, { getSession, isAdminSession });
  if (!session) return true;
  const userId = String(session.userId || '');
  const safeId = sanitizeId(userId);

  if (path === '/api/miniapp/v1/me') {
    const [reg, user] = await Promise.all([KV.kvGet('reg_' + safeId), KV.kvGet('user_' + safeId)]);
    if (!reg && !user) {
      sendJson(res, 404, errorEnvelope('USER_NOT_FOUND', '用户不存在', requestId), requestId);
      return true;
    }
    sendJson(res, 200, successEnvelope(safeUser(reg, user, getPlanValidity), requestId), requestId);
    return true;
  }

  let items = null;
  if (path === '/api/miniapp/v1/assets') {
    const stored = await KV.kvGet('assets_' + safeId);
    items = Array.isArray(stored) ? stored.slice().sort((a, b) => timestampOf(b) - timestampOf(a)) : [];
  } else if (path === '/api/miniapp/v1/compute-records') {
    items = await loadUserRecords(KV, 'compute_', userId);
  } else if (path === '/api/miniapp/v1/orders') {
    items = await loadUserRecords(KV, 'order_', userId);
  } else if (path === '/api/miniapp/v1/history') {
    items = await loadUserRecords(KV, 'hist_', userId);
  }

  if (items) {
    const page = paginate(filterItems(items, url.searchParams), parsePagination(url.searchParams));
    sendJson(res, 200, successEnvelope(page.items, requestId, page.pagination), requestId);
    return true;
  }

    sendJson(res, 404, errorEnvelope('NOT_FOUND', '接口不存在', requestId), requestId);
    return true;
  } catch (error) {
    if (!res.writableEnded) {
      sendJson(res, 500, errorEnvelope('INTERNAL_ERROR', '服务暂时不可用', requestId), requestId);
    }
    return true;
  }
}
