// 微信小程序虚拟支付（xpay / 米大师 2.0）封装。
// 官方文档：
//   https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
//   https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
//
// 只用 Node 内置 crypto 完成两套 HMAC-SHA256 签名，零第三方依赖：
//   paySig    = hex(hmac_sha256(AppKey,     uri + '&' + postBody))  —— 支付签名（uri 不带 query）
//   signature = hex(hmac_sha256(sessionKey, postBody))              —— 用户态签名
// AppKey 只在服务端持有，绝不回传前端；sessionKey 来自小程序登录（auth.code2Session）。
//
// 本模块只实现「道具直购（short_series_goods）」所需能力：
//   /xpay/query_order           现金单查询（前端轮询兜底发货）
//   /xpay/notify_provide_goods  通知已发货完成（推送应答异常时的手动补偿）
// 代币相关接口（currency_pay / query_user_balance / present_currency）本业务不使用。

import crypto from 'node:crypto';

const API_HOST = 'https://api.weixin.qq.com';
const TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;
const QUERY_ORDER_PATH = '/xpay/query_order';
const NOTIFY_PROVIDE_GOODS_PATH = '/xpay/notify_provide_goods';

// 前端 wx.requestVirtualPayment 的签名 uri 是固定字符串，不是接口路径。
export const CLIENT_SIGN_URI = 'requestVirtualPayment';

// 虚拟支付凭证的 KV key（管理后台「小程序设置 → 虚拟支付」保存）。
// 字段 { offerId, appKey, env }。
export const VIRTUAL_PAY_CONFIG_KV_KEY = 'miniappVirtualPaySettings';

export const VIRTUAL_PAY = {
  appId: String(process.env.WECHAT_MINIAPP_APP_ID || 'wx4f071fbfd1e51130').trim(),
  appSecret: String(process.env.WECHAT_MINIAPP_APP_SECRET || '').trim(),
  offerId: String(process.env.WECHAT_VIRTUAL_PAY_OFFER_ID || '').trim(),
  appKey: String(process.env.WECHAT_VIRTUAL_PAY_APP_KEY || '').trim(),
  // 消息推送（虚拟支付 → 基本配置 → 发货推送配置）用：URL 握手 Token + 安全模式 EncodingAESKey（43 位）。
  pushToken: String(process.env.WECHAT_VIRTUAL_PAY_PUSH_TOKEN || '').trim(),
  encodingAesKey: String(process.env.WECHAT_VIRTUAL_PAY_ENCODING_AES_KEY || '').trim(),
  // 0 = 现网环境，1 = 沙箱环境。现网版本的 env 只能是 0（填 1 会报 -15011）。
  env: 0,
};

// 从 KV 加载虚拟支付配置（KV 优先，环境变量兜底）。下单 / 回调前调用一次即可。
export async function loadVirtualPayConfig(KV) {
  try {
    const kv = await KV.kvGet(VIRTUAL_PAY_CONFIG_KV_KEY);
    if (kv && typeof kv === 'object') {
      if (String(kv.offerId || '').trim()) VIRTUAL_PAY.offerId = String(kv.offerId).trim();
      if (String(kv.appKey || '').trim()) VIRTUAL_PAY.appKey = String(kv.appKey).trim();
      if (String(kv.pushToken || '').trim()) VIRTUAL_PAY.pushToken = String(kv.pushToken).trim();
      if (String(kv.encodingAesKey || '').trim()) VIRTUAL_PAY.encodingAesKey = String(kv.encodingAesKey).trim();
      const env = Number(kv.env);
      if (env === 0 || env === 1) VIRTUAL_PAY.env = env;
    }
  } catch {
    // KV 读取失败时保留环境变量兜底，不阻断下单。
  }
  return VIRTUAL_PAY;
}

export function virtualPayConfigured() {
  return !!(VIRTUAL_PAY.appId && VIRTUAL_PAY.appSecret && VIRTUAL_PAY.offerId && VIRTUAL_PAY.appKey);
}

