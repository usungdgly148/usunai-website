import Taro from '@tarojs/taro';
import type { ApiEnvelope, MiniappLayout, PublicContent, UserProfile } from '../types';

export const API_BASE = __MINIAPP_API_BASE__;
export const MINIAPP_ENVIRONMENT = __MINIAPP_ENV__;
export const MINIAPP_VERSION = __MINIAPP_VERSION__;
export const MINIAPP_BUILD = __MINIAPP_BUILD__;
const TOKEN_KEY = 'usunai_miniapp_token';
const BINDING_KEY = 'usunai_miniapp_binding_required';
const CONTENT_CACHE_KEY = 'usunai_miniapp_content_v1';
const CONTENT_TTL = 5 * 60 * 1000;
const LAYOUT_TTL = 60 * 1000;
let loginPromise: Promise<string> | null = null;

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

export async function ensureMiniappSession(force = false): Promise<string> {
  const stored = Taro.getStorageSync<string>(TOKEN_KEY);
  if (stored && !force) return stored;
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const login = await Taro.login();
    const response = await rawRequest<{ token: string; user: UserProfile; bindingRequired: boolean }>('/api/miniapp/v1/auth/login', {
      method: 'POST', data: { code: login.code }, auth: false,
    });
    Taro.setStorageSync(TOKEN_KEY, response.data.token);
    Taro.setStorageSync(BINDING_KEY, response.data.bindingRequired);
    return response.data.token;
  })();
  try { return await loginPromise; } finally { loginPromise = null; }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  if (options.auth !== false) await ensureMiniappSession();
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (options.auth !== false && error instanceof ApiError && error.statusCode === 401) {
      Taro.removeStorageSync(TOKEN_KEY);
      await ensureMiniappSession(true);
      return rawRequest<T>(path, options);
    }
    throw error;
  }
}

export async function getPublicContent(force = false): Promise<PublicContent> {
  const cached = Taro.getStorageSync<{ savedAt: number; data: PublicContent }>(CONTENT_CACHE_KEY);
  if (!force && cached?.data && Date.now() - cached.savedAt < CONTENT_TTL) return cached.data;
  try {
    const response = await apiRequest<PublicContent>('/api/miniapp/v1/content', { auth: false });
    Taro.setStorageSync(CONTENT_CACHE_KEY, { savedAt: Date.now(), data: response.data });
    return response.data;
  } catch (error) {
    if (cached?.data) return cached.data;
    throw error;
  }
}

const DEFAULT_LAYOUTS: Record<'home' | 'category', MiniappLayout> = {
  home: { page: 'home', blocks: ['carousel', 'announcements', 'search', 'categories', 'featured-agents', 'featured-workflows', 'quick-links'].map((type, index) => ({ id: `${type}-${index}`, type: type as MiniappLayout['blocks'][number]['type'], visible: true, spacing: 16, limit: 8 })) },
  category: { page: 'category', blocks: ['search', 'categories', 'featured-agents', 'featured-workflows'].map((type, index) => ({ id: `${type}-${index}`, type: type as MiniappLayout['blocks'][number]['type'], visible: true, spacing: 16, limit: 12 })) },
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

export function isBindingRequired() {
  return !!Taro.getStorageSync<boolean>(BINDING_KEY);
}

export function storeBoundSession(token: string) {
  Taro.setStorageSync(TOKEN_KEY, token);
  Taro.setStorageSync(BINDING_KEY, false);
}

export async function getPagedRecords(path: 'assets' | 'compute-records' | 'orders' | 'history', page: number, pageSize = 12) {
  const response = await apiRequest<Array<Record<string, unknown>>>(`/api/miniapp/v1/${path}?page=${page}&pageSize=${pageSize}`);
  return { items: response.data, pagination: response.meta };
}

export async function bindWebsiteAccount(payload: { method: 'email'; email: string; password: string } | { method: 'phone'; phone: string; code: string }) {
  return (await apiRequest<{ token: string; user: UserProfile; bindingRequired: boolean }>('/api/miniapp/v1/auth/bind', {
    method: 'POST',
    data: payload,
  })).data;
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

type StreamEvent = { event: string; data: unknown };

function decodeUtf8(bytes: ArrayBuffer, decoder?: TextDecoder) {
  if (decoder) return decoder.decode(bytes, { stream: true });
  const list = new Uint8Array(bytes);
  let binary = '';
  for (let index = 0; index < list.length; index += 1) binary += String.fromCharCode(list[index]);
  try { return decodeURIComponent(escape(binary)); } catch { return binary; }
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
        else { settled = true; reject(new ApiError('CHAT_FAILED', `对话请求失败（HTTP ${response.statusCode}）`, response.statusCode)); }
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
