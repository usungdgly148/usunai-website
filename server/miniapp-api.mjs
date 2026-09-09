import crypto from 'node:crypto';
import {
  buildPayParams,
  createJsapiOrder,
  decryptNotifyResource,
  loadPayConfig,
  queryOrderByOutTradeNo,
  wechatPayConfigured,
} from './wechat-pay.mjs';
import { resolveMaxPlanValidity } from './plan-validity.mjs';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;
const MAX_RECORD_SCAN = 5000;

const AGENT_PUBLIC_FIELDS = [
  'id', 'kind', 'name', 'description', 'category', 'avatar', 'icon', 'iconColor',
  'desc', 'cardGradient', 'cardBg', 'gradientFrom', 'gradientTo', 'gradientAngle',
  'tags', 'tutorialImage', 'tutorialUrl', 'tutorialTitle',
  'published', 'sortOrder', 'views', 'uses', 'works', 'rating', 'vip', 'featured',
  'priceType', 'priceRate', 'opening', 'suggestedQuestions', 'assetCategory',
];

const WORKFLOW_PUBLIC_FIELDS = [
  'id', 'kind', 'name', 'description', 'category', 'avatar', 'icon', 'iconColor',
  'desc', 'cardGradient', 'cardBg', 'gradientFrom', 'gradientTo', 'gradientAngle',
  'tags', 'tutorialImage', 'tutorialUrl', 'tutorialTitle',
  'published', 'sortOrder', 'views', 'uses', 'works', 'rating', 'vip', 'featured',
  'priceType', 'priceRate', 'resultKind', 'formFields', 'outputFields', 'assetCategory',
];

const CATEGORY_PUBLIC_FIELDS = ['id', 'key', 'name', 'label', 'icon', 'color', 'miniappImage', 'miniappLink', 'sortOrder', 'published', 'groupId'];
const CATEGORY_GROUP_PUBLIC_FIELDS = ['id', 'key', 'name', 'label', 'sortOrder', 'published'];
const BANNER_PUBLIC_FIELDS = ['id', 'title', 'subtitle', 'image', 'imageUrl', 'link', 'linkUrl', 'sortOrder', 'published'];
const ANNOUNCEMENT_PUBLIC_FIELDS = ['id', 'version', 'title', 'content', 'type', 'link', 'linkUrl', 'startAt', 'endAt', 'publishedAt', 'createdAt', 'updatedAt', 'published'];

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

function toPublicContentItem(value, fields) {
  const item = pickPublic(value, fields);
  if (!item) return null;
  return {
    ...item,
    // Web cards store their public description in `desc`; keep the miniapp
    // contract consistent without exposing any connection credentials.
    description: String(item.description || item.desc || '').trim(),
  };
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
    .map((item) => {
      const publicItem = toPublicContentItem(item, AGENT_PUBLIC_FIELDS);
      return publicItem ? {
        ...publicItem,
        supportsImages: item.platform === 'deepseek-native' || item.supportsImages === true,
      } : null;
    })
    .filter(Boolean)
    .sort(bySortOrder);
  const workflows = asCollection(config.workflows)
    .filter((item) => item?.published === true)
    .map((item) => toPublicContentItem(item, WORKFLOW_PUBLIC_FIELDS))
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
      .sort((a, b) => String(b.publishedAt || b.updatedAt || b.createdAt || b.startAt || '').localeCompare(String(a.publishedAt || a.updatedAt || a.createdAt || a.startAt || '')))
      .map((item) => pickPublic(item, ANNOUNCEMENT_PUBLIC_FIELDS)).filter(Boolean),
    recommended: asCollection(config.recommended).map(String).filter((id) => publishedIds.has(id)),
    // 算力充值套餐（个人中心「算力充值」弹窗）：仅已上架、按 sortOrder；供展示，不含支付
    computePackages: asCollection(config.computePackages)
      .filter(isPublished)
      .sort(bySortOrder)
      .map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || ''),
        points: Number(item?.points) || 0,
        price: Number(item?.price) || 0,
        validDays: Number(item?.validDays) || 0,
        validFrom: item?.validFrom || null,
        sortOrder: Number(item?.sortOrder) || 0,
      }))
      .filter((item) => item.id && item.name),
    // 充值须知（多行文本，pre-line 展示）
    rechargeInfo: typeof config.rechargeInfo === 'string' ? config.rechargeInfo : '',
    // 联系客服（人工充值）：二维码相对路径由客户端拼 API_BASE，lines 为说明文案
    customerService: config.customerService && typeof config.customerService === 'object'
      ? {
          enabled: config.customerService.enabled !== false,
          qr: typeof config.customerService.qr === 'string'
            ? (/^(https?:\/\/|\/)/.test(config.customerService.qr) ? config.customerService.qr : '')
            : '',
          lines: Array.isArray(config.customerService.lines)
            ? config.customerService.lines.map(String).filter(Boolean).slice(0, 8)
            : [],
        }
      : { enabled: false, qr: '', lines: [] },
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