// 支付签名：uri 对前端调用固定为 'requestVirtualPayment'，对服务端接口为接口路径（不含 query）。
export function calcPaySig(uri, postBody, appKey) {
  return crypto
    .createHmac('sha256', String(appKey))
    .update(`${uri}&${postBody}`, 'utf8')
    .digest('hex');
}

// 用户态签名：sessionKey 为用户当前有效登录态密钥。
export function calcSignature(postBody, sessionKey) {
  return crypto
    .createHmac('sha256', String(sessionKey))
    .update(String(postBody), 'utf8')
    .digest('hex');
}

// access_token（接口调用凭证）进程内缓存，提前 5 分钟过期以避开边界。
let tokenCache = { value: '', expireAt: 0 };

export async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache.value && Date.now() < tokenCache.expireAt) return tokenCache.value;
  if (!VIRTUAL_PAY.appId || !VIRTUAL_PAY.appSecret) {
    const error = new Error('小程序 AppSecret 未配置，无法获取 access_token');
    error.code = 'VIRTUAL_PAY_NOT_CONFIGURED';
    throw error;
  }
  const params = new URLSearchParams({
    grant_type: 'client_credential',
    appid: VIRTUAL_PAY.appId,
    secret: VIRTUAL_PAY.appSecret,
  });
  const response = await fetch(`${API_HOST}/cgi-bin/token?${params.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok || !data || !data.access_token) {
    const error = new Error(data?.errmsg || `获取 access_token 失败（HTTP ${response.status}）`);
    error.code = 'WECHAT_ACCESS_TOKEN_FAILED';
    error.detail = data;
    throw error;
  }
  const expiresIn = Number(data.expires_in) || 7200;
  tokenCache = {
    value: String(data.access_token),
    expireAt: Date.now() + expiresIn * 1000 - TOKEN_EARLY_REFRESH_MS,
  };
  return tokenCache.value;
}

// 调用 xpay 服务端接口。options.sessionKey 存在时附加用户态签名；options.sign === false 时不加 pay_sig。
async function callXpay(uri, body, options = {}) {
  const postBody = JSON.stringify(body);
  const attempt = async (forceRefresh) => {
    const accessToken = await getAccessToken(forceRefresh);
    const params = new URLSearchParams({ access_token: accessToken });
    if (options.sessionKey) params.set('signature', calcSignature(postBody, options.sessionKey));
    if (options.sign !== false) params.set('pay_sig', calcPaySig(uri, postBody, VIRTUAL_PAY.appKey));
    const response = await fetch(`${API_HOST}${uri}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: postBody,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error(data?.errmsg || `虚拟支付接口返回 HTTP ${response.status}`);
      error.code = 'VIRTUAL_PAY_HTTP_ERROR';
      error.status = response.status;
      error.detail = data;
      throw error;
    }
    return data;
  };

  let data = await attempt(options.forceTokenRefresh === true);
  // access_token 过期/非法（40001 / 42001 / 40014）时强制刷新重试一次。
  const tokenErr = Number(data?.errcode);
  if (tokenErr === 40001 || tokenErr === 42001 || tokenErr === 40014) {
    data = await attempt(true);
  }
  if (!data || Number(data.errcode) !== 0) {
    const error = new Error(data?.errmsg || '虚拟支付接口调用失败');
    error.code = 'VIRTUAL_PAY_API_ERROR';
    error.errcode = Number(data?.errcode);
    error.detail = data;
    throw error;
  }
  return data;
}

// 生成小程序端 wx.requestVirtualPayment 所需的全部参数。
// signData 必须是字符串：前端要原样透传给微信，paySig / signature 均对同一份字节签名。
export function buildVirtualPaymentParams({ sessionKey, outTradeNo, productId, goodsPrice, attach = '' }) {
  const signData = JSON.stringify({
    offerId: VIRTUAL_PAY.offerId,
    buyQuantity: 1,
    env: VIRTUAL_PAY.env,
    currencyType: 'CNY',
    productId: String(productId || ''),
    goodsPrice: Math.round(Number(goodsPrice) || 0),
    outTradeNo: String(outTradeNo || ''),
    attach: String(attach || ''),
  });
  return {
    signData,
    paySig: calcPaySig(CLIENT_SIGN_URI, signData, VIRTUAL_PAY.appKey),
    signature: calcSignature(signData, sessionKey),
    mode: 'short_series_goods',
    env: VIRTUAL_PAY.env,
  };
}

