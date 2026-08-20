import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as KV from './kv-local.js';

const execFileAsync = promisify(execFile);
const DATA_DIR = process.env.USUN_DATA_DIR ? path.resolve(process.env.USUN_DATA_DIR) : path.resolve('data');
const FILE_ROOT = path.join(DATA_DIR, 'knowledge-files');
const COLLECTION = process.env.RAG_QDRANT_COLLECTION || 'usun_knowledge_v1';
const QDRANT_URL = String(process.env.RAG_QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/+$/, '');
const QDRANT_API_KEY = String(process.env.RAG_QDRANT_API_KEY || '');
const EMBEDDING_MODEL = 'qwen3.7-text-embedding';
const EMBEDDING_DIMENSIONS = 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 8_000_000;
const VALID_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'markdown']);
const VALID_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown', 'application/octet-stream',
]);
const ingestionLocks = new Set();
let decryptSecret = null;

export function configureKnowledgeService(options = {}) {
  decryptSecret = typeof options.decryptSecret === 'function' ? options.decryptSecret : null;
  fs.mkdirSync(FILE_ROOT, { recursive: true });
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function safeError(error) {
  const text = String(error?.message || error || '未知错误')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-***');
  return text.slice(0, 500);
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function cleanName(value, fallback = '') {
  return String(value || fallback).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim().slice(0, 160);
}

function fileExt(name) {
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  return ext === 'markdown' ? 'md' : ext;
}

function pointId(chunkId) {
  const hex = crypto.createHash('sha256').update(chunkId).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function requestJson(urlString, options = {}, body, maxBytes = 8 * 1024 * 1024) {
  const url = new URL(urlString);
  const client = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = payload.length;
  }
  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || (payload ? 'POST' : 'GET'),
      headers,
      timeout: options.timeoutMs || 60_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= maxBytes) chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ statusCode: response.statusCode, body: parsed, text });
          return;
        }
        const message = parsed?.error?.message || parsed?.message || text || `HTTP ${response.statusCode}`;
        const error = new Error(`${response.statusCode}: ${String(message).slice(0, 400)}`);
        error.statusCode = response.statusCode;
        reject(error);
      });
    });
    req.on('timeout', () => req.destroy(new Error('上游请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function qdrantHeaders() {
  return QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {};
}

async function qdrantRequest(resource, options = {}, body) {
  return requestJson(`${QDRANT_URL}${resource}`, { ...options, headers: { ...qdrantHeaders(), ...(options.headers || {}) } }, body);
}

async function ensureCollection() {
  try {
    const result = await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}`);
    const size = Number(result.body?.result?.config?.params?.vectors?.size);
    if (size && size !== EMBEDDING_DIMENSIONS) throw new Error(`Qdrant collection 维度为 ${size}，预期 ${EMBEDDING_DIMENSIONS}`);
    return;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}`, { method: 'PUT' }, {
    vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' },
    optimizers_config: { default_segment_number: 2 },
    on_disk_payload: true,
  });
  for (const field of ['kbId', 'docId']) {
    await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}/index`, { method: 'PUT' }, {
      field_name: field, field_schema: 'keyword',
    });
  }
}

async function deleteQdrantBy(field, value) {
  await ensureCollection();
  await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}/points/delete?wait=true`, { method: 'POST' }, {
    filter: { must: [{ key: field, match: { value } }] },
  });
}

function providerBaseUrl(provider) {
  const raw = String(provider?.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !(url.hostname === 'dashscope.aliyuncs.com' || url.hostname.endsWith('.maas.aliyuncs.com'))) {
    throw new Error('百炼 Base URL 必须使用阿里云官方 HTTPS 域名');
  }
  return raw;
}