// 历史列表只返回轻量元数据：剥离消息全文/结果等大字段，正文走 /api/miniapp/v1/history/:id 详情。
const HISTORY_LIST_STRIP_KEYS = new Set(['messages', 'result', 'content', 'userPrompt', 'inputs', 'reasoning', 'usage', 'billingHistory']);
function stripHistoryForList(record) {
  if (!record || typeof record !== 'object') return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !HISTORY_LIST_STRIP_KEYS.has(key)));
}

function filterItems(items, searchParams) {
  // 小程序客户端用 category（分类 tab）与 keyword（搜索词）过滤；兼容网页端 type / q 的旧命名。
  const category = String(searchParams.get('category') || searchParams.get('type') || '').trim().toLowerCase();
  const query = String(searchParams.get('keyword') || searchParams.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (category && category !== 'task') {
      const raw = String(item.type || item.kind || item.category || '').toLowerCase();
      const match = raw === category || (category === 'copy' && raw === 'soft');
      if (!match) return false;
    }
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

async function updateProfile(req, res, requestId, session, deps) {
  const { KV, sanitizeId, getPlanValidity } = deps;
  const body = await deps.readBody(req);
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  const avatar = body && typeof body.avatar === 'string' ? body.avatar.trim() : '';
  const hasName = name !== '';
  const hasAvatar = avatar !== '';
  if (!hasName && !hasAvatar) {
    sendJson(res, 400, errorEnvelope('NOTHING_TO_UPDATE', '没有需要更新的内容', requestId), requestId);
    return;
  }
  if (hasName && (name.length < 1 || name.length > 40)) {
    sendJson(res, 400, errorEnvelope('INVALID_NAME', '昵称长度需在 1~40 字之间', requestId), requestId);
    return;
  }
  if (hasAvatar && !/^(data:image\/|https?:\/\/)/i.test(avatar)) {
    sendJson(res, 400, errorEnvelope('INVALID_AVATAR', '头像格式不正确', requestId), requestId);
    return;
  }
  // base64 头像上限 ~1MB（避免超大 data URL 撑爆 KV 记录）
  if (hasAvatar && avatar.length > 1200 * 1024) {
    sendJson(res, 400, errorEnvelope('AVATAR_TOO_LARGE', '头像图片过大，请压缩后重试', requestId), requestId);
    return;
  }
  const safeId = sanitizeId(String(session.userId || ''));
  const [reg, user] = await Promise.all([
    KV.kvGet('reg_' + safeId),
    KV.kvGet('user_' + safeId),
  ]);
  if (!reg && !user) {
    sendJson(res, 404, errorEnvelope('USER_NOT_FOUND', '用户不存在', requestId), requestId);
    return;
  }
  const nextReg = { ...(reg || {}), id: String(session.userId) };
  const nextUser = { ...(user || {}), id: String(session.userId) };
  if (hasName) { nextReg.name = name; nextUser.name = name; }
  if (hasAvatar) { nextReg.avatar = avatar; nextUser.avatar = avatar; }
  await Promise.all([KV.kvPut('reg_' + safeId, nextReg), KV.kvPut('user_' + safeId, nextUser)]);
  sendJson(res, 200, successEnvelope(safeUser(nextReg, nextUser, getPlanValidity), requestId), requestId);
}

async function changePassword(req, res, requestId, session, deps) {
  const { KV, sanitizeId, hashPassword, verifyPassword } = deps;
  const body = await deps.readBody(req);
  const oldPassword = String((body && body.oldPassword) || '');
  const newPassword = String((body && body.newPassword) || '');
  if (!newPassword || newPassword.length < 6) {
    sendJson(res, 400, errorEnvelope('PASSWORD_TOO_SHORT', '新密码至少 6 位', requestId), requestId);
    return;
  }
  const safeId = sanitizeId(String(session.userId || ''));
  const reg = await KV.kvGet('reg_' + safeId);
  if (!reg || !reg.password) {
    sendJson(res, 400, errorEnvelope('PASSWORD_NOT_SET', '该账号未设置登录密码（微信登录），暂不支持修改', requestId), requestId);
    return;
  }
  if (!verifyPassword(oldPassword, reg.password)) {
    sendJson(res, 401, errorEnvelope('OLD_PASSWORD_WRONG', '原密码错误', requestId), requestId);
    return;
  }
  const updated = { ...reg, password: hashPassword(newPassword) };
  await KV.kvPut('reg_' + safeId, updated);
  const user = await KV.kvGet('user_' + safeId);
  if (user) await KV.kvPut('user_' + safeId, { ...user, hasPassword: true });
  sendJson(res, 200, successEnvelope({ ok: true }, requestId), requestId);
}

// ============ 算力充值：微信在线支付 ============

// 创建充值订单并调起微信支付（JSAPI 下单）。
async function createRechargeOrder(req, res, requestId, session, deps) {
  const { KV, sanitizeId } = deps;
  await loadPayConfig(KV);
  if (!wechatPayConfigured()) {
    sendJson(res, 503, errorEnvelope('WECHAT_PAY_NOT_CONFIGURED', '微信支付尚未配置，请稍后再试', requestId), requestId);
    return;
  }
  const body = await deps.readBody(req);
  const packageId = sanitizeId(String(body && body.packageId));
  if (!packageId) {
    sendJson(res, 400, errorEnvelope('INVALID_PACKAGE', '请选择充值套餐', requestId), requestId);
    return;
  }
  const packages = await KV.kvGet('computePackages');
  const pkg = (Array.isArray(packages) ? packages : []).find(
    (item) => item && String(item.id) === packageId && item.published !== false,
  );
  if (!pkg) {
    sendJson(res, 400, errorEnvelope('PACKAGE_NOT_FOUND', '套餐不存在或已下架', requestId), requestId);
    return;
  }
  const points = Number(pkg.points);
  const price = Number(pkg.price);
  if (!Number.isFinite(points) || points <= 0 || !Number.isFinite(price) || price <= 0) {
    sendJson(res, 400, errorEnvelope('INVALID_PACKAGE', '套餐配置无效，请稍后再试', requestId), requestId);
    return;
  }
  const identity = await KV.kvGet(session.identityKey);
  const openid = identity && identity.openid ? String(identity.openid) : '';
  if (!openid) {
    sendJson(res, 403, errorEnvelope('OPENID_MISSING', '缺少微信身份信息，请重新登录后重试', requestId), requestId);
    return;
  }
  const outTradeNo = 'p' + Date.now() + crypto.randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  const userId = String(session.userId || '');
  const orderRecord = {
    id: outTradeNo,
    userId: sanitizeId(userId),
    type: 'compute',
    action: `在线充值（${pkg.name || ''}）`,
    name: pkg.name || `充值 ${points} 点`,
    amount: price,
    status: 'pending',
    createdAt: now,
    meta: {
      packageId: pkg.id,
      packageName: pkg.name,
      points,
      price,
      validDays: Object.prototype.hasOwnProperty.call(pkg, 'validDays') ? Number(pkg.validDays) : undefined,
      validFrom: pkg.validFrom || undefined,
    },
  };
  await KV.kvPut('order_' + sanitizeId(outTradeNo), orderRecord);
  let prepayId;
  try {
    prepayId = await createJsapiOrder({
      openid,
      outTradeNo,
      description: pkg.name ? `友尚AI算力充值-${pkg.name}` : '友尚AI算力充值',
      amountCents: Math.round(price * 100),
    });
  } catch (error) {
    console.error('[recharge] createJsapiOrder 失败:', {
      code: error?.code,
      message: error?.message,
      status: error?.status,
      detail: error?.detail,
    });
    sendJson(res, 502, errorEnvelope(error.code || 'WECHAT_PAY_ORDER_FAILED', error.message || '微信支付下单失败', requestId), requestId);
    return;
  }
  sendJson(res, 200, successEnvelope({ orderId: outTradeNo, payParams: buildPayParams(prepayId) }, requestId), requestId);
}

// 微信支付结果通知回调（无登录态，由微信服务器直连）。
async function handleRechargeNotify(req, res, requestId, deps) {
  const { KV, sanitizeId } = deps;
  const reply = (status, code, message) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ code, message }));
  };
  await loadPayConfig(KV);
  if (!wechatPayConfigured()) {
    reply(503, 'FAIL', 'wechat pay not configured');
    return;
  }
  let payload;
  try {
    payload = await deps.readBody(req);
  } catch {
    reply(400, 'FAIL', 'invalid body');
    return;
  }
  let tx;
  try {
    tx = decryptNotifyResource(payload && payload.resource);
  } catch (error) {
    // 解密失败：密钥不符或报文被篡改，忽略并让微信按失败重试策略处理。
    console.error('[recharge] notify 解密失败:', error?.message || error);
    reply(400, 'FAIL', 'decrypt failed');
    return;
  }
  const outTradeNo = String(tx.out_trade_no || '');
  if (!outTradeNo) {
    reply(400, 'FAIL', 'missing out_trade_no');
    return;
  }
  // 主动查单二次确认（商户私钥签名，微信权威交易状态）。
  let confirmed;
  try {
    confirmed = await queryOrderByOutTradeNo(outTradeNo);
  } catch {
    reply(502, 'FAIL', 'query failed');
    return;
  }
  if (!confirmed || String(confirmed.trade_state) !== 'SUCCESS') {
    // 未支付 / 处理中：返回 FAIL 让微信稍后重试，直到支付成功或超过重试窗口。
    reply(200, 'FAIL', `trade_state=${confirmed && confirmed.trade_state}`);
    return;
  }
  const order = await KV.kvGet('order_' + sanitizeId(outTradeNo));
  if (!order) {
    reply(200, 'SUCCESS', 'order not found');
    return;
  }
  const userId = String(order.userId || '');
  const points = Number(order.meta && order.meta.points);
  if (!userId || !Number.isFinite(points) || points <= 0) {
    reply(200, 'FAIL', 'invalid order');
    return;
  }
  const now = new Date().toISOString();
  const packageName = order.meta && order.meta.packageName ? String(order.meta.packageName) : '';
  const validDays = order.meta && Object.prototype.hasOwnProperty.call(order.meta, 'validDays') ? Number(order.meta.validDays) : 0;
  const validFrom = order.meta && order.meta.validFrom ? String(order.meta.validFrom) : '';
  // 有效期处理：与后台手动充值同规则（不叠加时长，永久优先）。
  const userPatch = {};
  const existingUser = await KV.kvGet('user_' + sanitizeId(userId));
  if (Number.isFinite(validDays) && validDays > 0) {
    const resolved = resolveMaxPlanValidity(existingUser, {
      validFrom,
      validDays,
      fallbackStart: now.slice(0, 10),
    });
    userPatch.planValidFrom = resolved.planValidFrom;
    userPatch.planValidDays = resolved.planValidDays;
    if (resolved.winner === 'incoming' && resolved.planValidFrom) {
      const days = Number(resolved.planValidDays);
      const startMs = new Date(resolved.planValidFrom).getTime();
      const expireAt = days === 0
        ? '长期有效'
        : Number.isFinite(startMs) && days > 0
          ? new Date(startMs + days * 86400000).toISOString().slice(0, 10)
          : '';
      if (expireAt) userPatch.membership = { plan: packageName, expireAt };
    }
  }
  const transactionId = String(confirmed.transaction_id || '');
  const computeRecord = {
    id: outTradeNo,
    userId: sanitizeId(userId),
    type: 'recharge',
    amount: points,
    reason: packageName ? `微信支付购买「${packageName}」` : '微信支付充值',
    title: packageName || '微信支付充值',
    createdAt: now,
    meta: {
      payment: 'wechat',
      packageId: order.meta && order.meta.packageId,
      packageName,
      outTradeNo,
      transactionId,
      validDays,
      validFrom,
    },
  };
  const paidOrder = {
    ...order,
    status: 'paid',
    action: packageName ? `在线充值（${packageName}）` : '在线充值',
    meta: { ...(order.meta || {}), transactionId, paidAt: now },
  };
  const result = await KV.kvAdminAdjustPoints({
    userId,
    amount: points,
    userPatch,
    computeRecord,
    orderRecord: paidOrder,
    requestId: outTradeNo,
  });
  if (!result.ok && result.reason !== 'duplicate') {
    reply(500, 'FAIL', result.reason || 'adjust failed');
    return;
  }
  reply(200, 'SUCCESS', 'ok');
}

