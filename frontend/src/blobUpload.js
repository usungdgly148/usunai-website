// 图片上传统一入口：优先直传 EdgeOne Blob（线上），失败时返回 null 让调用方降级 base64 内联。
// 返回的 serve URL 是普通字符串，前端 <img src> 无感知（与 base64 data URL 用法一致）。
// 本地（无 Blob 后端）/ 未配置 Blob 时 /api/blob/upload-url 返回 {ok:false}，本函数返回 null。
// 2026-08-03 商用安全：上传经 apiFetch 携带登录会话 token。
import { apiFetch, adminFetch } from './authFetch.js';

export async function tryUploadToBlob(file, { admin = false } = {}) {
  if (!file) return null;
  const authenticatedFetch = admin ? adminFetch : apiFetch;
  const uploadBase = admin ? '/api/admin/blob' : '/api/blob';
  try {
    const resp = await authenticatedFetch(`${uploadBase}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, contentType: file.type || 'image/png' }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!data || !data.ok || !data.url || !data.key) return null;
    const put = await authenticatedFetch(data.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    });
    if (!put.ok) return null;
    return `/api/blob/serve?key=${encodeURIComponent(data.key)}`;
  } catch (e) {
    return null;
  }
}
