// 前端所有调用都走 /api（开发环境由 Vite 代理到本地后端，线上由 EdgeOne 函数处理）。
// 智能体连接配置由前端随请求携带，函数只做转发（带 Token 调扣子），避免浏览器直连扣子的 CORS 问题。
// 浏览器里不再出现任何扣子 Token。
// 2026-08-03 商用安全：所有请求经 apiFetch 携带登录会话 token（对话/工作流运行需登录）。
import { apiFetch, adminFetch } from './authFetch.js';

// 解析 SSE 文本流，回调每一条 event 的 type 与 payload
function parseSSE(buffer, onEvent) {
  const blocks = buffer.split(/\n\n|\r\n\r\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\n|\r\n/);
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    let payload;
    try { payload = JSON.parse(data); } catch { continue; }
    onEvent(event, payload);
  }
}

// 通过后端（EdgeOne 函数）发起扣子对话（SSE 流式）。
// 无状态函数环境无持久存储，前端随请求携带智能体的连接配置，函数只做转发（带 Token 调扣子）。
export async function chatWithAgent({ agentId, message, attachments, sessionId, onDelta, onReasoning, onUsage, signal, cfg }) {
  const body = {
    agentId,
    sessionId: sessionId || `s-${Date.now()}`,
    message,
  };
  if (Array.isArray(attachments) && attachments.length) {
    body.attachments = attachments.map((item) => ({
      kind: item.kind || 'image',
      name: item.name || '',
      url: item.url || '',
      mimeType: item.mimeType || '',
      size: Number(item.size) || 0,
    }));
  }
  // 携带连接配置（前端从 localStorage 读取），函数据此转发扣子
  if (cfg) {
    body.baseUrl = cfg.baseUrl || '';
    body.apiKey = cfg.apiKey || '';
    body.projectId = cfg.projectId || '';
    body.botId = cfg.botId || '';
    body.platform = cfg.platform || 'coze-new';
    body.authType = cfg.authType || 'apikey';
    body.userId = cfg.userId || 'local-user';
  }
  const res = await apiFetch('/api/coze/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    let msg = `请求失败（${res.status}）`;
    try {
      const t = await res.text();
      const j = JSON.parse(t);
      msg = j.error || t || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let streamError = null;
    parseSSE(buffer, (event, payload) => {
      if (payload?.type === 'answer' && payload?.content?.answer != null) onDelta?.(payload.content.answer);
      if (payload?.type === 'reasoning' && payload?.content?.reasoning != null) onReasoning?.(payload.content.reasoning);
      if (payload?.type === 'usage' && payload?.content?.usage != null) onUsage?.(payload.content.usage);
      if (payload?.type === 'error' || payload?.content?.error) streamError = payload.content?.error || '智能体执行出错';
    });
    if (streamError) throw new Error(streamError);
    const idx = buffer.lastIndexOf('\n\n');
    if (idx >= 0) buffer = buffer.slice(idx + 2);
  }
}

// 后台「测试连接 / 检测项目」：把表单配置发给后端，由后端带 Token 探测扣子。
export async function testAgentConfig(cfg) {
  const res = await adminFetch('/api/coze/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return await res.json();
}

// PAT 类型授权测试（旧版 Bot API / 工作流 API）
export async function testPatConnection(cfg) {
  return testAgentConfig({
    platform: 'coze-old',
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });
}

// API Token 类型授权测试（新版部署服务）
export async function testApiTokenConnection(cfg) {
  return testAgentConfig({
    platform: 'coze-new',
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    projectId: cfg.projectId,
  });
}

// OAuth 类型授权测试：让后端用私钥生成 JWT 后探测扣子
export async function testOAuthConnection(cfg) {
  return testAgentConfig({
    platform: 'coze-old',
    authType: 'oauth',
    baseUrl: cfg.baseUrl,
    clientId: cfg.clientId,
    keyId: cfg.keyId,
    privateKey: cfg.privateKey,
  });
}

// 上传本地文件到扣子，换取 file_id（用于 image / file 类型工作流输入参数）
// cfg: { baseUrl, authType, apiKey?, clientId?, keyId?, privateKey? }
// file: 浏览器 File 对象
// 返回 { ok, fileId, raw? }
export async function uploadCozeFile(cfg, file) {
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
    const res = await apiFetch('/api/coze/file-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...cfg,
        fileName: file.name || 'upload',
        fileType: file.type || 'application/octet-stream',
        dataUrl,
      }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '上传失败：' + String(e.message || e) };
  }
}

