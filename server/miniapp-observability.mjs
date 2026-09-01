import crypto from 'node:crypto';

const METRIC_PREFIX = 'miniapp_metric_';
const MAX_METRICS = 50000;
const CLIENT_ERROR_LIMIT = 16 * 1024;
const clientErrorBuckets = new Map();
let writesSincePrune = 499;
let pruneInFlight = null;

function bounded(value, max = 120) {
  return String(value || '').replace(/[\r\n]/g, ' ').slice(0, max);
}

function safeEnvironment(value) {
  const normalized = bounded(value, 24).toLowerCase();
  return ['development', 'experience', 'production'].includes(normalized) ? normalized : 'unknown';
}

export function normalizeMiniappRoute(pathname) {
  return String(pathname || '')
    .replace(/(\/agents\/)[^/]+/g, '$1:id')
    .replace(/(\/workflows\/)[^/]+/g, '$1:id')
    .replace(/(\/tasks\/)[^/]+/g, '$1:id')
    .slice(0, 180);
}

export async function recordMiniappMetric(KV, event) {
  if (!KV?.kvPut) return;
  const createdAt = new Date().toISOString();
  const row = {
    kind: bounded(event.kind, 32),
    route: normalizeMiniappRoute(event.route),
    ok: event.ok === true,
    statusCode: Math.max(0, Number(event.statusCode) || 0),
    durationMs: Math.max(0, Math.round(Number(event.durationMs) || 0)),
    firstTokenMs: event.firstTokenMs == null ? null : Math.max(0, Math.round(Number(event.firstTokenMs) || 0)),
    clientEnvironment: safeEnvironment(event.clientEnvironment),
    clientVersion: bounded(event.clientVersion, 40),
    errorCode: bounded(event.errorCode, 80),
    requestId: bounded(event.requestId, 80),
    createdAt,
  };
  const suffix = crypto.randomBytes(5).toString('hex');
  const newestFirst = String(9999999999999 - Date.now()).padStart(13, '0');
  await KV.kvPut(`${METRIC_PREFIX}${newestFirst}_${suffix}`, row);
  writesSincePrune += 1;
  if (writesSincePrune >= 500 && !pruneInFlight && KV.kvList && KV.kvDelete) {
    writesSincePrune = 0;
    pruneInFlight = (async () => {
      const keys = await KV.kvList(METRIC_PREFIX, MAX_METRICS + 1);
      await Promise.all(keys.slice(MAX_METRICS).map((key) => KV.kvDelete(key)));
    })().finally(() => { pruneInFlight = null; });
    void pruneInFlight.catch(() => {});
  }
}

export function attachMiniappRequestMetric(req, res, KV, pathname) {
  if (!String(pathname).startsWith('/api/miniapp/v1/') || pathname === '/api/miniapp/v1/client-errors') return;
  const startedAt = Date.now();
  res.once('finish', () => {
    void recordMiniappMetric(KV, {
      kind: pathname === '/api/miniapp/v1/auth/login' ? 'login' : 'api',
      route: pathname,
      ok: res.statusCode >= 200 && res.statusCode < 400,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      clientEnvironment: req.headers['x-miniapp-environment'],
      clientVersion: req.headers['x-miniapp-version'],
      requestId: req.headers['x-request-id'],
    }).catch(() => {});
  });
}

function allowClientError(req) {
  const address = bounded(req.socket?.remoteAddress, 80) || 'unknown';
  const bucket = Math.floor(Date.now() / 60000);
  const key = `${address}:${bucket}`;
  const count = (clientErrorBuckets.get(key) || 0) + 1;
  clientErrorBuckets.set(key, count);
  if (clientErrorBuckets.size > 500) {
    for (const storedKey of clientErrorBuckets.keys()) {
      if (!storedKey.endsWith(`:${bucket}`)) clientErrorBuckets.delete(storedKey);
    }
  }
  return count <= 20;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

export function summarizeMiniappMetrics(rows, windowMinutes = 1440) {
  const minutes = Math.min(43200, Math.max(5, Number(windowMinutes) || 1440));
  const cutoff = Date.now() - minutes * 60000;
  const recent = rows.filter((row) => row && Date.parse(row.createdAt || 0) >= cutoff);
  const apiRows = recent.filter((row) => row.kind === 'api' || row.kind === 'login');
  const loginRows = recent.filter((row) => row.kind === 'login');
  const workflowRows = recent.filter((row) => row.kind === 'workflow');
  const chatRows = recent.filter((row) => row.kind === 'chat');
  return {
    windowMinutes: minutes,
    totals: {
      api: apiRows.length,
      login: loginRows.length,
      workflow: workflowRows.length,
      chat: chatRows.length,
      clientErrors: recent.filter((row) => row.kind === 'client-error').length,
    },
    apiLatencyMs: {
      p50: percentile(apiRows.map((row) => Number(row.durationMs)), 0.5),
      p95: percentile(apiRows.map((row) => Number(row.durationMs)), 0.95),
    },
    loginFailureRate: loginRows.length ? loginRows.filter((row) => !row.ok).length / loginRows.length : 0,
    workflowSuccessRate: workflowRows.length ? workflowRows.filter((row) => row.ok).length / workflowRows.length : 0,
    chatFirstTokenMs: {
      p50: percentile(chatRows.map((row) => Number(row.firstTokenMs)), 0.5),
      p95: percentile(chatRows.map((row) => Number(row.firstTokenMs)), 0.95),
    },
    recent: recent.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50),
  };
}

export async function handleMiniappObservability(req, res, url, deps) {
  if (url.pathname === '/api/miniapp/v1/client-errors' && req.method === 'POST') {
    if (!allowClientError(req)) {
      res.statusCode = 204;
      res.end();
      return true;
    }
    try {
      const body = await deps.readBody(req, CLIENT_ERROR_LIMIT);
      await recordMiniappMetric(deps.KV, {
        kind: 'client-error',
        route: body.page || '/miniapp',
        ok: false,
        statusCode: 0,
        durationMs: 0,
        clientEnvironment: req.headers['x-miniapp-environment'] || body.environment,
        clientVersion: req.headers['x-miniapp-version'] || body.version,
        errorCode: body.errorCode || 'CLIENT_RENDER_ERROR',
        requestId: body.fingerprint,
      });
    } catch {
      // Client telemetry must never affect the user flow.
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (url.pathname === '/api/admin/miniapp-metrics' && req.method === 'GET') {
    if (!deps.requireAdmin(req, res)) return true;
    const keys = await deps.KV.kvList(METRIC_PREFIX, 10000);
    const rows = (await Promise.all(keys.map((key) => deps.KV.kvGet(key)))).filter(Boolean);
    const data = summarizeMiniappMetrics(rows, url.searchParams.get('windowMinutes'));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: true, data }));
    return true;
  }

  return false;
}
