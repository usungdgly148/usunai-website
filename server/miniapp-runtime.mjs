import crypto from 'node:crypto';
import http from 'node:http';
import { errorEnvelope, requestIdFor, sendJson, successEnvelope } from './miniapp-api.mjs';

const JSON_LIMIT = 35 * 1024 * 1024;
const TASK_RESULT_LIMIT = 12 * 1024 * 1024;

function miniappUser(req, res, requestId, { getSession, isAdminSession }) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, errorEnvelope('AUTH_REQUIRED', '请先登录', requestId), requestId);
    return null;
  }
  if (isAdminSession(session) || session.client !== 'miniapp' || !session.identityKey) {
    sendJson(res, 403, errorEnvelope('MINIAPP_SESSION_REQUIRED', '当前会话不能访问小程序运行接口', requestId), requestId);
    return null;
  }
  return session;
}

function authHeader(req) {
  return String(req.headers.authorization || '');
}

function proxyRequest(port, path, authorization, body, onResponse) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}));
    const upstream = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    }, (response) => onResponse(response, resolve, reject));
    upstream.setTimeout(660000, () => upstream.destroy(new Error('上游请求超时')));
    upstream.on('error', reject);
    upstream.end(payload);
  });
}

async function readResponse(response, limit = TASK_RESULT_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) throw new Error('上游响应过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function requestJson(port, path, authorization, body) {
  return proxyRequest(port, path, authorization, body, async (response, resolve, reject) => {
    try {
      const text = await readResponse(response);
      let data = null;
      try { data = JSON.parse(text); } catch { data = { ok: false, error: text || '上游返回格式错误' }; }
      resolve({ statusCode: response.statusCode || 502, data });
    } catch (error) { reject(error); }
  });
}

export function parseSseResult(text) {
  let result = null;
  let error = '';
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const event = block.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim() || '';
    const raw = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!raw) continue;
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    if (event === 'error' || value?.type === 'error') {
      error = String(value?.content?.error || value?.error || raw);
    } else if (value?.type === 'message') {
      result = value.content;
    } else if (value?.kind || value?.text || value?.data || value?.url) {
      result = value;
    }
  }
  return { result, error };
}

export function taskKeysFor(userId, idempotencyKey) {
  const digest = crypto.createHash('sha256').update(`${userId}\n${idempotencyKey}`).digest('hex');
  return { idempotencyKey: `miniapp_task_request_${digest}`, taskId: `mt_${digest.slice(0, 24)}` };
}

function taskStorageKey(taskId) {
  return `miniapp_task_${String(taskId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`;
}

async function loadPublishedWorkflow(KV, id) {
  const stored = await KV.kvGet('workflows');
  const list = Array.isArray(stored) ? stored : Object.values(stored || {});
  return list.find((item) => item && item.published === true && String(item.id) === String(id)) || null;
}

function loadPublishedAgent(getAgents, id) {
  const stored = getAgents();
  const list = Array.isArray(stored) ? stored : Object.values(stored || {});
  return list.find((item) => item && item.published === true && String(item.id) === String(id)) || null;
}

