import { getAccessToken } from './wechat-virtual-pay.mjs';

const API_HOST = 'https://api.weixin.qq.com';

/**
 * 用「手机号快速验证组件」的动态令牌换取用户手机号（P1-1 微信一键绑定）。
 *
 * 链路：小程序 `<button open-type="getPhoneNumber">` → `bindgetphonenumber` 事件拿到
 * `e.detail.code`（动态令牌，**5 分钟有效、只能消费一次**）→ 本函数用 access_token 去微信换号。
 *
 * ⚠️ 几个必须记住的点：
 *   · 这个 code **与 `wx.login` 的 code 不是一回事，不能混用**（混用必然报 invalid code）。
 *   · 基础库 2.21.2 起的新方式**不需要**先 `wx.login`，号码由微信侧验证后再下发。
 *   · 号码是「平台验证过」的，因此它与短信验证码**同等可信**，绑定时不必再发短信。
 *   · 该能力**要收费**（0.03 元/次，成功才计费；每个小程序 1000 次体验额度），
 *     且需在 MP 后台「开发管理 → 接口设置」单独申请开通 —— 开通前调用会失败，
 *     所以上层的失败分支必须能**优雅退化到短信**（见 miniapp-auth.mjs 的 bindPhone）。
 *   · access_token 复用虚拟支付那套进程内缓存（同一个 AppId/AppSecret），不另建一份。
 *
 * 返回 `{ phone, countryCode }`；失败抛出的 error 带 `.code`：
 *   · `WECHAT_PHONE_CODE_REQUIRED` / `WECHAT_PHONE_CODE_INVALID` / `WECHAT_PHONE_INVALID_NUMBER`
 *     —— 都属于「这次令牌不好使」，调用方应引导用户**重新点一次按钮**（HTTP 400）。
 *   · `WECHAT_PHONE_UNAVAILABLE` —— 能力未开通 / 凭证缺失 / 微信侧抖动，调用方应**退化到短信**（HTTP 503）。
 */
export async function exchangeWechatPhoneCode(code, { fetchImpl = fetch } = {}) {
  const dynamicCode = String(code || '').trim();
  if (!dynamicCode) {
    const error = new Error('缺少微信手机号动态令牌');
    error.code = 'WECHAT_PHONE_CODE_REQUIRED';
    throw error;
  }

  const request = async (forceRefresh) => {
    const accessToken = await getAccessToken(forceRefresh);
    const response = await fetchImpl(
      `${API_HOST}/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: dynamicCode }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response, data };
  };

  let { response, data } = await request(false);
  // 42001 = access_token 已过期、40001 = 无效。进程内缓存可能被别处刷掉（微信会作废旧 token），
  // 这种情况强刷一次再试；真失败才把错误抛给上层，避免让用户白点一次按钮。
  const errcode = Number(data?.errcode) || 0;
  if (errcode === 42001 || errcode === 40001) {
    ({ response, data } = await request(true));
  }

  if (!response.ok && !data) {
    const error = new Error(`微信手机号接口不可用（HTTP ${response.status}）`);
    error.code = 'WECHAT_PHONE_UNAVAILABLE';
    throw error;
  }
  const finalCode = Number(data?.errcode) || 0;
  if (finalCode !== 0) {
    // -1 是微信侧系统繁忙，属「暂时不可用」，让客户端退化到短信而不是让用户反复点。
    const error = new Error(data?.errmsg || `换取手机号失败（errcode ${finalCode}）`);
    error.code = finalCode === -1 ? 'WECHAT_PHONE_UNAVAILABLE' : 'WECHAT_PHONE_CODE_INVALID';
    error.detail = { errcode: finalCode };
    throw error;
  }

  const info = data?.phone_info || {};
  // purePhoneNumber 是去掉国家码的 11 位号码，优先用它；兜底从 phoneNumber 里剥掉 +86。
  const phone = String(info.purePhoneNumber || '').trim()
    || String(info.phoneNumber || '').replace(/^\+?86/, '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    const error = new Error('微信返回的手机号格式不正确');
    error.code = 'WECHAT_PHONE_INVALID_NUMBER';
    error.detail = { countryCode: info.countryCode };
    throw error;
  }
  return { phone, countryCode: String(info.countryCode || '86') };
}
