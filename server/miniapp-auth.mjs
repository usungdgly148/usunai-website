import crypto from 'node:crypto';
import {
  errorEnvelope,
  requestIdFor,
  safeUser,
  sendJson,
  successEnvelope,
} from './miniapp-api.mjs';

const LOGIN_PATH = '/api/miniapp/v1/auth/login';
const BIND_PATH = '/api/miniapp/v1/auth/bind';
const STATUS_PATH = '/api/miniapp/v1/auth/status';

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function identityStorageKeys(appId, openid, unionid = '', userId = '') {
  const identityKey = `wxmini_identity_${digest(`${appId}:${openid}`)}`;
  return {
    identityKey,
    unionKey: unionid ? `wxmini_union_${digest(`${appId}:${unionid}`)}` : '',
    userIndexKey: userId ? `wxmini_user_${digest(`${appId}:${userId}`)}` : '',
  };
}

export async function exchangeWechatCode(code, config, fetchImpl = fetch) {
  const appId = String(config.appId || '').trim();
  const appSecret = String(config.appSecret || '').trim();
  if (!appId || !appSecret) {
    const error = new Error('mini-program login is not configured');
    error.code = 'MINIAPP_NOT_CONFIGURED';
    throw error;
  }
  const params = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    js_code: String(code || ''),
    grant_type: 'authorization_code',
  });
  const response = await fetchImpl(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const error = new Error('WeChat login service is temporarily unavailable');
    error.code = 'WECHAT_LOGIN_UNAVAILABLE';
    throw error;
  }
  const data = await response.json();
  if (data.errcode || !data.openid) {
    const error = new Error('WeChat login credential is invalid or expired');
    error.code = 'WECHAT_CODE_INVALID';
    throw error;
  }
  return { openid: String(data.openid), unionid: String(data.unionid || '') };
}

function requireMiniappUser(req, res, requestId, deps) {
  const session = deps.getSession(req);
  if (!session || deps.isAdminSession(session)) {
    sendJson(res, session ? 403 : 401, errorEnvelope('USER_AUTH_REQUIRED', '需要小程序用户登录', requestId), requestId);
    return null;
  }
  if (session.client !== 'miniapp' || !session.identityKey) {
    sendJson(res, 403, errorEnvelope('MINIAPP_SESSION_REQUIRED', '需要小程序登录状态', requestId), requestId);
    return null;
  }
  return session;
}