async function getEmbeddingProvider(providerId) {
  if (!decryptSecret) throw new Error('知识库凭证解密服务未初始化');
  const stored = (await KV.kvGet('authProviders')) || [];
  const list = Array.isArray(stored) ? stored : Object.values(stored || {});
  const provider = list.find((item) => item && String(item.id) === String(providerId));
  if (!provider || provider.type !== 'bailian-embedding' || provider.status === 'disabled' || provider.status === 'inactive') {
    throw new Error('百炼向量授权不存在或未启用');
  }
  if (!provider.apiKeyEncrypted) throw new Error('百炼向量授权缺少 API Key');
  return {
    ...provider,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    baseUrl: providerBaseUrl(provider),
    apiKey: decryptSecret(provider.apiKeyEncrypted),
  };
}

async function embedTexts(provider, texts) {
  const input = Array.isArray(texts) ? texts : [texts];
  if (!input.length || input.length > 20) throw new Error('单次向量化文本数量必须为 1~20');
  const result = await requestJson(`${provider.baseUrl}/embeddings`, {
    method: 'POST',
    timeoutMs: 120_000,
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  }, {
    model: EMBEDDING_MODEL,
    input,
    dimensions: EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  }, 32 * 1024 * 1024);
  const rows = Array.isArray(result.body?.data) ? result.body.data.slice().sort((a, b) => a.index - b.index) : [];
  const vectors = rows.map((row) => row.embedding);
  if (vectors.length !== input.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error('百炼返回的向量数量或维度不正确');
  }
  return { vectors, usage: result.body?.usage || null };
}

export async function testEmbeddingProvider(providerId) {
  const startedAt = Date.now();
  const provider = await getEmbeddingProvider(providerId);
  const result = await embedTexts(provider, ['知识库向量服务连接测试']);
  return {
    ok: true,
    model: EMBEDDING_MODEL,
    dimensions: result.vectors[0]?.length || 0,
    latencyMs: Date.now() - startedAt,
  };
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)));
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

async function extractDocumentText(filePath, ext) {
  if (ext === 'txt' || ext === 'md') return normalizeText(await fs.promises.readFile(filePath, 'utf8'));
  if (ext === 'pdf') {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-'], { maxBuffer: MAX_EXTRACTED_CHARS * 2, timeout: 120_000 });
    return normalizeText(stdout);
  }
  if (ext === 'docx') {
    const { stdout } = await execFileAsync('unzip', ['-p', filePath, 'word/document.xml'], { maxBuffer: MAX_EXTRACTED_CHARS * 2, timeout: 120_000 });
    const text = decodeXmlEntities(String(stdout)
      .replace(/<w:tab\/?[^>]*>/g, '\t')
      .replace(/<w:br\/?[^>]*>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''));
    return normalizeText(text);
  }
  throw new Error('不支持的文件格式');
}

export function chunkKnowledgeText(text, options = {}) {
  const target = Math.max(400, Math.min(1400, Number(options.targetChars) || 900));
  const overlap = Math.max(60, Math.min(240, Number(options.overlapChars) || 140));
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= target) { units.push(paragraph); continue; }
    const sentences = paragraph.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
    let buffer = '';
    for (const sentence of sentences) {
      if (buffer && buffer.length + sentence.length > target) { units.push(buffer); buffer = ''; }
      if (sentence.length > target) {
        if (buffer) { units.push(buffer); buffer = ''; }
        for (let start = 0; start < sentence.length; start += target - overlap) units.push(sentence.slice(start, start + target));
      } else buffer += sentence;
    }
    if (buffer) units.push(buffer);
  }
  const chunks = [];
  let current = '';
  for (const unit of units) {
    if (!current) { current = unit; continue; }
    if (current.length + 2 + unit.length <= target) { current += `\n\n${unit}`; continue; }
    chunks.push(current);
    current = `${current.slice(-overlap)}\n\n${unit}`;
    if (current.length > target + overlap) current = current.slice(0, target + overlap);
  }
  if (current) chunks.push(current);
  return chunks.map((content, index) => ({ index, content: content.trim() })).filter((item) => item.content.length >= 10);
}