// 后台保存智能体配置到后端（Token 落服务端；前端本地仅存脱敏占位）。
export async function saveAgentConfig(id, cfg) {
  const res = await adminFetch(`/api/admin/agents/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  return await res.json();
}

// 拉取单个 agent 的服务端配置（仅元数据 + hasToken 标志，不返回真实 Token）
export async function getAgentConfig(id) {
  try {
    const res = await adminFetch(`/api/admin/agents/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// 拉取真实 Token 明文（仅 admin 后台眼睛图标点击时一次性调用，前端不缓存明文）
export async function revealAgentToken(id) {
  try {
    const res = await adminFetch(`/api/admin/agents/${encodeURIComponent(id)}/reveal-token`, {
      method: 'GET',
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/* ============================================================
 * 工作流（旧版扣子 /v1/workflow/run）
 * ============================================================ */

// 列出当前授权账号下可访问的工作空间（GET /v1/workspaces）
// cfg = { authProviderId, baseUrl }
export async function listCozeWorkspaces(cfg) {
  try {
    const res = await adminFetch('/api/coze/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 列出指定空间下的工作流
// cfg = { baseUrl, authType, apiKey, clientId, keyId, privateKey, workspaceId, pageNum, pageSize }
// 返回 { ok, items: [...], has_more }
export async function listCozeWorkflows(cfg) {
  try {
    const res = await adminFetch('/api/coze/workflow-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 获取单个工作流的输入/输出参数
// cfg = { baseUrl, authType, apiKey, clientId, keyId, privateKey, workflowId }
// 返回 { ok, workflow: {workflow_id, workflow_name, description}, inputs: [...], outputs: [...] }
export async function getCozeWorkflowInfo(cfg) {
  try {
    const res = await adminFetch('/api/coze/workflow-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 解析 SSE 文本流（旧版工作流是一次性 result/error 事件）
function parseWorkflowSSE(buffer, onEvent) {
  const blocks = buffer.split(/\n\n|\r\n\r\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\n|\r\n/);
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    let payload;
    try { payload = JSON.parse(data); } catch { payload = { raw: data }; }
    onEvent(event, payload);
  }
}

// 调用工作流（旧版扣子 /v1/workflow/run）
// cfg = { baseUrl, apiKey, workflowId, authType, userId, platform }
// parameters = 工作流入参对象
// 返回 Promise<{ ok, kind, text|json|imgs, ... }>
export async function runWorkflow({ parameters, cfg, signal, onChunk }) {
  const body = { ...(cfg || {}), parameters: parameters || {} };
  const res = await apiFetch('/api/coze/workflow-run', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      const t = await res.text();
      const j = JSON.parse(t);
      msg = j.error || t || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (!res.body) throw new Error('响应为空');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  return await new Promise((resolve, reject) => {
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          parseWorkflowSSE(buffer, (event, payload) => {
            if (event === 'error' || payload?.error) {
              reject(new Error(payload?.error || '工作流执行失败'));
              return;
            }
            if (event === 'result' || payload?.kind || payload?.text != null) {
              if (onChunk) onChunk(payload);
              resolve(payload);
            }
          });
          const idx = buffer.lastIndexOf('\n\n');
          if (idx >= 0) buffer = buffer.slice(idx + 2);
        }
        // 流结束但未收到 result，视为失败
        if (!buffer.trim()) return;
        reject(new Error('工作流响应未包含 result 事件'));
      } catch (e) {
        reject(e);
      }
    })();
  });
}

/* ============================================================
 * 旧版 Coze Bot（Bot ID + 授权中心凭证）
 * ============================================================ */

// 列出授权中心已开通的授权（供"选择授权凭证"下拉）
export async function listAuthProviders() {
  try {
    const res = await adminFetch('/api/admin/auth-providers', { method: 'GET' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 按授权凭证解析真实 token（供"测试连接"等使用）
export async function getCozeConnectInfo(authProviderId) {
  try {
    const res = await adminFetch('/api/coze/connect-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authProviderId }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 列出个人空间 / 空间下智能体
// cfg = { authProviderId, workspaceId?, mock?, pageNum, pageSize }
// 不带 workspaceId → 返回 { ok, workspaces:[...] }；带 workspaceId → 返回 { ok, bots:[...], has_more }
export async function listCozeBots(cfg) {
  try {
    const res = await adminFetch('/api/coze/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}

// 获取单个 Bot 详情（开场白 / 建议问题）
// cfg = { authProviderId, botId, mock? }
// 返回 { ok, bot: { bot_id, bot_name, description, icon_url, opening_dialog, suggested_questions } }
export async function getCozeBotDetail(cfg) {
  try {
    const res = await adminFetch('/api/coze/bot-detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg || {}),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: '网络错误：' + String(e.message || e) };
  }
}
