import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  ['server/index.mjs', [
    "const DEEPSEEK_PLATFORM = 'deepseek-native'",
    "const DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro'])",
    "if (p === '/api/coze/chat')",
    "if (platform === DEEPSEEK_PLATFORM)",
    "apiKey: ''",
    "if (p === '/api/data/assets' && req.method === 'POST')",
    "if (p === '/api/admin/users/adjust-points' && req.method === 'POST')",
  ]],
  ['frontend/src/pages/AdminAgentEdit.jsx', [
    "{ key: 'coze-new'",
    "{ key: 'coze-old'",
    "{ key: 'deepseek-native'",
    'knowledgeBaseIds',
    'thinkingEnabled',
  ]],
  ['frontend/src/pages/AdminKnowledgeBases.jsx', [
    'createKnowledgeBase',
    'uploadKnowledgeDocument',
    'deleteKnowledgeBase',
  ]],
  ['frontend/src/pages/Chat.jsx', [
    'reasoning',
    'onDelta:',
  ]],
  ['frontend/src/cozeApi.js', [
    'res.body.getReader()',
    "new TextDecoder('utf-8')",
  ]],
];

const missing = [];
for (const [file, needles] of checks) {
  const source = read(file);
  for (const needle of needles) if (!source.includes(needle)) missing.push(`${file}: ${needle}`);
}

if (missing.length) {
  console.error('Stage D contract check failed:\n' + missing.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('Stage D provider, RAG, streaming, and persistence contract check passed.');
