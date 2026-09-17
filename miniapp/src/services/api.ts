import Taro from '@tarojs/taro';
import type { ApiEnvelope, MiniappLayout, MiniappLayoutBlockType, PublicContent, RechargeOrderResult, RechargeStatus, UserProfile } from '../types';
// 分享设置（转发卡片标题 / 落地路径 / 配图）由后台配置、随内容一起下发，
// 拉到内容后必须立刻落一份到本地缓存：微信的分享回调是同步求值的（见 utils/share.ts）。
import { applyShareSettings } from '../utils/share';

export const API_BASE = __MINIAPP_API_BASE__;
export const MINIAPP_ENVIRONMENT = __MINIAPP_ENV__;
export const MINIAPP_VERSION = __MINIAPP_VERSION__;
export const MINIAPP_BUILD = __MINIAPP_BUILD__;
const TOKEN_KEY = 'usunai_miniapp_token';
/** 用户主动退出登录标记（退出后不再静默登录，需点「微信一键登录」才重新进入） */
const LOGGED_OUT_KEY = 'usunai_miniapp_logged_out';
const CONTENT_CACHE_KEY = 'usunai_miniapp_content_v2';
const CONTENT_TTL = 5 * 60 * 1000;
const LAYOUT_TTL = 60 * 1000;
let loginPromise: Promise<string> | null = null;
/**
 * 服务端表明「当前登录态不完整、必须重新登录换取新凭证」的错误码。
 * 这类错误只刷新 token 解决不了，必须重新走 wx.login 让服务端刷新 session_key。
 * SESSION_KEY_MISSING：虚拟支付用户态签名需要登录时写入身份记录的 session_key，
 * P51 之前登录的用户身份记录里没有该字段，需重新登录补齐（否则充值下单永远 403）。
 */
const SESSION_REFRESH_CODES = new Set([
  'SESSION_KEY_MISSING',
  'OPENID_MISSING',
  'MINIAPP_SESSION_REQUIRED',
  'USER_AUTH_REQUIRED',
]);

/** 判断该错误是否可通过「静默重新登录 + 重试一次」恢复 */
function needsSessionRefresh(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  if (error.statusCode === 401) return true;
  // 账号记录已被删除（注销账号 / 后台删用户）留下的「孤儿身份」：服务端现在返回 401，
  // 已由上一行覆盖。这里再兜一层 —— 万一回滚到仍返回 404 USER_NOT_FOUND 的旧服务端，
  // 也要能靠「丢弃 token → 静默重登」自愈，否则「重新加载」会永久复现同一个 404。
  if (error.statusCode === 404 && String(error.code || '') === 'USER_NOT_FOUND') return true;
  return error.statusCode === 403 && SESSION_REFRESH_CODES.has(String(error.code || ''));
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public statusCode = 0) {
    super(message);
  }
}

interface RequestOptions { method?: 'GET' | 'POST'; data?: unknown; auth?: boolean; header?: Record<string, string>; }

