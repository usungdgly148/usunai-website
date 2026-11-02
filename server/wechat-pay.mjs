// 微信支付（APIv3 · JSAPI 小程序支付）封装。
// 只用 Node 内置 crypto 完成商户私钥签名 / 请求签名 / 回调 AES-256-GCM 解密，零第三方依赖。
// 凭证一律走环境变量，缺省时 isConfigured() 返回 false，下单接口优雅降级为 503（不报 500）。
//
// 安全模型说明：
// - 下单 / 查单请求用「商户 API 私钥 + 证书序列号」做 WECHATPAY2-SHA256-RSA2048 签名，微信侧验商户身份；
// - 支付结果通知（notify）里，本实现采用「APIv3 密钥解密 resource + 主动查单二次确认」双重校验，
//   不依赖拉取微信平台证书验签：解密需要 APIv3 密钥（仅商户与微信持有），查单需商户私钥签名且返回
//   微信权威的 trade_state，只有 trade_state === 'SUCCESS' 才触发加算力，且落库幂等（防重复回调）。

import crypto from 'node:crypto';

const API_HOST = 'https://api.mch.weixin.qq.com';
const JSAPI_PATH = '/v3/pay/transactions/jsapi';
// Native 支付（扫码支付）：网页端收银台用。与 JSAPI 同一套商户凭证，区别只有两点——
// 不需要 payer.openid（买家在微信里扫码后才完成身份绑定），返回值是 code_url 而不是 prepay_id。
const NATIVE_PATH = '/v3/pay/transactions/native';
const QUERY_PATH_PREFIX = '/v3/pay/transactions/out-trade-no/';

// 从环境变量读取支付配置（PEM 私钥允许以 \n 字面量传入，统一还原为真实换行）。
function normalizePrivateKey(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  // 常见：环境变量里用 \n 或换行承载多行 PEM；两者都兼容。
  if (!str.includes('\n') && str.includes('\\n')) return str.replace(/\\n/g, '\n');
  return str;
}

export const WECHAT_PAY = {
  mchid: process.env.WECHAT_PAY_MCHID || '1728733415',
  appId: process.env.WECHAT_MINIAPP_APP_ID || 'wx4f071fbfd1e51130',
  serialNo: String(process.env.WECHAT_PAY_SERIAL_NO || '').trim(),
  privateKey: normalizePrivateKey(process.env.WECHAT_PAY_PRIVATE_KEY),
  apiV3Key: String(process.env.WECHAT_PAY_API_V3_KEY || '').trim(),
  notifyUrl: String(process.env.WECHAT_PAY_NOTIFY_URL || 'https://usunai.top/api/miniapp/v1/recharge/notify').trim(),
};

// 小程序支付凭证的 KV key（管理后台「小程序设置」保存）。字段 { serialNo, privateKey, apiV3Key }。
export const PAY_CONFIG_KV_KEY = 'miniappPaySettings';

// 从 KV 加载支付凭证（KV 优先，环境变量兜底）。下单 / 回调前调用一次即可。
// 凭证由管理员后台设置，后端运行时动态读取，避免重启服务。
export async function loadPayConfig(KV) {
  try {
    const kv = await KV.kvGet(PAY_CONFIG_KV_KEY);
    if (kv && typeof kv === 'object') {
      if (String(kv.serialNo || '').trim()) WECHAT_PAY.serialNo = String(kv.serialNo).trim();
      if (String(kv.privateKey || '').trim()) WECHAT_PAY.privateKey = normalizePrivateKey(kv.privateKey);
      if (String(kv.apiV3Key || '').trim()) WECHAT_PAY.apiV3Key = String(kv.apiV3Key).trim();
    }
  } catch {
    // KV 读取失败时保留环境变量兜底，不阻断下单。
  }
  return WECHAT_PAY;
}

export function wechatPayConfigured() {
  return !!(WECHAT_PAY.mchid && WECHAT_PAY.appId && WECHAT_PAY.serialNo && WECHAT_PAY.privateKey && WECHAT_PAY.apiV3Key && WECHAT_PAY.notifyUrl);
}

function nonceStr() {
  return crypto.randomBytes(16).toString('hex');
}

function timestampSeconds() {
  return Math.floor(Date.now() / 1000).toString();
}

// 商户私钥 RSA-SHA256 签名，返回 base64。
function sign(message) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message, 'utf8');
  signer.end();
  return signer.sign(WECHAT_PAY.privateKey, 'base64');
}

// 组装 WECHATPAY2-SHA256-RSA2048 Authorization 头。
// canonicalUrl 只取 path（不含域名与 query），与官方 SDK 行为一致。
function buildAuthorization(method, canonicalUrl, body) {
  const timestamp = timestampSeconds();
  const nonce = nonceStr();
  const bodyStr = body ? JSON.stringify(body) : '';
  const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  const signature = sign(message);
  return {
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WECHAT_PAY.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${WECHAT_PAY.serialNo}"`,
  };
}