async function listByPrefix(prefix, limit = 5000) {
  const keys = await KV.kvList(prefix, limit);
  const items = [];
  for (const key of keys) {
    const item = await KV.kvGet(key);
    if (item) items.push(item);
  }
  return items;
}

async function updateKnowledgeBaseStats(kbId) {
  const kb = await KV.kvGet(`rag_kb_${kbId}`);
  if (!kb) return;
  const docs = (await listByPrefix('rag_doc_')).filter((doc) => doc.kbId === kbId);
  await KV.kvPut(`rag_kb_${kbId}`, {
    ...kb,
    documentCount: docs.length,
    readyDocumentCount: docs.filter((doc) => doc.status === 'ready').length,
    failedDocumentCount: docs.filter((doc) => doc.status === 'failed').length,
    processingDocumentCount: docs.filter((doc) => ['queued', 'processing'].includes(doc.status)).length,
    chunkCount: docs.reduce((sum, doc) => sum + (Number(doc.chunkCount) || 0), 0),
    updatedAt: new Date().toISOString(),
  });
}

async function processDocument(docId) {
  if (ingestionLocks.has(docId)) return;
  ingestionLocks.add(docId);
  try {
    const docKey = `rag_doc_${docId}`;
    let doc = await KV.kvGet(docKey);
    if (!doc) return;
    const kb = await KV.kvGet(`rag_kb_${doc.kbId}`);
    if (!kb) throw new Error('所属知识库不存在');
    const provider = await getEmbeddingProvider(kb.embeddingProviderId);
    doc = { ...doc, status: 'processing', error: '', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await KV.kvPut(docKey, doc);
    const text = await extractDocumentText(doc.filePath, doc.ext);
    if (!text) throw new Error('文档没有可提取的文本内容');
    const chunks = chunkKnowledgeText(text);
    if (!chunks.length) throw new Error('文档切分后没有有效内容');
    await ensureCollection();
    await deleteQdrantBy('docId', doc.id);
    const points = [];
    let embeddingTokens = 0;
    for (let offset = 0; offset < chunks.length; offset += 20) {
      const batch = chunks.slice(offset, offset + 20);
      const embedded = await embedTexts(provider, batch.map((item) => item.content));
      embeddingTokens += Number(embedded.usage?.total_tokens || embedded.usage?.prompt_tokens) || 0;
      for (let index = 0; index < batch.length; index++) {
        const chunk = batch[index];
        const chunkId = `${doc.id}_${chunk.index}`;
        points.push({
          id: pointId(chunkId), vector: embedded.vectors[index],
          payload: {
            kbId: doc.kbId, docId: doc.id, chunkId, chunkIndex: chunk.index,
            sourceName: doc.name, text: chunk.content,
          },
        });
      }
      if (points.length >= 100 || offset + 20 >= chunks.length) {
        await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}/points?wait=true`, { method: 'PUT', timeoutMs: 120_000 }, { points: points.splice(0) });
      }
    }
    const completedDoc = {
      ...doc, status: 'ready', chunkCount: chunks.length, characterCount: text.length,
      embeddingTokens, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: '',
    };
    await KV.kvPut(docKey, completedDoc);
    if (doc.replacesDocumentId) {
      const replaced = await KV.kvGet(`rag_doc_${doc.replacesDocumentId}`);
      if (replaced && replaced.kbId === doc.kbId && replaced.id !== doc.id) {
        await deleteDocument(replaced);
      }
      await KV.kvPut(docKey, { ...completedDoc, replacesDocumentId: '', replacedDocumentId: doc.replacesDocumentId });
    }
    await updateKnowledgeBaseStats(doc.kbId);
  } catch (error) {
    const doc = await KV.kvGet(`rag_doc_${docId}`);
    if (doc) {
      await KV.kvPut(`rag_doc_${docId}`, { ...doc, status: 'failed', error: safeError(error), updatedAt: new Date().toISOString() });
      await updateKnowledgeBaseStats(doc.kbId);
    }
  } finally {
    ingestionLocks.delete(docId);
  }
}

function enqueueDocument(docId) {
  setTimeout(() => processDocument(docId).catch(() => {}), 50);
}

export async function resumeKnowledgeIngestion() {
  const docs = await listByPrefix('rag_doc_');
  for (const doc of docs) {
    if (doc.status === 'queued' || doc.status === 'processing') {
      await KV.kvPut(`rag_doc_${doc.id}`, { ...doc, status: 'queued', updatedAt: new Date().toISOString() });
      enqueueDocument(doc.id);
    }
  }
}

function streamUpload(req, targetPath) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_FILE_BYTES) { reject(Object.assign(new Error('文件不能超过 20MB'), { statusCode: 413 })); return; }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.uploading`;
    const output = fs.createWriteStream(tempPath, { flags: 'wx' });
    const hash = crypto.createHash('sha256');
    let received = 0;
    let settled = false;
    const cleanup = () => fs.promises.unlink(tempPath).catch(() => {});
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      cleanup().finally(() => reject(error));
    };
    req.on('data', (chunk) => {
      received += chunk.length;
      hash.update(chunk);
      if (received > MAX_FILE_BYTES) fail(Object.assign(new Error('文件不能超过 20MB'), { statusCode: 413 }));
    });
    req.on('aborted', () => fail(new Error('上传已中断')));
    req.on('error', fail);
    output.on('error', fail);
    output.on('finish', async () => {
      if (settled) return;
      settled = true;
      try {
        await fs.promises.rename(tempPath, targetPath);
        resolve({ size: received, sha256: hash.digest('hex') });
      }
      catch (error) { await cleanup(); reject(error); }
    });
    req.pipe(output);
  });
}

