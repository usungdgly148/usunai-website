import { adminFetch } from './authFetch.js';

async function request(url, options = {}) {
  const response = await adminFetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || '请求失败，请稍后重试');
  return body.data;
}

export const getMiniappLayout = (page) => request(`/api/admin/miniapp-layouts/${page}`);
export const saveMiniappLayoutDraft = (page, layout) => request(`/api/admin/miniapp-layouts/${page}/draft`, {
  method: 'PUT', body: JSON.stringify({ layout }),
});
export const publishMiniappLayout = (page, layout) => request(`/api/admin/miniapp-layouts/${page}/publish`, {
  method: 'POST', body: JSON.stringify({ layout }),
});
export const rollbackMiniappLayout = (page, versionId) => request(`/api/admin/miniapp-layouts/${page}/rollback`, {
  method: 'POST', body: JSON.stringify({ versionId }),
});
