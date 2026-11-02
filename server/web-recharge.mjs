// 网页端算力充值：微信扫码支付（Native 支付）。
//
// 与小程序端的关系：
//   · 小程序端走「虚拟支付（xpay 道具直购）」，需要 openid + sessionKey + 后台道具 ID，仅小程序可用；
//   · 网页端没有 openid（用户是在微信里**扫码**后完成身份绑定的），只能走 Native 支付拿 code_url 画二维码。
//   两条通道**共用同一套发货实现**（miniapp-api.mjs 的 deliverRechargeOrder）与同一套套餐/试用/有效期规则
//   （plan-access.mjs），这里只负责下单、查单、通知三件事，绝不另写一套加算力逻辑。
//
// 到账链路（三重保险，任一成功即可到账，且天然幂等）：
//   ① 微信支付通知 POST /api/recharge/notify —— 主链路；
//   ② 前端轮询 GET /api/recharge/status —— 用户留在页面上时即时到账；
//   ③ 服务端定时对账 reconcilePendingNativeOrders —— 用户付完就关页面/断网时的兜底。
// 三者最终都落到 deliverRechargeOrder，requestId = outTradeNo，重复调用只会命中 duplicate。

import crypto from 'node:crypto';
import {
  PHONE_BIND_REQUIRED_CODE,
  TRIAL_ALREADY_PURCHASED_CODE,
  TRIAL_ALREADY_PURCHASED_MESSAGE,
  hasPhoneBound,
  hasUsedTrial,
  isTrialPackage,
  phoneBindRequiredMessage,
} from './plan-access.mjs';
import {
  closeOrderByOutTradeNo,
  createNativeOrder,
  decryptNotifyResource,
  loadPayConfig,
  queryOrderByOutTradeNo,
  wechatPayConfigured,
} from './wechat-pay.mjs';
import { deliverRechargeOrder } from './miniapp-api.mjs';

// 支付结果通知地址：必须能被微信服务器公网访问，且绝不能与小程序的虚拟支付推送地址混用。
export const WEB_RECHARGE_NOTIFY_URL = String(
  process.env.WECHAT_PAY_WEB_NOTIFY_URL || 'https://usunai.top/api/recharge/notify',
).trim();

// 二维码有效期：15 分钟。与前端倒计时、time_expire 三者必须同源，改这里即可。
export const WEB_RECHARGE_TTL_MS = 15 * 60 * 1000;