async function requestWechat(method, canonicalUrl, body) {
  const { authorization } = buildAuthorization(method, canonicalUrl, body);
  const response = await fetch(`${API_HOST}${canonicalUrl}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const err = new Error(data?.message || `微信支付接口返回 ${response.status}`);
    err.code = data?.code || 'WECHAT_PAY_HTTP_ERROR';
    err.status = response.status;
    err.detail = data;
    throw err;
  }
  return data;
}

// 商品描述清洗。
//
// ⚠️ 微信 v3 的 description 不接受 emoji：套餐名里带「🥈 银卡」这类字符时，下单会直接报
//    INVALID_REQUEST 「请求内容传入了非UTF8参数」（2026-11-02 实测踩到）。
//    这是平台限制，不是我们的编码问题 —— 所以在这里统一剥掉 emoji / 变体选择符 / 控制字符，
//    而不是要求管理员去改后台套餐名。
export function plainDescription(input, fallback = '算力充值') {
  let text = String(input == null ? '' : input);
  // ① 星光平面以上（emoji 主体，4 字节 UTF-8）
  text = text.replace(/[\u{10000}-\u{10FFFF}]/gu, '');
  // ② 杂项符号 / 装饰符号 / 变体选择符（⭐ ✅ ❗ 之类留在 BMP 里的图形字符）
  text = text.replace(/[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F]/g, '');
  // ③ 控制字符与零宽字符
  text = text.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  // ④ 去掉剥离后残留的分隔符（例如「 · 算力充值」开头那个点）
  text = text.replace(/^[·•\-—|/\\]+/, '').replace(/[·•\-—|/\\]+$/, '').trim();
  if (!text) text = fallback;
  return text.slice(0, 127);
}

// JSAPI 下单：返回 prepay_id。
export async function createJsapiOrder({ openid, outTradeNo, description, amountCents }) {
  const body = {
    appid: WECHAT_PAY.appId,
    mchid: WECHAT_PAY.mchid,
    description: plainDescription(description),
    out_trade_no: outTradeNo,
    notify_url: WECHAT_PAY.notifyUrl,
    amount: { total: Math.round(Number(amountCents) || 0), currency: 'CNY' },
    payer: { openid: String(openid || '') },
  };
  const data = await requestWechat('POST', JSAPI_PATH, body);
  if (!data || !data.prepay_id) {
    const err = new Error('微信支付下单失败：未返回 prepay_id');
    err.code = 'WECHAT_PAY_NO_PREPAY_ID';
    throw err;
  }
  return data.prepay_id;
}

// Native 下单（扫码支付）：返回 code_url（weixin://wxpay/bizpayurl?pr=xxx）。
// 前端用二维码库把它画成二维码，用户用微信「扫一扫」扫码后在自己手机上付款。
// 与 JSAPI 的差异：无 payer.openid；notify_url 必须单独传（网页端与小程序端的回调不是同一条路径）。
export async function createNativeOrder({ outTradeNo, description, amountCents, notifyUrl, timeExpire }) {
  const body = {
    appid: WECHAT_PAY.appId,
    mchid: WECHAT_PAY.mchid,
    description: plainDescription(description),
    out_trade_no: String(outTradeNo || ''),
    notify_url: String(notifyUrl || WECHAT_PAY.notifyUrl),
    amount: { total: Math.round(Number(amountCents) || 0), currency: 'CNY' },
  };
  // time_expire：RFC3339，形如 2026-11-03T12:30:00+08:00。不传则是微信默认（2 小时）。
  if (timeExpire) body.time_expire = String(timeExpire);
  const data = await requestWechat('POST', NATIVE_PATH, body);
  if (!data || !data.code_url) {
    const err = new Error('微信支付下单失败：未返回 code_url');
    err.code = 'WECHAT_PAY_NO_CODE_URL';
    err.detail = data;
    throw err;
  }
  return data.code_url;
}

// 关闭未支付订单（用户把二维码晾到过期、或点了「重新生成」时清理旧单）。
// 微信侧已支付的订单调用会报错 —— 调用方据此判断「其实已经付了」，转去查单发货。
export async function closeOrderByOutTradeNo(outTradeNo) {
  const canonicalUrl = `${QUERY_PATH_PREFIX}${encodeURIComponent(outTradeNo)}/close`;
  await requestWechat('POST', canonicalUrl, { mchid: WECHAT_PAY.mchid });
  return true;
}

// 生成小程序端 Taro.requestPayment 所需的参数（paySign 用商户私钥对支付参数签名）。
export function buildPayParams(prepayId) {
  const timeStamp = timestampSeconds();
  const nonce = nonceStr();
  const pkg = `prepay_id=${prepayId}`;
  const message = `${WECHAT_PAY.appId}\n${timeStamp}\n${nonce}\n${pkg}\n`;
  const paySign = sign(message);
  return { timeStamp, nonceStr: nonce, package: pkg, signType: 'RSA', paySign };
}

// 主动查单：返回微信权威交易结果（含 trade_state）。
export async function queryOrderByOutTradeNo(outTradeNo) {
  const canonicalUrl = `${QUERY_PATH_PREFIX}${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(WECHAT_PAY.mchid)}`;
  // 微信 APIv3 签名串的 URL 必须包含 query（path + query），否则查单验签失败返回 SIGN_ERROR。
  const { authorization } = buildAuthorization('GET', canonicalUrl, null);
  const response = await fetch(`${API_HOST}${canonicalUrl}`, {
    method: 'GET',
    headers: { Authorization: authorization, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const err = new Error(data?.message || `微信支付查单返回 ${response.status}`);
    err.code = data?.code || 'WECHAT_PAY_QUERY_ERROR';
    err.status = response.status;
    throw err;
  }
  return data;
}

// 解密支付结果通知 resource（AES-256-GCM，key = APIv3 密钥）。
// ciphertext 最后 16 字节是 GCM 认证标签。
export function decryptNotifyResource(resource) {
  const ciphertext = Buffer.from(String(resource?.ciphertext || ''), 'base64');
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(WECHAT_PAY.apiV3Key, 'utf8'), Buffer.from(String(resource?.nonce || ''), 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(String(resource?.associated_data || ''), 'utf8'));
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
