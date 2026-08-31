import Taro from '@tarojs/taro';
import type { ApiEnvelope, PublicContent, UserProfile } from '../types';

export const API_BASE = 'https://www.usunai.top';
const TOKEN_KEY = 'usunai_miniapp_token';
const BINDING_KEY = 'usunai_miniapp_binding_required';
const CONTENT_CACHE_KEY = 'usunai_miniapp_content_v1';
const CONTENT_TTL = 5 * 60 * 1000;
let loginPromise: Promise<string> | null = null;

export class ApiError extends Error {
  constructor(public code: string, message: string, public statusCode = 0) {
    super(message);
  }
}

interface RequestOptions { method?: 'GET' | 'POST'; data?: unknown; auth?: boolean; header?: Record<string, string>; }

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  const response = await Taro.request<ApiEnvelope<T>>({
    url: `${API_BASE}${path}`,
    method: options.method || 'GET',
    data: options.data,
    timeout: 15000,
    header: {
      'Content-Type': 'application/json',
      ...(options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.header || {}),
    },
  });
  const body = response.data;
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

export async function getPagedRecords(path: 'assets' | 'compute-records' | 'orders', page: number, pageSize = 12) {
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
    header: { 'Content-Type': 'application/json' },
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
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
