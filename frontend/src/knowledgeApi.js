import { adminFetch } from './authFetch.js';

async function request(url, options = {}) {
  const response = await adminFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const listKnowledgeBases = () => request('/api/admin/knowledge-bases');
export const listKnowledgeDocuments = (kbId) => request(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents`);
export const createKnowledgeBase = (body) => request('/api/admin/knowledge-bases', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
export const updateKnowledgeBase = (id, body) => request(`/api/admin/knowledge-bases/${encodeURIComponent(id)}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
export const deleteKnowledgeBase = (id) => request(`/api/admin/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' });

function upload(url, file) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
}

export const uploadKnowledgeDocument = (kbId, file) => upload(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/documents/upload`, file);
export const replaceKnowledgeDocument = (docId, file) => upload(`/api/admin/knowledge-documents/${encodeURIComponent(docId)}/replace`, file);
export const deleteKnowledgeDocument = (docId) => request(`/api/admin/knowledge-documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
export const retryKnowledgeDocument = (docId) => request(`/api/admin/knowledge-documents/${encodeURIComponent(docId)}/retry`, { method: 'POST' });
export const testKnowledgeSearch = (kbId, body) => request(`/api/admin/knowledge-bases/${encodeURIComponent(kbId)}/search-test`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
