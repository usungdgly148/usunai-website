// 2026-08-03 商用安全：统一带会话 token 的 fetch 封装。
// token 存 localStorage（clone_token），登录成功写入、登出清除。
// 所有敏感接口（写/读用户数据）必须经 apiFetch 携带 Authorization: Bearer <token>。

const TOKEN_KEY = 'clone_token';
const ADMIN_TOKEN_KEY = 'clone_admin_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
export const setToken = (token) => {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};
export const clearToken = () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

// 2026-08-04：admin token 独立 key，与普通用户 token 隔离。
// 之前 admin login 用 saveToken() 写到 clone_token，会被前台手机用户 token 覆盖，
// 导致 admin 页 mount 时 refreshAllAdminLists 用错 token 拉不到全量数据。
export const getAdminToken = () => {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
};
export const setAdminToken = (token) => {
  try { if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token); else localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* ignore */ }
};
export const clearAdminToken = () => {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* ignore */ }
};

// 带 token 的 fetch：自动追加 Authorization 头，保持调用方其余参数不变。
// 若服务端返回 401，清除本地 token 并广播事件，由 store/App 统一处理登出/跳登录页。
// 2026-08-04：只用 clone_token（用户 token），绝不优先 admin token。
// 原因：admin token 调 `/api/auth/me` 会让服务端返回 admin user，导致 setUser(admin) 污染 user state，
// 前台 profile 直接显示 admin 资料。admin 接口必须用 adminFetch 显式调用。
export function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, { ...options, headers }).then((res) => {
    if (res.status === 401) {
      clearToken();
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('usun:unauthorized')); } catch { /* ignore */ }
    }
    return res;
  });
}

// 2026-08-04：admin 专用 fetch：用 clone_admin_token（与用户 token 隔离）。
// 用于后台所有读/写接口，确保 admin 页面始终用 admin 权限拉全量数据。
export function adminFetch(url, options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, { ...options, headers }).then((res) => {
    if (res.status === 401) {
      clearAdminToken();
      try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('usun:admin-unauthorized')); } catch { /* ignore */ }
    }
    return res;
  });
}