// 定时对账只扫最近 24 小时的订单（与小程序侧口径一致），避免全量读 KV。
const NATIVE_RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// RFC3339（北京时间）：微信要求 yyyy-MM-DDTHH:mm:ss+TIMEZONE，不接受毫秒。
function rfc3339Cst(ms) {
  const d = new Date(Number(ms) + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

const orderKey = (sanitizeId, orderId) => 'order_' + sanitizeId(String(orderId || ''));

// 订单对外视图：只暴露前端要用的字段，不泄露 code_url / openid 等。
function publicOrder(order) {
  const meta = (order && order.meta) || {};
  const expiresMs = Number(meta.expiresAtMs) || 0;
  return {
    orderId: String(order.id || ''),
    status: String(order.status || 'pending'),
    packageId: meta.packageId || '',
    packageName: String(meta.packageName || ''),
    points: Number(meta.points) || 0,
    amount: Number(meta.price) || 0,
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : '',
    paidAt: meta.paidAt || '',
    closedReason: order.closedReason || '',
  };
}

// 把本地订单标记为关闭。仅用于「确实未支付」的场景。
async function markClosed({ KV, sanitizeId, order }) {
  const key = orderKey(sanitizeId, order.id);
  const next = {
    ...order,
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedReason: 'unpaid_timeout',
    closedBy: 'system',
  };
  await KV.kvPut(key, next);
  return next;
}

/**
 * 查单 → 需要时发货。状态接口、支付通知、定时对账三处共用。
 *
 * @returns {{ order: object, changed: boolean }}
 *   order 是**最新**订单记录（可能已被标记为 paid / closed）。
 */
async function syncOrder({ KV, sanitizeId, order }) {
  const outTradeNo = String(order.id || '');
  if (String(order.status) === 'paid') return { order, changed: false };

  let remote;
  try {
    remote = await queryOrderByOutTradeNo(outTradeNo);
  } catch (error) {
    // 查不到 ≠ 失败：网络抖动/限流时保持 pending，让下一轮或前端下一次轮询再试。
    console.error('[web-recharge] 查单失败:', outTradeNo, error?.code, error?.message || error);
    return { order, changed: false };
  }
  const tradeState = String((remote && remote.trade_state) || '');

  if (tradeState === 'SUCCESS') {
    const delivered = await deliverRechargeOrder({
      KV,
      sanitizeId,
      order,
      payment: 'wechat_native',
      transactionId: String(remote.transaction_id || ''),
      wxOrderId: String(remote.transaction_id || ''),
    });
    if (!delivered.ok && delivered.reason !== 'already_paid') {
      console.error('[web-recharge] 发货失败:', outTradeNo, delivered.reason);
      return { order, changed: false };
    }
    const latest = (await KV.kvGet(orderKey(sanitizeId, outTradeNo))) || order;
    return { order: latest, changed: true };
  }

  // CLOSED / REVOKED / PAYERROR：微信侧已经结束且未成单，直接落库关闭，不必再等。
  if (tradeState === 'CLOSED' || tradeState === 'REVOKED' || tradeState === 'PAYERROR') {
    return { order: await markClosed({ KV, sanitizeId, order }), changed: true };
  }

  // NOTPAY / USERPAYING：用户还没付（或正在付）。只有**超过我们自己的有效期**才关单。
  const expiresMs = Number(order.meta && order.meta.expiresAtMs) || 0;
  if (expiresMs && Date.now() > expiresMs) {
    try {
      await closeOrderByOutTradeNo(outTradeNo);
    } catch (error) {
      // 关单失败最常见的原因是「其实已经付了」——再查一次，付了就按成功处理。
      console.warn('[web-recharge] 关单失败，复查一次:', outTradeNo, error?.code, error?.message || error);
      try {
        const again = await queryOrderByOutTradeNo(outTradeNo);
        if (again && String(again.trade_state) === 'SUCCESS') return syncOrder({ KV, sanitizeId, order });
      } catch { /* 保持 pending，交给下一轮 */ }
      return { order, changed: false };
    }
    return { order: await markClosed({ KV, sanitizeId, order }), changed: true };
  }

  return { order, changed: false };
}

// ============ POST /api/recharge/order ============
async function createOrder(req, res, session, deps) {
  const { KV, sanitizeId, readBody } = deps;
  if (!session) {
    sendJson(res, 401, { ok: false, code: 'NOT_LOGGED_IN', msg: '请先登录后再充值' });
    return;
  }
  // 手机号门禁：与小程序端同一条规则（充值属付费入口）。判据只看 reg_.phone。
  const reg = await KV.kvGet('reg_' + sanitizeId(String(session.userId || '')));
  if (!hasPhoneBound(reg)) {
    sendJson(res, 403, { ok: false, code: PHONE_BIND_REQUIRED_CODE, msg: phoneBindRequiredMessage() });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, code: 'INVALID_BODY', msg: '请求格式错误' });
    return;
  }
  const packageId = sanitizeId(String((body && body.packageId) || ''));
  if (!packageId) {
    sendJson(res, 400, { ok: false, code: 'INVALID_PACKAGE', msg: '请选择充值套餐' });
    return;
  }
  const packages = await KV.kvGet('computePackages');
  const pkg = (Array.isArray(packages) ? packages : []).find(
    (item) => item && String(item.id) === packageId && item.published !== false,
  );
  if (!pkg) {
    sendJson(res, 400, { ok: false, code: 'PACKAGE_NOT_FOUND', msg: '套餐不存在或已下架' });
    return;
  }
  const points = Number(pkg.points);
  const price = Number(pkg.price);
  if (!Number.isFinite(points) || points <= 0 || !Number.isFinite(price) || price <= 0) {
    sendJson(res, 400, { ok: false, code: 'INVALID_PACKAGE', msg: '套餐配置无效，请稍后再试' });
    return;
  }
  // 「免费试用」每用户限购一次：前端只是提前禁用卡片，服务端这道闸门才作数。
  if (isTrialPackage(pkg)) {
    const existingUser = await KV.kvGet('user_' + sanitizeId(String(session.userId || '')));
    if (hasUsedTrial(existingUser)) {
      sendJson(res, 409, { ok: false, code: TRIAL_ALREADY_PURCHASED_CODE, msg: TRIAL_ALREADY_PURCHASED_MESSAGE });
      return;
    }
  }

  await loadPayConfig(KV);
  if (!wechatPayConfigured()) {
    sendJson(res, 503, { ok: false, code: 'WECHAT_PAY_NOT_CONFIGURED', msg: '在线支付尚未开通，请稍后再试' });
    return;
  }

  // outTradeNo 规则与小程序侧一致：p + 13 位毫秒时间戳 + 12 位随机 hex（26 位，8-32 位合法）。
  const outTradeNo = 'p' + Date.now() + crypto.randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  const expiresAtMs = Date.now() + WEB_RECHARGE_TTL_MS;
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
    source: 'web',
    meta: {
      payment: 'wechat_native',
      channel: 'web',
      packageId: pkg.id,
      packageName: pkg.name,
      points,
      price,
      expiresAtMs,
      validDays: Object.prototype.hasOwnProperty.call(pkg, 'validDays') ? Number(pkg.validDays) : undefined,
      validFrom: pkg.validFrom || undefined,
      // 下单即固化「是不是试用套餐」：发货时套餐可能已被后台改动。
      trial: isTrialPackage(pkg),
    },
  };
  // 先落库再下单：万一微信下单成功而本地写库失败，用户付了钱却找不到订单 —— 顺序不能反。
  await KV.kvPut(orderKey(sanitizeId, outTradeNo), orderRecord);

  let codeUrl;
  try {
    codeUrl = await createNativeOrder({
      outTradeNo,
      description: `${String(pkg.name || '算力充值').trim()} · 算力充值`,
      amountCents: Math.round(price * 100),
      notifyUrl: WEB_RECHARGE_NOTIFY_URL,
      timeExpire: rfc3339Cst(expiresAtMs),
    });
  } catch (error) {
    console.error('[web-recharge] 下单失败:', outTradeNo, error?.code, error?.message || error);
    // 下单失败的单据标记关闭，避免留下永远 pending 的孤儿单。
    await KV.kvPut(orderKey(sanitizeId, outTradeNo), {
      ...orderRecord,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedReason: 'create_failed',
      closedBy: 'system',
    });
    sendJson(res, 502, {
      ok: false,
      code: 'WECHAT_PAY_CREATE_FAILED',
      msg: '暂时无法发起支付，请稍后重试',
      detail: String((error && error.message) || ''),
    });
    return;
  }

  sendJson(res, 200, { ok: true, order: publicOrder(orderRecord), codeUrl });
}