async function searchKnowledge(kbIds, query, options = {}) {
  const active = [];
  for (const kbId of kbIds) {
    const kb = await KV.kvGet(`rag_kb_${kbId}`);
    if (kb && kb.status !== 'disabled' && kb.status !== 'inactive') active.push(kb);
  }
  if (!active.length) return { hits: [], retrievalMs: 0 };
  const startedAt = Date.now();
  const provider = await getEmbeddingProvider(active[0].embeddingProviderId);
  const embedded = await embedTexts(provider, [query]);
  await ensureCollection();
  const limit = Math.max(1, Math.min(10, Number(options.topK) || 5));
  const threshold = Math.max(0, Math.min(1, Number(options.threshold) || 0.4));
  const result = await qdrantRequest(`/collections/${encodeURIComponent(COLLECTION)}/points/query`, { method: 'POST' }, {
    query: embedded.vectors[0],
    filter: { must: [{ key: 'kbId', match: { any: active.map((item) => item.id) } }] },
    limit, score_threshold: threshold, with_payload: true,
  });
  const rows = Array.isArray(result.body?.result?.points) ? result.body.result.points : [];
  return {
    retrievalMs: Date.now() - startedAt,
    hits: rows.map((row) => ({
      score: Number(row.score) || 0,
      kbId: row.payload?.kbId || '', docId: row.payload?.docId || '', chunkId: row.payload?.chunkId || '',
      sourceName: row.payload?.sourceName || '', chunkIndex: Number(row.payload?.chunkIndex) || 0,
      text: String(row.payload?.text || ''),
    })),
  };
}

export async function retrieveKnowledgeContext(agent, query) {
  if (!agent?.ragEnabled) return { context: '', hits: [], retrievalMs: 0 };
  const kbIds = Array.isArray(agent.knowledgeBaseIds) ? agent.knowledgeBaseIds.filter(Boolean).slice(0, 20) : [];
  if (!kbIds.length) return { context: '', hits: [], retrievalMs: 0 };
  const result = await searchKnowledge(kbIds, query, { topK: agent.ragTopK, threshold: agent.ragThreshold });
  const context = result.hits.map((hit, index) => `[资料 ${index + 1}｜${hit.sourceName}]\n${hit.text}`).join('\n\n');
  return { ...result, context };
}

