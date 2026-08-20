import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['server/index.mjs', ['deepseek-native', '/api/deepseek/test', "event: message", 'kvRecordNativeUsage']],
  ['server/rag.mjs', ['qwen3.7-text-embedding', 'EMBEDDING_DIMENSIONS = 1024', '/api/admin/knowledge-bases', 'const uploadMatch']],
  ['frontend/src/pages/AdminAuthProviders.jsx', ['bailian-embedding', 'DeepSeek 原生模型', 'adminFetch']],
  ['frontend/src/pages/AdminKnowledgeBases.jsx', ['创建并上传文档', 'replaceKnowledgeDocument', 'deleteKnowledgeBase']],
  ['frontend/src/pages/AdminAgentEdit.jsx', ['deepseek-native', 'System Prompt', 'knowledgeBaseIds', 'ragThreshold']],
  ['frontend/src/pages/Chat.jsx', ['onReasoning', 'serverUsage', "agent.platform !== 'deepseek-native'", '查看思考过程']],
];

const missing = [];
for (const [file, needles] of checks) {
  const source = read(file);
  for (const needle of needles) if (!source.includes(needle)) missing.push(`${file}: ${needle}`);
}
if (missing.length) {
  console.error('Stage B contract check failed:\n' + missing.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('Stage B DeepSeek/RAG contract check passed.');
