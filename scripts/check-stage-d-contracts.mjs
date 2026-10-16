import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [
  // 平台常量已收口到 native-platforms.mjs（原生模型平台集合的唯一实现）。
  ['server/native-platforms.mjs', [
    "DEEPSEEK_PLATFORM = 'deepseek-native'",
    "RELAY_PLATFORM = 'relay-native'",
    'export function isNativePlatform(platform) {',
  ]],
  ['server/index.mjs', [
    "const DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro'])",
    // 旧模型名（V4 Flash / V4 Flash Vision Exp）必须仍能被归一化到在售模型名：
    // 存量 agents 里还有旧名，缺了这段会让后台「保存智能体」直接 500。
    "const DEEPSEEK_MODEL_ALIASES = {",
    "function normalizeDeepseekModel(model) {",
    "if (p === '/api/coze/chat')",
    // DeepSeek 与外部中转站共用同一个原生模型分支。
    "if (isNativePlatform(platform)) {",
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