async function login(req, res, requestId, deps) {
  const body = await deps.readBody(req);
  const code = String(body.code || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,256}$/.test(code)) {
    sendJson(res, 400, errorEnvelope('INVALID_LOGIN_CODE', '微信登录凭证格式不正确', requestId), requestId);
    return;
  }

  let wechatIdentity;
  try {
    wechatIdentity = await exchangeWechatCode(code, deps.config, deps.fetchImpl || fetch);
  } catch (error) {
    const status = error.code === 'MINIAPP_NOT_CONFIGURED' ? 503 : 401;
    sendJson(res, status, errorEnvelope(error.code || 'WECHAT_LOGIN_FAILED', error.message, requestId), requestId);
    return;
  }

  const now = new Date().toISOString();
  const placeholderId = `u${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const keys = identityStorageKeys(deps.config.appId, wechatIdentity.openid, wechatIdentity.unionid, placeholderId);
  const identity = {
    id: keys.identityKey,
    appId: deps.config.appId,
    openid: wechatIdentity.openid,
    unionid: wechatIdentity.unionid || null,
    userId: placeholderId,
    bindingState: 'unbound',
    createdAt: now,
    updatedAt: now,
  };
  const reg = {
    id: placeholderId,
    name: '微信用户',
    avatar: '',
    points: 0,
    balance: 0,
    role: 'user',
    status: 'active',
    provider: 'wechat-miniapp',
    createdAt: now.slice(0, 10),
  };
  const resolved = await deps.KV.kvResolveWechatIdentity({
    identityKey: keys.identityKey,
    unionKey: keys.unionKey,
    userIndexKey: keys.userIndexKey,
    identity,
    reg,
    user: { ...reg },
  });
  const activeIdentity = resolved.identity;
  const safeId = deps.sanitizeId(activeIdentity.userId);
  const [storedReg, storedUser] = await Promise.all([
    deps.KV.kvGet('reg_' + safeId),
    deps.KV.kvGet('user_' + safeId),
  ]);
  if (!storedReg && !storedUser) {
    sendJson(res, 500, errorEnvelope('IDENTITY_USER_MISSING', '微信身份对应的用户不存在', requestId), requestId);
    return;
  }
  const token = deps.createMiniappSession(activeIdentity.userId, activeIdentity.id);
  sendJson(res, 200, successEnvelope({
    token,
    user: safeUser(storedReg, storedUser, deps.getPlanValidity),
    isNewUser: !!resolved.created,
    bindingRequired: activeIdentity.bindingState !== 'bound',
  }, requestId), requestId);
}

async function bind(req, res, requestId, deps) {
  const session = requireMiniappUser(req, res, requestId, deps);
  if (!session) return;
  const body = await deps.readBody(req);
  const method = String(body.method || '').trim().toLowerCase();
  let targetReg = null;

  if (method === 'email') {
    const email = String(body.email || '').trim().toLowerCase();
    targetReg = await deps.findRegByEmail(email);
    if (!targetReg || !deps.verifyPassword(String(body.password || ''), targetReg.password)) {
      sendJson(res, 401, errorEnvelope('ACCOUNT_VERIFICATION_FAILED', '邮箱或密码错误', requestId), requestId);
      return;
    }
  } else if (method === 'phone') {
    const phone = String(body.phone || '').trim();
    const verified = await deps.verifyPhoneCode(phone, String(body.code || ''));
    if (!verified.ok) {
      sendJson(res, 401, errorEnvelope('ACCOUNT_VERIFICATION_FAILED', verified.message || '短信验证码错误或已过期', requestId), requestId);
      return;
    }
    targetReg = await deps.findUserByPhone(phone);
    if (!targetReg) {
      sendJson(res, 404, errorEnvelope('ACCOUNT_NOT_FOUND', '该手机号没有已注册账号', requestId), requestId);
      return;
    }
  } else {
    sendJson(res, 400, errorEnvelope('INVALID_BIND_METHOD', '仅支持手机号或邮箱账号验证', requestId), requestId);
    return;
  }

  if (String(targetReg.role || 'user') === 'admin') {
    sendJson(res, 403, errorEnvelope('ADMIN_BIND_FORBIDDEN', '管理员账号不能绑定到小程序', requestId), requestId);
    return;
  }

  const currentIndex = identityStorageKeys(deps.config.appId, '', '', session.userId).userIndexKey;
  const targetIndex = identityStorageKeys(deps.config.appId, '', '', targetReg.id).userIndexKey;
  const result = await deps.KV.kvBindWechatIdentity({
    identityKey: session.identityKey,
    currentUserId: session.userId,
    targetUserId: targetReg.id,
    currentUserIndexKey: currentIndex,
    targetUserIndexKey: targetIndex,
    updatedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    const conflict = result.reason === 'target_already_bound';
    sendJson(res, conflict ? 409 : 400, errorEnvelope(
      conflict ? 'ACCOUNT_ALREADY_BOUND' : 'ACCOUNT_BIND_FAILED',
      conflict ? '该账号已经绑定其他微信身份' : '账号绑定失败，请重新登录后再试',
      requestId,
    ), requestId);
    return;
  }

  const token = deps.createMiniappSession(targetReg.id, session.identityKey);
  sendJson(res, 200, successEnvelope({
    token,
    user: safeUser(result.reg, result.user, deps.getPlanValidity),
    bindingRequired: false,
  }, requestId), requestId);
}

async function status(req, res, requestId, deps) {
  const session = requireMiniappUser(req, res, requestId, deps);
  if (!session) return;
  const identity = await deps.KV.kvGet(session.identityKey);
  sendJson(res, 200, successEnvelope({
    bound: identity?.bindingState === 'bound',
    userId: session.userId,
  }, requestId), requestId);
}

export async function handleMiniappAuth(req, res, url, deps) {
  const path = url.pathname;
  if (![LOGIN_PATH, BIND_PATH, STATUS_PATH].includes(path)) return false;
  const requestId = requestIdFor(req);
  try {
    if (path === LOGIN_PATH && req.method === 'POST') await login(req, res, requestId, deps);
    else if (path === BIND_PATH && req.method === 'POST') await bind(req, res, requestId, deps);
    else if (path === STATUS_PATH && req.method === 'GET') await status(req, res, requestId, deps);
    else sendJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', '该接口不支持当前请求方法', requestId), requestId);
  } catch (error) {
    sendJson(res, 500, errorEnvelope('MINIAPP_AUTH_INTERNAL_ERROR', '小程序登录服务暂时不可用', requestId), requestId);
  }
  return true;
}