async function deleteDocument(doc) {
  await deleteQdrantBy('docId', doc.id).catch(() => {});
  await fs.promises.unlink(doc.filePath).catch(() => {});
  await KV.kvDelete(`rag_doc_${doc.id}`);
  await updateKnowledgeBaseStats(doc.kbId);
}

async function getKnowledgeBaseBindings(kbId, options = {}) {
  let agentMap = typeof options.getAgents === 'function' ? options.getAgents() : null;
  if (!agentMap || typeof agentMap !== 'object' || Array.isArray(agentMap)) {
    agentMap = (await KV.kvGet('agents')) || {};
  }
  return Object.entries(agentMap)
    .filter(([, agent]) => Array.isArray(agent?.knowledgeBaseIds) && agent.knowledgeBaseIds.includes(kbId))
    .map(([agentId, agent]) => ({ id: agentId, name: String(agent.name || agent.title || agentId) }));
}

export async function handleKnowledgeAdminRoute(req, res, url, options = {}) {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/admin/knowledge')) return false;
  if (!options.requireAdmin?.(req, res)) return true;
  try {
    if (pathname === '/api/admin/knowledge-health' && req.method === 'GET') {
      await ensureCollection();
      json(res, 200, { ok: true, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, qdrant: true });
      return true;
    }
    if (pathname === '/api/admin/knowledge-bases' && req.method === 'GET') {
      const items = await listByPrefix('rag_kb_');
      const documents = await listByPrefix('rag_doc_');
      const enriched = await Promise.all(items.map(async (item) => {
        const docs = documents.filter((doc) => doc.kbId === item.id);
        const boundAgents = await getKnowledgeBaseBindings(item.id, options);
        return {
          ...item,
          documentCount: docs.length,
          readyDocumentCount: docs.filter((doc) => doc.status === 'ready').length,
          failedDocumentCount: docs.filter((doc) => doc.status === 'failed').length,
          processingDocumentCount: docs.filter((doc) => ['queued', 'processing'].includes(doc.status)).length,
          chunkCount: docs.reduce((sum, doc) => sum + (Number(doc.chunkCount) || 0), 0),
          boundAgentCount: boundAgents.length,
          boundAgents,
        };
      }));
      enriched.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      json(res, 200, { ok: true, items: enriched });
      return true;
    }
    if (pathname === '/api/admin/knowledge-bases' && req.method === 'POST') {
      const body = await options.readBody(req);
      const now = new Date().toISOString();
      const item = {
        id: id('kb'), name: cleanName(body.name, '未命名知识库').slice(0, 80),
        description: String(body.description || '').trim().slice(0, 500),
        embeddingProviderId: String(body.embeddingProviderId || ''),
        model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS,
        status: body.status === 'inactive' ? 'inactive' : 'active',
        documentCount: 0, readyDocumentCount: 0, chunkCount: 0, createdAt: now, updatedAt: now,
      };
      await getEmbeddingProvider(item.embeddingProviderId);
      await KV.kvPut(`rag_kb_${item.id}`, item);
      json(res, 201, { ok: true, item });
      return true;
    }
    const kbMatch = pathname.match(/^\/api\/admin\/knowledge-bases\/([^/]+)$/);
    if (kbMatch && req.method === 'PUT') {
      const kbId = kbMatch[1];
      const existing = await KV.kvGet(`rag_kb_${kbId}`);
      if (!existing) { json(res, 404, { ok: false, error: '知识库不存在' }); return true; }
      const body = await options.readBody(req);
      const next = {
        ...existing,
        name: cleanName(body.name, existing.name).slice(0, 80),
        description: String(body.description ?? existing.description ?? '').trim().slice(0, 500),
        embeddingProviderId: String(body.embeddingProviderId || existing.embeddingProviderId || ''),
        status: body.status === 'inactive' ? 'inactive' : 'active',
        model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, updatedAt: new Date().toISOString(),
      };
      await getEmbeddingProvider(next.embeddingProviderId);
      await KV.kvPut(`rag_kb_${kbId}`, next);
      json(res, 200, { ok: true, item: next });
      return true;
    }
    if (kbMatch && req.method === 'DELETE') {
      const kbId = kbMatch[1];
      const existing = await KV.kvGet(`rag_kb_${kbId}`);
      if (!existing) { json(res, 404, { ok: false, error: '知识库不存在' }); return true; }
      const boundAgents = await getKnowledgeBaseBindings(kbId, options);
      if (boundAgents.length) {
        json(res, 409, {
          ok: false,
          error: `该知识库仍绑定 ${boundAgents.length} 个智能体，请先解除绑定后再删除`,
          boundAgents,
        });
        return true;
      }
      const docs = (await listByPrefix('rag_doc_')).filter((doc) => doc.kbId === kbId);
      for (const doc of docs) await deleteDocument(doc);
      await deleteQdrantBy('kbId', kbId).catch(() => {});
      await KV.kvDelete(`rag_kb_${kbId}`);
      json(res, 200, { ok: true });
      return true;
    }
    const docsMatch = pathname.match(/^\/api\/admin\/knowledge-bases\/([^/]+)\/documents$/);
    if (docsMatch && req.method === 'GET') {
      const items = (await listByPrefix('rag_doc_')).filter((doc) => doc.kbId === docsMatch[1]);
      items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      json(res, 200, { ok: true, items: items.map(({ filePath, ...safe }) => safe) });
      return true;
    }
    const uploadMatch = pathname.match(/^\/api\/admin\/knowledge-bases\/([^/]+)\/documents\/upload$/);
    if (uploadMatch && req.method === 'POST') {
      const kb = await KV.kvGet(`rag_kb_${uploadMatch[1]}`);
      if (!kb) { json(res, 404, { ok: false, error: '知识库不存在' }); return true; }
      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
      const name = cleanName(rawName);
      const ext = fileExt(name);
      const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
      if (!name || !VALID_EXTENSIONS.has(ext) || !VALID_MIME.has(mime)) {
        json(res, 400, { ok: false, error: '仅支持 PDF、DOCX、TXT、Markdown 文件' }); return true;
      }
      const docId = id('doc');
      const targetPath = path.join(FILE_ROOT, kb.id, `${docId}.${ext}`);
      const { size, sha256 } = await streamUpload(req, targetPath);
      if (!size) { await fs.promises.unlink(targetPath).catch(() => {}); json(res, 400, { ok: false, error: '文件为空' }); return true; }
      const duplicate = (await listByPrefix('rag_doc_')).find(
        (doc) => doc.kbId === kb.id && doc.sha256 === sha256,
      );
      if (duplicate) {
        await fs.promises.unlink(targetPath).catch(() => {});
        json(res, 409, { ok: false, error: `该文件已存在：${duplicate.name}` });
        return true;
      }
      const now = new Date().toISOString();
      const doc = { id: docId, kbId: kb.id, name, ext, mime, size, sha256, filePath: targetPath, status: 'queued', chunkCount: 0, error: '', createdAt: now, updatedAt: now };
      await KV.kvPut(`rag_doc_${doc.id}`, doc);
      await updateKnowledgeBaseStats(kb.id);
      enqueueDocument(doc.id);
      const { filePath, ...safe } = doc;
      json(res, 201, { ok: true, item: safe });
      return true;
    }
    const searchMatch = pathname.match(/^\/api\/admin\/knowledge-bases\/([^/]+)\/search-test$/);
    if (searchMatch && req.method === 'POST') {
      const body = await options.readBody(req);
      const query = String(body.query || '').trim().slice(0, 4000);
      if (!query) { json(res, 400, { ok: false, error: '请输入测试问题' }); return true; }
      const result = await searchKnowledge([searchMatch[1]], query, { topK: body.topK, threshold: body.threshold });
      json(res, 200, { ok: true, ...result });
      return true;
    }
    const docMatch = pathname.match(/^\/api\/admin\/knowledge-documents\/([^/]+)$/);
    if (docMatch && req.method === 'DELETE') {
      const doc = await KV.kvGet(`rag_doc_${docMatch[1]}`);
      if (!doc) { json(res, 404, { ok: false, error: '文档不存在' }); return true; }
      await deleteDocument(doc);
      json(res, 200, { ok: true });
      return true;
    }
    const replaceMatch = pathname.match(/^\/api\/admin\/knowledge-documents\/([^/]+)\/replace$/);
    if (replaceMatch && req.method === 'POST') {
      const original = await KV.kvGet(`rag_doc_${replaceMatch[1]}`);
      if (!original) { json(res, 404, { ok: false, error: '原文档不存在' }); return true; }
      const kb = await KV.kvGet(`rag_kb_${original.kbId}`);
      if (!kb) { json(res, 404, { ok: false, error: '所属知识库不存在' }); return true; }
      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || ''));
      const name = cleanName(rawName);
      const ext = fileExt(name);
      const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
      if (!name || !VALID_EXTENSIONS.has(ext) || !VALID_MIME.has(mime)) {
        json(res, 400, { ok: false, error: '仅支持 PDF、DOCX、TXT、Markdown 文件' }); return true;
      }
      const docId = id('doc');
      const targetPath = path.join(FILE_ROOT, kb.id, `${docId}.${ext}`);
      const { size, sha256 } = await streamUpload(req, targetPath);
      if (!size) { await fs.promises.unlink(targetPath).catch(() => {}); json(res, 400, { ok: false, error: '文件为空' }); return true; }
      const duplicate = (await listByPrefix('rag_doc_')).find(
        (doc) => doc.kbId === kb.id && doc.id !== original.id && doc.sha256 === sha256,
      );
      if (duplicate) {
        await fs.promises.unlink(targetPath).catch(() => {});
        json(res, 409, { ok: false, error: `该文件已存在：${duplicate.name}` });
        return true;
      }
      const now = new Date().toISOString();
      const doc = {
        id: docId, kbId: kb.id, name, ext, mime, size, sha256, filePath: targetPath,
        status: 'queued', chunkCount: 0, error: '', replacesDocumentId: original.id,
        createdAt: now, updatedAt: now,
      };
      await KV.kvPut(`rag_doc_${doc.id}`, doc);
      await updateKnowledgeBaseStats(kb.id);
      enqueueDocument(doc.id);
      const { filePath, ...safe } = doc;
      json(res, 201, { ok: true, item: safe });
      return true;
    }
    const retryMatch = pathname.match(/^\/api\/admin\/knowledge-documents\/([^/]+)\/retry$/);
    if (retryMatch && req.method === 'POST') {
      const doc = await KV.kvGet(`rag_doc_${retryMatch[1]}`);
      if (!doc) { json(res, 404, { ok: false, error: '文档不存在' }); return true; }
      await KV.kvPut(`rag_doc_${doc.id}`, { ...doc, status: 'queued', error: '', updatedAt: new Date().toISOString() });
      enqueueDocument(doc.id);
      json(res, 200, { ok: true });
      return true;
    }
    json(res, 404, { ok: false, error: '知识库接口不存在' });
    return true;
  } catch (error) {
    json(res, Number(error.statusCode) || 500, { ok: false, error: safeError(error) });
    return true;
  }
}

export const RAG_CONSTANTS = Object.freeze({
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  maxFileBytes: MAX_FILE_BYTES,
});
