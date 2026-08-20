// 单条 KV 同步（fail-silent）
// 用途：在 store.jsx 的所有 mutation 末尾调用一次，把当前记录镜像写一份到 KV 单条 key
// 命名：user_<id> / reg_<id> / order_<id> / compute_<id> / hist_<userId>_<id>
// 失败静默——绝不影响现有整表写入与 UI 行为；上线后作为"按 id 精确读/恢复"的备份层
// 决策 B：失败时 console.warn 即可，不弹 toast、不抛错。
// 重要：reg 与 user 的 id 可能相同但内容不同（reg 含 password 哈希、user 含 admin role），
//       所以必须分别走不同端点，写到不同命名空间。
// 2026-08-03 商用安全：所有请求经 apiFetch 携带登录会话 token；服务端校验
//   「普通用户只能写/删自己的记录」——游客写请求会被 401 拒绝，杜绝伪造。
import { apiFetch } from './authFetch.js';

const ENDPOINTS = {
  user:    { put: '/api/single-key/users/put',    del: '/api/single-key/users/delete' },
  reg:     { put: '/api/single-key/regs/put',     del: '/api/single-key/regs/delete' },
  order:   { put: '/api/single-key/orders/put',   del: '/api/single-key/orders/delete' },
  compute: { put: '/api/single-key/computes/put', del: '/api/single-key/computes/delete' },
  history: { put: '/api/single-key/history/put',  del: '/api/single-key/history/delete' },
};

const _post = (url, body) =>
  apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);

export async function tryWriteSingleKey(kind, record) {
  const ep = ENDPOINTS[kind];
  if (!ep || !record || !record.id) return;
  await _post(ep.put, { record });
}

export async function tryDeleteSingleKey(kind, id, extra) {
  const ep = ENDPOINTS[kind];
  if (!ep || !id) return;
  await _post(ep.del, { id, ...(extra || {}) });
}