// 查询现金单（参数名是 order_id，值为下单时的业务订单号 outTradeNo）。
// 返回 order.status：2 已支付待发货 / 3 发货中 / 4 已发货 / 5 已退款 / 6 已关闭。
export async function queryVirtualOrder({ openid, orderId }) {
  const data = await callXpay(QUERY_ORDER_PATH, {
    openid: String(openid || ''),
    env: VIRTUAL_PAY.env,
    order_id: String(orderId || ''),
  });
  return data.order || null;
}

// 通知已发货完成（只能通知现金单）。用于发货推送应答被判失败时的补偿。
export async function notifyProvideGoods({ orderId }) {
  return callXpay(NOTIFY_PROVIDE_GOODS_PATH, {
    order_id: String(orderId || ''),
    env: VIRTUAL_PAY.env,
  }, { sign: false });
}

// 微信支付成功后可发货的订单状态：2 已支付待发货、3 发货中、4 已发货。
export function isOrderPaidStatus(status) {
  const value = Number(status);
  return value === 2 || value === 3 || value === 4;
}

// ---- 消息推送（虚拟支付 → 基本配置 → 发货推送配置）：URL 握手校验 + 安全模式解密 ----

function sha1(text) {
  return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex');
}

// URL 握手校验：signature = sha1(sort(token, timestamp, nonce) 拼接)。通过后需原样返回 echostr。
export function verifyPushSignature({ signature, timestamp, nonce }) {
  const token = String(VIRTUAL_PAY.pushToken || '');
  if (!token || !signature || !timestamp || !nonce) return false;
  return sha1([token, String(timestamp), String(nonce)].sort().join('')) === String(signature);
}

// 安全模式报文验签：msg_signature = sha1(sort(token, timestamp, nonce, encrypt) 拼接)。
export function verifyMsgSignature({ msgSignature, timestamp, nonce, encrypt }) {
  const token = String(VIRTUAL_PAY.pushToken || '');
  if (!token || !msgSignature) return false;
  return sha1([token, String(timestamp), String(nonce), String(encrypt)].sort().join('')) === String(msgSignature);
}

// 从报文体取密文：XML 取 <Encrypt>，JSON 取 Encrypt 字段；明文报文返回 ''。
export function extractEncrypt(raw) {
  const text = String(raw || '');
  if (!text) return '';
  if (text.trim().startsWith('<')) {
    const match = /<Encrypt>([\s\S]*?)<\/Encrypt>/.exec(text);
    return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
  }
  try {
    const parsed = JSON.parse(text);
    return String((parsed && (parsed.Encrypt || parsed.encrypt)) || '');
  } catch {
    return '';
  }
}

// 安全模式解密：AES-256-CBC，key = Base64(AESKey + '=')（32 字节），IV = key 前 16 字节，
// 明文结构 = random(16B) + msgLen(4B, 大端) + msg + appid。
export function decryptPushMessage(encrypt) {
  const aesKey = Buffer.from(`${String(VIRTUAL_PAY.encodingAesKey || '')}=`, 'base64');
  if (aesKey.length !== 32) {
    const error = new Error('EncodingAESKey 无效（需 43 位）');
    error.code = 'VIRTUAL_PAY_AES_KEY_INVALID';
    throw error;
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(String(encrypt), 'base64')), decipher.final()]);
  // 去 PKCS#7 填充
  const padLength = decrypted[decrypted.length - 1];
  const content = padLength > 0 && padLength <= 32 ? decrypted.subarray(0, decrypted.length - padLength) : decrypted;
  if (content.length < 20) {
    const error = new Error('解密内容长度异常');
    error.code = 'VIRTUAL_PAY_DECRYPT_INVALID';
    throw error;
  }
  const msgLength = content.readUInt32BE(16);
  return content.subarray(20, 20 + msgLength).toString('utf8');
}