export async function handleMiniappApi(req, res, url, deps) {
  const path = url.pathname;
  if (!path.startsWith('/api/miniapp/v1/')) return false;
  const requestId = requestIdFor(req);
  const { KV, getSession, isAdminSession, getPlanValidity, sanitizeId } = deps;

  try {

  if (req.method === 'POST' && (path === '/api/miniapp/v1/profile' || path === '/api/miniapp/v1/password')) {
    const session = userSession(req, res, requestId, { getSession, isAdminSession });
    if (!session) return true;
    if (path === '/api/miniapp/v1/profile') await updateProfile(req, res, requestId, session, deps);
    else await changePassword(req, res, requestId, session, deps);
    return true;
  }

  if (req.method === 'POST' && path === '/api/miniapp/v1/recharge/order') {
    const session = userSession(req, res, requestId, { getSession, isAdminSession });
    if (!session) return true;
    await createRechargeOrder(req, res, requestId, session, deps);
    return true;
  }

  if (req.method === 'POST' && path === '/api/miniapp/v1/recharge/notify') {
    await handleRechargeNotify(req, res, requestId, deps);
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', '该接口不支持当前请求方法', requestId), requestId);
    return true;
  }

  if (path === '/api/miniapp/v1/health') {
    sendJson(res, 200, successEnvelope({ status: 'ok', apiVersion: 'v1' }, requestId), requestId, 'public, max-age=30');
    return true;
  }

  if (path === '/api/miniapp/v1/content') {
    const keys = ['agents', 'workflows', 'categories', 'categoryGroups', 'banners', 'announcements', 'recommended', 'computePackages', 'rechargeInfo', 'customerService'];
    const values = await Promise.all(keys.map((key) => KV.kvGet(key)));
    const config = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    sendJson(res, 200, successEnvelope(sanitizePublicContent(config), requestId), requestId, 'public, max-age=30');
    return true;
  }

  const session = userSession(req, res, requestId, { getSession, isAdminSession });
  if (!session) return true;
  const userId = String(session.userId || '');
  const safeId = sanitizeId(userId);

  if (path === '/api/miniapp/v1/recharge/status') {
    const orderId = sanitizeId(String(url.searchParams.get('orderId') || ''));
    if (!orderId) {
      sendJson(res, 400, errorEnvelope('INVALID_ORDER', '缺少订单号', requestId), requestId);
      return true;
    }
    const order = await KV.kvGet('order_' + orderId);
    if (!order || String(order.userId || '') !== safeId) {
      sendJson(res, 404, errorEnvelope('NOT_FOUND', '订单不存在', requestId), requestId);
      return true;
    }
    sendJson(res, 200, successEnvelope({
      orderId: order.id,
      status: order.status,
      points: order.meta && order.meta.points,
      amount: order.amount,
      name: order.name,
    }, requestId), requestId);
    return true;
  }

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
    // 历史列表只返回轻量元数据（标题/时间/归属 id），正文消息/结果等大字段走详情接口，避免列表一次性传输全量内容。
    items = (await loadUserRecords(KV, 'hist_', userId)).map(stripHistoryForList);
  }

  if (items) {
    const page = paginate(filterItems(items, url.searchParams), parsePagination(url.searchParams));
    sendJson(res, 200, successEnvelope(page.items, requestId, page.pagination), requestId);
    return true;
  }

  // 历史详情：点击某条记录时才拉取该条完整内容（消息/结果），列表阶段不传输大字段。
  const historyDetailMatch = path.match(/^\/api\/miniapp\/v1\/history\/([^/]+)$/);
  if (historyDetailMatch) {
    let historyId = historyDetailMatch[1];
    try { historyId = decodeURIComponent(historyId); } catch { /* 保留原始值 */ }
    const record = await KV.kvGet('hist_' + sanitizeId(historyId));
    if (!record || String(record.userId || '') !== userId) {
      sendJson(res, 404, errorEnvelope('NOT_FOUND', '历史记录不存在', requestId), requestId);
      return true;
    }
    sendJson(res, 200, successEnvelope(record, requestId), requestId);
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
