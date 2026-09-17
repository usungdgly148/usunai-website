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
const BIND_PHONE_PATH = '/api/miniapp/v1/auth/bind-phone';
const STATUS_PATH = '/api/miniapp/v1/auth/status';

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

// 微信身份键。前缀 `wxmini_` 是历史名 —— 这套键现在同时服务小程序与网页扫码两端。
// · identityKey / userIndexKey 必须带 appId：openid、站内 userId 都只在单个应用内唯一。
// · unionKey 只能带 unionid：unionid 在同一开放平台内全局唯一，是两端归并的**唯一钥匙**。
//   ⚠️ 历史实现把 appId 也混进了 unionKey 的摘要，于是同一个人在「网站应用」与「小程序」
//   会算出两个不同的键，跨应用归并永远命中不了。改正时线上 unionKey 存量 0 条（两端尚未
//   绑定开放平台，unionid 一直是空的），因此直接改无需数据迁移。
export function identityStorageKeys(appId, openid, unionid = '', userId = '') {
  const identityKey = `wxmini_identity_${digest(`${appId}:${openid}`)}`;
  return {
    identityKey,
    unionKey: unionid ? `wxmini_union_${digest(unionid)}` : '',
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
  return {
    openid: String(data.openid),
    unionid: String(data.unionid || ''),
    // session_key 仅用于服务端签名（虚拟支付用户态 signature），绝不回传前端。
    sessionKey: String(data.session_key || ''),
  };
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
    // session_key 这里就带上：下方「孤儿身份自愈」会整条覆盖身份记录，
    // 若等自愈之后再补写就会丢密钥（它是虚拟支付用户态签名的依据）。
    ...(wechatIdentity.sessionKey
      ? { sessionKey: wechatIdentity.sessionKey, sessionKeyUpdatedAt: now }
      : {}),
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
  let resolved = await deps.KV.kvResolveWechatIdentity({
    identityKey: keys.identityKey,
    unionKey: keys.unionKey,
    userIndexKey: keys.userIndexKey,
    identity,
    reg,
    user: { ...reg },
  });
  // 归并键被**别的**身份占用：同一个 unionid 同时挂在两个账号上 ⇒ 同一个微信。
  // 只有「对方是空壳账号」时才自动并过来；有资产的一律不合并（记日志，留给人工）。
  if (resolved.unionConflict && typeof deps.KV.kvMergeEmptyAccountByUnion === 'function') {
    const merged = await deps.KV.kvMergeEmptyAccountByUnion({
      unionKey: resolved.unionConflict.unionKey,
      keeperIdentityKey: keys.identityKey,
      loserIdentityKey: resolved.unionConflict.ownerIdentityKey,
      updatedAt: now,
    });
    if (merged.ok) {
      console.log('[miniapp-auth] union conflict resolved: merged=' + merged.merged
        + ' keeper=' + merged.keeperUserId + ' loser=' + (merged.loserUserId || '-'));
      // 冲突解除后重跑一次 —— 这次会走 direct 分支的「归并键自愈」，把 unionid 与归并键补齐。
      resolved = await deps.KV.kvResolveWechatIdentity({
        identityKey: keys.identityKey,
        unionKey: keys.unionKey,
        userIndexKey: keys.userIndexKey,
        identity,
        reg,
        user: { ...reg },
      });
    } else {
      console.warn('[miniapp-auth] union conflict kept as-is:', merged.reason,
        'keeper=' + merged.keeperUserId, 'loser=' + (merged.loserUserId || '-'));
    }
  }
  const activeIdentity = resolved.identity;
  // session_key 每次登录都会刷新，且是虚拟支付用户态签名的密钥，必须写回身份记录。
  // kvResolveWechatIdentity 只保证「身份存在」，不保证字段更新，故这里显式覆盖。
  if (wechatIdentity.sessionKey) {
    await deps.KV.kvPut(activeIdentity.id, {
      ...activeIdentity,
      sessionKey: wechatIdentity.sessionKey,
      sessionKeyUpdatedAt: now,
    });
  }
  const safeId = deps.sanitizeId(activeIdentity.userId);
  let [storedReg, storedUser] = await Promise.all([
    deps.KV.kvGet('reg_' + safeId),
    deps.KV.kvGet('user_' + safeId),
  ]);
  let effectiveIdentity = activeIdentity;
  let isNewUser = !!resolved.created;
  if (!storedReg && !storedUser) {
    // 孤儿身份自愈：账号记录已经不存在了（历史「注销账号 / 后台删用户」只删账号、没清微信身份）。
    // kvResolveWechatIdentity 命中旧身份会直接返回，所以这类微信会永久卡在登录失败上，
    // 用户连重新注册都做不到。这里把身份重指向一个全新占位账号（等价于重新注册）。
    // 自愈失败（并发改动等）才回落到 500，保持原语义不倒退。
    const healed = typeof deps.KV.kvResetOrphanWechatIdentity === 'function'
      ? await deps.KV.kvResetOrphanWechatIdentity({
          identityKey: keys.identityKey,
          unionKey: keys.unionKey,
          staleUserId: activeIdentity.userId,
          staleUserIndexKey: identityStorageKeys(
            deps.config.appId, '', '', activeIdentity.userId,
          ).userIndexKey,
          userIndexKey: keys.userIndexKey,
          identity,
          reg,
          user: { ...reg },
        })
      : { ok: false };
    if (!healed.ok) {
      console.error(
        '[miniapp-auth] orphan identity self-heal failed:',
        healed.reason || 'unknown',
        'identityKey=' + keys.identityKey,
      );
      sendJson(res, 500, errorEnvelope('IDENTITY_USER_MISSING', '微信身份对应的用户不存在', requestId), requestId);
      return;
    }
    effectiveIdentity = healed.identity;
    storedReg = reg;
    storedUser = { ...reg };
    isNewUser = true;
  }
  const token = deps.createMiniappSession(effectiveIdentity.userId, effectiveIdentity.id);
  sendJson(res, 200, successEnvelope({
    token,
    user: safeUser(storedReg, storedUser, deps.getPlanValidity),
    isNewUser,
    bindingRequired: effectiveIdentity.bindingState !== 'bound',
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

// 给当前小程序账号补手机号（主人方案里的「A+ 门禁」前置步骤）。
//
// 与 bind() 的区别：bind() 是「把当前微信身份挂到**另一个已有账号**上」（会换 token、
// 换 userId）；这里是「把号码绑到**当前账号**上」，账号不变。
// 客户端把两者合并在同一个「补手机号」页里：先调这里，只有拿到
// PHONE_OWNED_BY_OTHER_ACCOUNT（号码属于有资产的别人账号）才退化成 bind()。
//
// 取号方式有两种，由 body.method 选择（缺省 'sms'，保证老客户端行为不变）：
//   · 'wechat' —— 微信「手机号快速验证组件」动态令牌换号（见 server/wechat-phone.mjs）。
//     号码由微信侧验证，与短信同等可信，因此不再需要短信码。
//   · 'sms'    —— 短信验证码（阿里云 Dypns）。
// 两条路取到号码后**完全共用**下面的闸门与写入逻辑（kvBindPhoneToAccount 是唯一实现）。
async function bindPhone(req, res, requestId, deps) {
  const session = requireMiniappUser(req, res, requestId, deps);
  if (!session) return;
  const body = await deps.readBody(req);
  let phone = String(body.phone || '').trim();
  // 两条取号路径（P1-1 新增第一条；老客户端不带 method 时走第二条，保持向后兼容）：
  //   method='wechat' —— 微信「手机号快速验证组件」的动态令牌换号（一键、无短信，号码由微信验证）
  //   method='sms'（默认）—— 手机号 + 短信验证码（阿里云 Dypns）
  const method = String(body.method || 'sms').trim().toLowerCase();
  if (method === 'wechat') {
    if (typeof deps.exchangeWechatPhoneCode !== 'function') {
      sendJson(res, 503, errorEnvelope(
        'WECHAT_PHONE_UNAVAILABLE', '微信一键绑定暂时不可用，请改用短信验证', requestId,
      ), requestId);
      return;
    }
    try {
      const info = await deps.exchangeWechatPhoneCode(String(body.code || ''));
      phone = String(info.phone || '');
    } catch (error) {
      const code = String(error?.code || '');
      // 令牌失效 / 已被消费 / 号码格式不对 → 让用户重新点一次按钮。
      // 用 400 不能 401（理由同下：401 会触发客户端静默重登，与取号无关）。
      if (code === 'WECHAT_PHONE_CODE_REQUIRED'
        || code === 'WECHAT_PHONE_CODE_INVALID'
        || code === 'WECHAT_PHONE_INVALID_NUMBER') {
        sendJson(res, 400, errorEnvelope(
          code, error.message || '微信手机号校验失败，请重新点击授权', requestId,
        ), requestId);
        return;
      }
      // 能力未开通 / AppSecret 缺失 / 微信侧不可用 → 503，客户端据此退化到短信，绝不让用户卡死。
      console.warn('[miniapp-auth] wechat phone exchange failed:', code || error?.message);
      sendJson(res, 503, errorEnvelope(
        'WECHAT_PHONE_UNAVAILABLE', '微信一键绑定暂时不可用，请改用短信验证', requestId,
      ), requestId);
      return;
    }
  } else if (method !== 'sms') {
    sendJson(res, 400, errorEnvelope('INVALID_BIND_METHOD', '仅支持短信或微信一键绑定手机号', requestId), requestId);
    return;
  } else {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      sendJson(res, 400, errorEnvelope('INVALID_PHONE', '请输入有效的手机号', requestId), requestId);
      return;
    }
    const verified = await deps.verifyPhoneCode(phone, String(body.code || ''));
    if (!verified.ok) {
      // 用 400 而不是 401：客户端把**任意** 401 判为「登录态失效」→ 会静默重登再重试一次，
      // 而验证码错误跟登录态毫无关系，重登只会白白多跑一次 wx.login、还可能掩盖真实原因。
      sendJson(res, 400, errorEnvelope(
        'PHONE_CODE_INVALID',
        verified.message || '短信验证码错误或已过期',
        requestId,
      ), requestId);
      return;
    }
  }
  if (typeof deps.KV.kvBindPhoneToAccount !== 'function') {
    sendJson(res, 500, errorEnvelope('PHONE_BIND_UNAVAILABLE', '手机号绑定暂时不可用', requestId), requestId);
    return;
  }
  const result = await deps.KV.kvBindPhoneToAccount({
    phone,
    userId: session.userId,
    updatedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    // 会话有效但账号记录已不在（注销 / 后台删号）→ 回 401 让客户端重登，
    // 登录路径里的孤儿身份自愈会把身份重指向一个全新占位账号（同 2026-09-16 的修法）。
    if (result.reason === 'user_not_found') {
      sendJson(res, 401, errorEnvelope('USER_AUTH_REQUIRED', '登录态已失效，请重新进入', requestId), requestId);
      return;
    }
    // 号码已属于另一个「有邮箱 / 有微信身份 / 有资产」的账号：绝不抢占，
    // 交给客户端引导用户改走 bind() 的「绑定已有账号」。
    // 这正是主人拍板的规则：空壳自动并、有资产不自动并。
    if (result.reason === 'phone_owned_by_other') {
      sendJson(res, 409, errorEnvelope(
        'PHONE_OWNED_BY_OTHER_ACCOUNT',
        '该手机号已绑定其他账号，请改用「绑定已有账号」',
        requestId,
      ), requestId);
      return;
    }
    sendJson(res, 400, errorEnvelope('PHONE_BIND_FAILED', '手机号绑定失败，请稍后重试', requestId), requestId);
    return;
  }
  const safeId = deps.sanitizeId(session.userId);
  const [storedReg, storedUser] = await Promise.all([
    deps.KV.kvGet('reg_' + safeId),
    deps.KV.kvGet('user_' + safeId),
  ]);
  console.log('[miniapp-auth] phone bound user=' + safeId.slice(0, 16)
    + ' merged=' + result.merged + ' previousOwner=' + (result.previousOwnerId || '-'));
  sendJson(res, 200, successEnvelope({
    user: safeUser(storedReg || {}, storedUser || {}, deps.getPlanValidity),
    bindingRequired: false,
    merged: !!result.merged,
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
  if (![LOGIN_PATH, BIND_PATH, BIND_PHONE_PATH, STATUS_PATH].includes(path)) return false;
  const requestId = requestIdFor(req);
  try {
    if (path === LOGIN_PATH && req.method === 'POST') await login(req, res, requestId, deps);
    else if (path === BIND_PATH && req.method === 'POST') await bind(req, res, requestId, deps);
    else if (path === BIND_PHONE_PATH && req.method === 'POST') await bindPhone(req, res, requestId, deps);
    else if (path === STATUS_PATH && req.method === 'GET') await status(req, res, requestId, deps);
    else sendJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', '该接口不支持当前请求方法', requestId), requestId);
  } catch (error) {
    sendJson(res, 500, errorEnvelope('MINIAPP_AUTH_INTERNAL_ERROR', '小程序登录服务暂时不可用', requestId), requestId);
  }
  return true;
}