// ============ GET /api/recharge/status?orderId= ============
async function orderStatus(res, session, deps, orderId) {
  const { KV, sanitizeId } = deps;
  if (!session) {
    sendJson(res, 401, { ok: false, code: 'NOT_LOGGED_IN', msg: '请先登录后再查询支付结果' });
    return;
  }
  const clean = String(orderId || '').trim();
  if (!clean) {
    sendJson(res, 400, { ok: false, code: 'INVALID_ORDER', msg: '缺少订单号' });
    return;
  }
  const order = await KV.kvGet(orderKey(sanitizeId, clean));
  if (!order) {
    sendJson(res, 404, { ok: false, code: 'ORDER_NOT_FOUND', msg: '订单不存在或已失效' });
    return;
  }
  // 只能查自己的订单。
  if (String(order.userId || '') !== sanitizeId(String(session.userId || ''))) {
    sendJson(res, 403, { ok: false, code: 'FORBIDDEN', msg: '无权查看该订单' });
    return;
  }
  await loadPayConfig(KV);
  let current = order;
  if (String(order.status) === 'pending' && wechatPayConfigured()) {
    const synced = await syncOrder({ KV, sanitizeId, order });
    current = synced.order;
  }
  sendJson(res, 200, { ok: true, order: publicOrder(current) });
}