async function runWorkflowTask({ KV, port, authorization, task, parameters }) {
  const key = taskStorageKey(task.id);
  const running = { ...task, status: 'running', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await KV.kvPut(key, running);
  try {
    const response = await proxyRequest(port, '/api/coze/workflow-run', authorization, {
      id: task.workflowId,
      parameters,
      ext: { miniappTaskId: task.id },
    }, async (upstream, resolve, reject) => {
      try { resolve({ statusCode: upstream.statusCode || 502, text: await readResponse(upstream) }); } catch (error) { reject(error); }
    });
    const parsed = parseSseResult(response.text);
    if (response.statusCode >= 400 || parsed.error || !parsed.result) {
      throw new Error(parsed.error || `工作流运行失败（HTTP ${response.statusCode}）`);
    }
    await KV.kvPut(key, {
      ...running,
      status: 'succeeded',
      result: parsed.result,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    await KV.kvPut(key, {
      ...running,
      status: 'failed',
      error: String(error.message || error).slice(0, 500),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function handleMiniappRuntime(req, res, url, deps) {
  const path = url.pathname;
  if (!path.startsWith('/api/miniapp/v1/')) return false;
  const isRuntimePath = /^\/api\/miniapp\/v1\/(?:agents\/[^/]+\/chat|uploads|workflows\/[^/]+\/tasks|tasks\/[^/]+|history|assets)$/.test(path);
  if (!isRuntimePath) return false;

  const requestId = requestIdFor(req);
  const session = miniappUser(req, res, requestId, deps);
  if (!session) return true;
  const authorization = authHeader(req);
  const userId = String(session.userId);

  try {
    const chatMatch = path.match(/^\/api\/miniapp\/v1\/agents\/([^/]+)\/chat$/);
    if (chatMatch && req.method === 'POST') {
      const agentId = decodeURIComponent(chatMatch[1]);
      if (!loadPublishedAgent(deps.getAgents, agentId)) {
        sendJson(res, 404, errorEnvelope('AGENT_NOT_FOUND', '智能体不存在或未上架', requestId), requestId);
        return true;
      }
      const body = await deps.readBody(req, JSON_LIMIT);
      await proxyRequest(deps.port, '/api/coze/chat', authorization, { ...body, agentId }, (upstream, resolve) => {
        res.statusCode = upstream.statusCode || 502;
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        upstream.pipe(res);
        upstream.on('end', resolve);
      });
      return true;
    }

    if (path === '/api/miniapp/v1/uploads' && req.method === 'POST') {
      const body = await deps.readBody(req, JSON_LIMIT);
      const targetType = body.targetType === 'workflow' ? 'workflow' : 'agent';
      const targetId = String(body.targetId || '');
      let target = null;
      if (targetType === 'workflow') target = await loadPublishedWorkflow(deps.KV, targetId);
      else target = loadPublishedAgent(deps.getAgents, targetId);
      if (!target) {
        sendJson(res, 404, errorEnvelope('TARGET_NOT_FOUND', '目标不存在或未上架', requestId), requestId);
        return true;
      }
      if (target.platform === 'deepseek-native') {
        sendJson(res, 200, successEnvelope({ kind: 'data-url', dataUrl: body.dataUrl, fileName: body.fileName || '' }, requestId), requestId);
        return true;
      }
      if (!target.authProviderId) {
        sendJson(res, 400, errorEnvelope('UPLOAD_NOT_CONFIGURED', '该项目未配置可用的文件上传授权', requestId), requestId);
        return true;
      }
      const uploaded = await requestJson(deps.port, '/api/coze/file-upload', authorization, {
        authProviderId: target.authProviderId,
        dataUrl: body.dataUrl,
        fileName: body.fileName,
        fileType: body.fileType,
      });
      if (uploaded.statusCode >= 400 || !uploaded.data?.ok || !uploaded.data?.fileId) {
        sendJson(res, uploaded.statusCode >= 400 ? uploaded.statusCode : 502,
          errorEnvelope('UPLOAD_FAILED', uploaded.data?.error || '文件上传失败', requestId), requestId);
        return true;
      }
      sendJson(res, 200, successEnvelope({ kind: 'coze-file', fileId: uploaded.data.fileId }, requestId), requestId);
      return true;
    }

    const submitMatch = path.match(/^\/api\/miniapp\/v1\/workflows\/([^/]+)\/tasks$/);
    if (submitMatch && req.method === 'POST') {
      const workflowId = decodeURIComponent(submitMatch[1]);
      const workflow = await loadPublishedWorkflow(deps.KV, workflowId);
      if (!workflow) {
        sendJson(res, 404, errorEnvelope('WORKFLOW_NOT_FOUND', '工作流不存在或未上架', requestId), requestId);
        return true;
      }
      const idempotency = String(req.headers['idempotency-key'] || '').trim();
      if (!idempotency || idempotency.length > 160) {
        sendJson(res, 400, errorEnvelope('IDEMPOTENCY_KEY_REQUIRED', '提交任务需要合法的幂等键', requestId), requestId);
        return true;
      }
      const keys = taskKeysFor(userId, idempotency);
      const existing = await deps.KV.kvGet(keys.idempotencyKey);
      if (existing?.taskId) {
        const storedTask = await deps.KV.kvGet(taskStorageKey(existing.taskId));
        sendJson(res, 200, successEnvelope(storedTask || { id: existing.taskId, status: 'queued' }, requestId), requestId);
        return true;
      }
      const body = await deps.readBody(req, JSON_LIMIT);
      const now = new Date().toISOString();
      const task = { id: keys.taskId, userId, workflowId, name: workflow.name || '', status: 'queued', createdAt: now, updatedAt: now };
      await deps.KV.kvPut(taskStorageKey(task.id), task);
      await deps.KV.kvPut(keys.idempotencyKey, { taskId: task.id, userId, createdAt: now });
      void runWorkflowTask({ KV: deps.KV, port: deps.port, authorization, task, parameters: body.parameters || {} });
      sendJson(res, 202, successEnvelope(task, requestId), requestId);
      return true;
    }

    const taskMatch = path.match(/^\/api\/miniapp\/v1\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      const task = await deps.KV.kvGet(taskStorageKey(decodeURIComponent(taskMatch[1])));
      if (!task || String(task.userId) !== userId) {
        sendJson(res, 404, errorEnvelope('TASK_NOT_FOUND', '任务不存在', requestId), requestId);
        return true;
      }
      sendJson(res, 200, successEnvelope(task, requestId), requestId, 'no-store');
      return true;
    }

    if (path === '/api/miniapp/v1/history' && req.method === 'POST') {
      const body = await deps.readBody(req);
      const record = body.record && typeof body.record === 'object' ? body.record : null;
      if (!record?.id) {
        sendJson(res, 400, errorEnvelope('INVALID_HISTORY', '历史记录缺少 id', requestId), requestId);
        return true;
      }
      const safeId = deps.sanitizeId(String(record.id));
      await deps.KV.kvPut(`hist_${safeId}`, { ...record, id: safeId, userId });
      sendJson(res, 200, successEnvelope({ id: safeId }, requestId), requestId);
      return true;
    }

    if (path === '/api/miniapp/v1/assets' && req.method === 'POST') {
      const body = await deps.readBody(req, 8 * 1024 * 1024);
      const saved = await requestJson(deps.port, '/api/data/assets', authorization, { item: body.item });
      if (saved.statusCode >= 400 || !saved.data?.ok) {
        sendJson(res, saved.statusCode >= 400 ? saved.statusCode : 502,
          errorEnvelope('ASSET_SAVE_FAILED', saved.data?.msg || '资产保存失败', requestId), requestId);
        return true;
      }
      sendJson(res, 200, successEnvelope(saved.data, requestId), requestId);
      return true;
    }

    sendJson(res, 405, errorEnvelope('METHOD_NOT_ALLOWED', '该接口不支持当前请求方法', requestId), requestId);
    return true;
  } catch (error) {
    if (!res.writableEnded) {
      const statusCode = Number(error?.statusCode) || 500;
      sendJson(res, statusCode, errorEnvelope(statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'RUNTIME_ERROR',
        statusCode === 413 ? '请求内容过大' : '运行服务暂时不可用', requestId), requestId);
    }
    return true;
  }
}