function requestHeaders() {
  return {
    'X-Request-Id': `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    'X-Miniapp-Environment': MINIAPP_ENVIRONMENT,
    'X-Miniapp-Version': MINIAPP_VERSION,
  };
}

function normalizeNetworkError(error: unknown): ApiError {
  const errMsg = error && typeof error === 'object' && 'errMsg' in error
    ? String((error as { errMsg?: unknown }).errMsg || '')
    : error instanceof Error ? error.message : '';
  const normalized = errMsg.toLowerCase();
  if (normalized.includes('not in domain list') || normalized.includes('合法域名')) {
    return new ApiError('REQUEST_DOMAIN_INVALID', '服务器域名尚未通过小程序校验，请检查 request 合法域名。');
  }
  if (normalized.includes('ssl') || normalized.includes('certificate') || normalized.includes('tls')) {
    return new ApiError('REQUEST_TLS_INVALID', '服务器 HTTPS 证书校验失败，请检查证书配置。');
  }
  if (normalized.includes('timeout')) {
    return new ApiError('REQUEST_TIMEOUT', '请求超时，请稍后重试。');
  }
  return new ApiError('REQUEST_NETWORK_FAILED', '网络请求失败，请检查网络后重试。');
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  let response: Taro.request.SuccessCallbackResult<ApiEnvelope<T>>;
  try {
    response = await Taro.request<ApiEnvelope<T>>({
      url: `${API_BASE}${path}`,
      method: options.method || 'GET',
      data: options.data,
      dataType: 'json',
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...requestHeaders(),
        ...(options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {}),
      },
    });
  } catch (error) {
    throw normalizeNetworkError(error);
  }
  const responseData: unknown = response.data;
  let body: ApiEnvelope<T>;
  if (typeof responseData === 'string') {
    try {
      body = JSON.parse(responseData) as ApiEnvelope<T>;
    } catch {
      throw new ApiError('RESPONSE_INVALID', '服务器返回内容格式异常，请稍后重试。', response.statusCode);
    }
  } else {
    body = responseData as ApiEnvelope<T>;
  }
  if (response.statusCode < 200 || response.statusCode >= 300 || !body?.ok) {
    throw new ApiError(body?.error?.code || 'REQUEST_FAILED', body?.error?.message || '网络请求失败，请稍后重试', response.statusCode);
  }
  return body;
}

/** 是否处于主动退出登录状态（此时需登录的请求不再静默登录，改为提示先登录） */
export function isLoggedOut() {
  return Taro.getStorageSync<boolean>(LOGGED_OUT_KEY) === true;
}

export function clearLoggedOut() {
  Taro.removeStorageSync(LOGGED_OUT_KEY);
}

export async function ensureMiniappSession(force = false): Promise<string> {
  if (isLoggedOut() && !force) {
    throw new ApiError('AUTH_REQUIRED', '请先登录后再使用该功能', 401);
  }
  const stored = Taro.getStorageSync<string>(TOKEN_KEY);
  if (stored && !force) return stored;
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const login = await Taro.login();
    const response = await rawRequest<{ token: string; user: UserProfile; bindingRequired: boolean }>('/api/miniapp/v1/auth/login', {
      method: 'POST', data: { code: login.code }, auth: false,
    });
    Taro.setStorageSync(TOKEN_KEY, response.data.token);
    return response.data.token;
  })();
  try { return await loginPromise; } finally { loginPromise = null; }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  if (options.auth !== false) await ensureMiniappSession();
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    // 401 或「登录态不完整」类 403：丢弃本地 token，静默重新登录（换取新 session_key）后重试一次。
    if (options.auth !== false && needsSessionRefresh(error) && !isLoggedOut()) {
      await refreshMiniappSession();
      return rawRequest<T>(path, options);
    }
    throw error;
  }
}

/**
 * 强制静默刷新登录态：丢弃本地 token，重新 wx.login 换取服务端新会话。
 * 会顺带刷新身份记录里的 session_key（虚拟支付用户态签名的密钥，微信每次登录都会换新的）。
 */
export async function refreshMiniappSession(): Promise<string> {
  Taro.removeStorageSync(TOKEN_KEY);
  return ensureMiniappSession(true);
}

/** 退出登录：服务端吊销当前会话 + 清理本地登录态（此后需「微信一键登录」重新进入） */
export async function logoutSession() {
  const token = getMiniappToken();
  if (token) {
    try {
      await rawRequest<unknown>('/api/auth/logout', {
        method: 'POST', auth: false, header: { Authorization: `Bearer ${token}` },
      });
    } catch { /* 吊销失败不阻塞本地登出 */ }
  }
  Taro.removeStorageSync(TOKEN_KEY);
  Taro.setStorageSync(LOGGED_OUT_KEY, true);
}

/** 微信一键登录：清除退出标记并强制刷新会话（获取新的登录 token） */
export async function loginWithWechat() {
  clearLoggedOut();
  await ensureMiniappSession(true);
  return getMiniappToken();
}

export async function getPublicContent(force = false): Promise<PublicContent> {
  const cached = Taro.getStorageSync<{ savedAt: number; data: PublicContent }>(CONTENT_CACHE_KEY);
  // 命中缓存时也补一次分享设置：分享设置是单独存一份的（见下），本地那份被清掉时能自愈，
  // 否则要等下一次内容请求、再过去 5 分钟才恢复。
  if (!force && cached?.data && Date.now() - cached.savedAt < CONTENT_TTL) {
    applyShareSettings(cached.data.shareSettings);
    return cached.data;
  }
  try {
    const response = await apiRequest<PublicContent>('/api/miniapp/v1/content', { auth: false });
    Taro.setStorageSync(CONTENT_CACHE_KEY, { savedAt: Date.now(), data: response.data });
    // 分享设置（转发卡片标题 / 落地路径 / 配图）另外存一份：微信的分享回调是同步的，
    // 不能在那儿现发请求，所以必须提前落地（见 utils/share.ts 的 applyShareSettings）。
    applyShareSettings(response.data.shareSettings);
    return response.data;
  } catch (error) {
    if (cached?.data) {
      applyShareSettings(cached.data.shareSettings);
      return cached.data;
    }
    throw error;
  }
}

/**
 * 拉不到布局时的兜底结构（断网/接口异常才用得上）。
 * ⚠️ 必须与 server/miniapp-layout.mjs 的 defaults + defaultLimitFor 保持一致，
 * 否则断网时首页区块和线上不一样 —— 这里以前多了一个 quick-links（早已是死块）。
 */
const DEFAULT_LIMITS: Record<string, number> = { categories: 12, 'featured-agents': 6, 'featured-workflows': 6 };
const defaultBlocks = (types: MiniappLayoutBlockType[]) => types.map((type, index) => ({
  id: `${type}-${index}`, type, visible: true, spacing: 16, limit: DEFAULT_LIMITS[type] || 8,
}));

const DEFAULT_LAYOUTS: Record<'home' | 'category', MiniappLayout> = {
  home: { page: 'home', blocks: defaultBlocks(['carousel', 'announcements', 'search', 'categories', 'featured-agents', 'tool-cards', 'featured-workflows']) },
  category: { page: 'category', blocks: defaultBlocks(['search', 'categories', 'featured-agents', 'featured-workflows']) },
};

export async function getMiniappLayout(page: 'home' | 'category', force = false): Promise<MiniappLayout> {
  const cacheKey = `usunai_miniapp_layout_${page}_v1`;
  const cached = Taro.getStorageSync<{ savedAt: number; data: MiniappLayout }>(cacheKey);
  if (!force && cached?.data && Date.now() - cached.savedAt < LAYOUT_TTL) return cached.data;
  try {
    const response = await apiRequest<MiniappLayout>(`/api/miniapp/v1/layout?page=${page}`, { auth: false });
    if (!response.data || response.data.page !== page || !Array.isArray(response.data.blocks)) throw new Error('布局格式无效');
    Taro.setStorageSync(cacheKey, { savedAt: Date.now(), data: response.data });
    return response.data;
  } catch {
    return cached?.data || DEFAULT_LAYOUTS[page];
  }
}

export async function getMe() {
  return (await apiRequest<UserProfile>('/api/miniapp/v1/me')).data;
}

/** 更新个人资料（昵称 / 头像）。头像为 data URL（base64）或 http(s) URL。 */
export async function updateProfile(patch: { name?: string; avatar?: string }) {
  return (await apiRequest<UserProfile>('/api/miniapp/v1/profile', { method: 'POST', data: patch })).data;
}

/** 修改登录密码（无密码账号不支持）。 */
export async function changePassword(payload: { oldPassword?: string; newPassword: string }) {
  return (await apiRequest<{ ok: boolean }>('/api/miniapp/v1/password', { method: 'POST', data: payload })).data;
}

/** 创建充值订单并返回虚拟支付调起参数（signData/paySig/signature 由服务端签名）。 */
export async function createRechargeOrder(packageId: string) {
  return (await apiRequest<RechargeOrderResult>('/api/miniapp/v1/recharge/order', {
    method: 'POST', data: { packageId },
  })).data;
}

/** 查询充值订单状态（支付成功后确认到账）。 */
export async function getRechargeStatus(orderId: string) {
  return (await apiRequest<RechargeStatus>(`/api/miniapp/v1/recharge/status?orderId=${encodeURIComponent(orderId)}`)).data;
}

export function storeBoundSession(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token);
}

export async function getPagedRecords(
  path: 'assets' | 'compute-records' | 'orders' | 'history',
  page: number,
  pageSize = 12,
  extraQuery = '',
) {
  // 列表读取走 GET：服务端 handleMiniappApi 从 url.searchParams 读取 page / pageSize / category / keyword。
  // 写入（saveRuntimeAsset / saveRuntimeHistory）才是 POST，由 handleMiniappRuntime 处理。
  const query = [`page=${page}`, `pageSize=${pageSize}`];
  if (extraQuery) query.push(extraQuery);
  const response = await apiRequest<Array<Record<string, unknown>>>(`/api/miniapp/v1/${path}?${query.join('&')}`);
  return { items: response.data, pagination: response.meta };
}

/** 全量拉取某类记录（跨页循环，单页最多 100 条），用于客户端过滤 + 算力「剩余」倒推。 */
export async function fetchAllRecords(
  path: 'assets' | 'compute-records' | 'orders' | 'history',
  pageSize = 100,
) {
  const all: Array<Record<string, unknown>> = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await getPagedRecords(path, page, pageSize);
    all.push(...result.items);
    totalPages = Number(result.pagination.totalPages) || 1;
    page += 1;
  } while (page <= totalPages);
  return all;
}

export async function bindWebsiteAccount(payload: { method: 'email'; email: string; password: string } | { method: 'phone'; phone: string; code: string }) {
  return (await apiRequest<{ token: string; user: UserProfile; bindingRequired: boolean }>('/api/miniapp/v1/auth/bind', {
    method: 'POST',
    data: payload,
  })).data;
}

/**
 * 给**当前**账号补手机号（不换账号、不换 token）。
 *
 * 与 bindWebsiteAccount 的分工：后者是「把当前微信身份挂到另一个**已有**账号上」
 * （换 token、换 userId，用于「我本来就有网站账号」）；这里是「给当前这个新账号补上手机号」，
 * 是静默登录用户的常态。号码已属于另一个账号时服务端回 409
 * PHONE_OWNED_BY_OTHER_ACCOUNT，调用方据此改走 bindWebsiteAccount
 * （见 pages/bind/index.tsx 的 adopt 分支）。
 *
 * ⚠️ 号码属于**空壳**账号时服务端会自动并过来，此时 merged=true —— 可以对用户说
 * 「已合并你之前的空账号」，但绝不能说成「登录到别的账号」（那是 adopt 分支才发生的事）。
 */
export async function bindPhoneNumber(payload: { phone: string; code: string }) {
  return (await apiRequest<{ user: UserProfile; bindingRequired: boolean; merged: boolean }>(
    '/api/miniapp/v1/auth/bind-phone', { method: 'POST', data: payload },
  )).data;
}

/**
 * 微信一键绑定手机号（P1-1）：把 `<button open-type="getPhoneNumber">` 回调里的动态令牌
 * 交给服务端去微信换号 —— 用户点一下即可，不用等短信。
 *
 * ⚠️ `dynamicCode` 是**微信手机号组件**的动态令牌（5 分钟有效、只能消费一次），
 * 与 `wx.login` 的 code 完全不是一回事，不能混用。
 *
 * 失败分支（调用方必须都处理，且都要能**退化到短信**，不能让用户卡死）：
 *   · 400 WECHAT_PHONE_CODE_INVALID / WECHAT_PHONE_CODE_REQUIRED —— 令牌失效或被用过，重新点一次按钮
 *   · 503 WECHAT_PHONE_UNAVAILABLE —— 能力未开通 / 次数用尽 / 微信侧不可用
 *   · 409 PHONE_OWNED_BY_OTHER_ACCOUNT —— 号码已属有资产的别的账号，改走 adopt（那里只能靠短信）
 *
 * ⚠️ 成功后**不要**调 `storeBoundSession`：这条路不换账号、**token 不变**
 *（它只是给当前账号补手机号）。只要 reLaunch 回个人中心、让 `/me` 重新拉一次最新 `user`
 *（含 phoneBound=true）即可，否则个人中心还会挂着「去绑定」的卡片。
 */
export async function bindPhoneByWechat(dynamicCode: string) {
  return (await apiRequest<{ user: UserProfile; bindingRequired: boolean; merged: boolean }>(
    '/api/miniapp/v1/auth/bind-phone', { method: 'POST', data: { method: 'wechat', code: dynamicCode } },
  )).data;
}

export async function sendPhoneCode(phone: string) {
  const response = await Taro.request<{ ok: boolean; msg?: string; cooldown?: number }>({
    url: `${API_BASE}/api/auth/phone-code`,
    method: 'POST',
    data: { phone },
    timeout: 15000,
    header: { 'Content-Type': 'application/json', ...requestHeaders() },
  });
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.data?.ok) {
    throw new ApiError('PHONE_CODE_FAILED', response.data?.msg || '验证码发送失败，请稍后重试', response.statusCode);
  }
  return response.data;
}

export function getMiniappToken() {
  return Taro.getStorageSync<string>(TOKEN_KEY);
}

export interface LegalAgreement { title?: string; content?: string; }

/** 拉取协议/条款内容（与网页端同源：/api/data/get-config → legalAgreements.{privacy,terms}）。 */
export async function getLegalAgreements(): Promise<{ privacy?: LegalAgreement; terms?: LegalAgreement }> {
  const response = await Taro.request<{ ok?: boolean; data?: { legalAgreements?: Record<string, LegalAgreement> } }>({
    url: `${API_BASE}/api/data/get-config`,
    method: 'GET',
    timeout: 15000,
    header: { 'Content-Type': 'application/json', ...requestHeaders() },
  });
  let body: { ok?: boolean; data?: { legalAgreements?: Record<string, LegalAgreement> } } | null = response.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as typeof response.data; } catch { body = null; }
  }
  if (response.statusCode < 200 || response.statusCode >= 300 || !body?.ok) {
    throw new ApiError('CONFIG_FAILED', '协议内容加载失败，请稍后重试', response.statusCode);
  }
  return body?.data?.legalAgreements || {};
}

export async function uploadRuntimeFile(payload: {
  targetType: 'agent' | 'workflow'; targetId: string; dataUrl: string; fileName: string; fileType: string;
}) {
  return (await apiRequest<{ kind: 'data-url' | 'coze-file'; dataUrl?: string; fileId?: string; fileName?: string }>(
    '/api/miniapp/v1/uploads', { method: 'POST', data: payload },
  )).data;
}

export async function saveRuntimeHistory(record: Record<string, unknown>) {
  return (await apiRequest<{ id: string }>('/api/miniapp/v1/history', { method: 'POST', data: { record } })).data;
}

export async function saveRuntimeAsset(item: Record<string, unknown>) {
  return (await apiRequest<Record<string, unknown>>('/api/miniapp/v1/assets', { method: 'POST', data: { item } })).data;
}

export async function submitWorkflowTask(workflowId: string, parameters: Record<string, unknown>, idempotencyKey: string) {
  return (await apiRequest<import('../types').RuntimeTask>(`/api/miniapp/v1/workflows/${encodeURIComponent(workflowId)}/tasks`, {
    method: 'POST', data: { parameters }, header: { 'Idempotency-Key': idempotencyKey },
  })).data;
}

export async function getRuntimeTask(taskId: string) {
  return (await apiRequest<import('../types').RuntimeTask>(`/api/miniapp/v1/tasks/${encodeURIComponent(taskId)}`)).data;
}

/** 按 id 拉取单条历史记录完整内容（消息/结果）。列表接口只返回轻量元数据，点开时才请求详情。 */
export async function getHistoryDetail(id: string) {
  return (await apiRequest<Record<string, unknown>>(`/api/miniapp/v1/history/${encodeURIComponent(id)}`)).data;
}

type StreamEvent = { event: string; data: unknown };

function decodeUtf8(bytes: ArrayBuffer, decoder?: TextDecoder) {
  if (decoder) return decoder.decode(bytes, { stream: true });
  const list = new Uint8Array(bytes);
  let binary = '';
  for (let index = 0; index < list.length; index += 1) binary += String.fromCharCode(list[index]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
}

/**
 * 从非 2xx 响应体里挖出服务端给的原因与错误码。
 *
 * 对话/工作流这条链路是按 SSE 分块读的，服务端拒绝时回的却是普通 JSON
 * （`{ ok:false, error:{ code, message } }`，见 server/miniapp-runtime.mjs）——
 * 它不会进 onEvent，不挖出来用户就只能看到一句「HTTP 403」，
 * 完全不知道是「VIP 专享」还是「内容已下架」。
 */
function parseErrorBody(text: string): { code: string; message: string } {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { code: '', message: '' };
  try {
    const body = JSON.parse(raw.slice(start, end + 1)) as { error?: { code?: string; message?: string } | string };
    const error = body && body.error;
    if (typeof error === 'string') return { code: '', message: error };
    return { code: String(error?.code || ''), message: String(error?.message || '') };
  } catch {
    return { code: '', message: '' };
  }
}

export async function streamAgentChat(
  agentId: string,
  payload: Record<string, unknown>,
  onEvent: (event: StreamEvent) => void,
) {
  await ensureMiniappSession();
  return new Promise<void>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const decoder = typeof TextDecoder === 'undefined' ? undefined : new TextDecoder('utf-8');
    const emitBlocks = () => {
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
        const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!raw) return;
        let data: unknown = raw;
        try { data = JSON.parse(raw); } catch { /* text event */ }
        try { onEvent({ event, data }); }
        catch (error) {
          if (!settled) { settled = true; reject(error); }
        }
      });
    };
    const token = getMiniappToken();
    const task = Taro.request({
      url: `${API_BASE}/api/miniapp/v1/agents/${encodeURIComponent(agentId)}/chat`,
      method: 'POST',
      data: payload,
      timeout: 300000,
      enableChunked: true,
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...requestHeaders() },
      success(response) {
        if (settled) return;
        if (response.statusCode >= 200 && response.statusCode < 300) { emitBlocks(); if (!settled) { settled = true; resolve(); } }
        else {
          settled = true;
          // 保留服务端给的原因与错误码（如 VIP_REQUIRED / AGENT_NOT_FOUND）：
          // 只回「HTTP 403」的话，用户看不到「为什么不能聊」，我们也没法按码做引导。
          const { code, message } = parseErrorBody(buffer);
          reject(new ApiError(code || 'CHAT_FAILED', message || `对话请求失败（HTTP ${response.statusCode}）`, response.statusCode));
        }
      },
      fail(error) { if (!settled) { settled = true; reject(new ApiError('CHAT_FAILED', error.errMsg || '对话请求失败')); } },
    });
    task.onChunkReceived(({ data }) => { if (!settled) { buffer += decodeUtf8(data, decoder); emitBlocks(); } });
  });
}

export async function reportClientError(payload: { page?: string; errorCode?: string; fingerprint?: string }) {
  try {
    await Taro.request({
      url: `${API_BASE}/api/miniapp/v1/client-errors`,
      method: 'POST',
      data: {
        page: String(payload.page || '/miniapp').slice(0, 180),
        errorCode: String(payload.errorCode || 'CLIENT_RENDER_ERROR').slice(0, 80),
        fingerprint: String(payload.fingerprint || '').slice(0, 80),
        environment: MINIAPP_ENVIRONMENT,
        version: MINIAPP_VERSION,
      },
      timeout: 3000,
      header: { 'Content-Type': 'application/json', ...requestHeaders() },
    });
  } catch {
    // Telemetry is best-effort and must never block the user.
  }
}