// ============ POST /api/recharge/notify ============
// 微信服务器直连，无登录态。校验模型与小程序端 JSAPI 回调一致：
// APIv3 密钥解密 resource + 主动查单二次确认（只有 trade_state === 'SUCCESS' 才发货）。
async function handleNotify(req, res, deps) {
  const { KV, sanitizeId, readBody } = deps;
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
    payload = await readBody(req);
  } catch {
    reply(400, 'FAIL', 'invalid body');
    return;
  }
  let tx;
  try {
    tx = decryptNotifyResource(payload && payload.resource);
  } catch (error) {
    // 解密失败：密钥不符或报文被篡改，让微信按重试策略处理。
    console.error('[web-recharge] notify 解密失败:', error?.message || error);
    reply(400, 'FAIL', 'decrypt failed');
    return;
  }
  const outTradeNo = String(tx.out_trade_no || '');
  if (!outTradeNo) {
    reply(400, 'FAIL', 'missing out_trade_no');
    return;
  }
  const order = await KV.kvGet(orderKey(sanitizeId, outTradeNo));
  if (!order) {
    // 订单不存在通常是我们已清理的测试单，回 SUCCESS 让微信别再重试。
    reply(200, 'SUCCESS', 'order not found');
    return;
  }
  const synced = await syncOrder({ KV, sanitizeId, order });
  if (String(synced.order.status) !== 'paid') {
    reply(200, 'FAIL', `order status=${synced.order.status}`);
    return;
  }
  reply(200, 'SUCCESS', 'ok');
}

// ============ 定时对账（网页端 Native 订单） ============
// 覆盖「用户付完款立刻关掉网页」的漏单：不依赖前端轮询，也不依赖微信通知能否送达。
export async function reconcilePendingNativeOrders(KV, sanitizeId, {
  maxAgeMs = NATIVE_RECONCILE_MAX_AGE_MS,
  scanLimit = 3000,
  batch = 10,
} = {}) {
  const stats = { candidates: 0, pending: 0, delivered: 0, closed: 0 };
  try {
    await loadPayConfig(KV);
    if (!wechatPayConfigured()) return stats;
    const now = Date.now();
    const keys = (await KV.kvList('order_', scanLimit)).filter((key) => {
      const raw = String(key);
      if (!raw.startsWith('order_p')) return false;
      const ts = Number(raw.slice(7, 20));
      return Number.isFinite(ts) && ts > 0 && now - ts <= maxAgeMs;
    });
    stats.candidates = keys.length;
    for (let i = 0; i < keys.length; i += batch) {
      const orders = await Promise.all(keys.slice(i, i + batch).map((key) => KV.kvGet(key)));
      for (const order of orders) {
        if (!order || String(order.status) !== 'pending') continue;
        if (!order.meta || order.meta.payment !== 'wechat_native') continue;
        stats.pending += 1;
        const before = String(order.status);
        const synced = await syncOrder({ KV, sanitizeId, order });
        const after = String(synced.order.status);
        if (before !== after && after === 'paid') stats.delivered += 1;
        if (before !== after && after === 'closed') stats.closed += 1;
      }
    }
    if (stats.delivered > 0 || stats.closed > 0) console.log('[web-recharge] 定时对账:', JSON.stringify(stats));
  } catch (error) {
    console.error('[web-recharge] 定时对账异常:', error?.code, error?.message || error);
  }
  return stats;
}

// 路由入口：非 /api/recharge/* 一律返回 false，交回主流程。
export async function handleWebRecharge(req, res, url, deps) {
  const path = url.pathname;
  if (!path.startsWith('/api/recharge/')) return false;
  const { getSession, isAdminSession } = deps;

  try {
    // 支付通知必须排在登录校验之前：微信服务器没有我们的会话。
    if (path === '/api/recharge/notify') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { code: 'FAIL', message: 'method not allowed' });
        return true;
      }
      await handleNotify(req, res, deps);
      return true;
    }

    if (path === '/api/recharge/order') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', msg: '请使用 POST' });
        return true;
      }
      const session = getSession(req);
      // 管理员会话不能用于充值（后台账号不是前台会员账号，加算力会加到错的人身上）。
      if (session && isAdminSession(session)) {
        sendJson(res, 403, { ok: false, code: 'ADMIN_NOT_ALLOWED', msg: '请使用会员账号登录后再充值' });
        return true;
      }
      await createOrder(req, res, session, deps);
      return true;
    }

    if (path === '/api/recharge/status') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', msg: '请使用 GET' });
        return true;
      }
      await orderStatus(res, getSession(req), deps, url.searchParams.get('orderId'));
      return true;
    }

    sendJson(res, 404, { ok: false, code: 'NOT_FOUND', msg: '接口不存在' });
    return true;
  } catch (error) {
    console.error('[web-recharge] 处理异常:', path, error?.code, error?.message || error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'INTERNAL_ERROR', msg: '服务繁忙，请稍后重试' });
    return true;
  }
}
