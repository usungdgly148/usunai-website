// 回归：外部大模型中转站（relay）接入契约
//
// 覆盖四层：
//   1. 纯函数真跑（从 server/index.mjs **抽取真实源码**执行，不是抄一份逻辑）
//   2. 上游请求体契约（中转站不得收到 DeepSeek 专有字段；DeepSeek 必须照旧收到）
//   3. 服务端接线契约（分发 / 保存校验 / 两个新端点 / 密钥不外泄）
//   4. 平台集合唯一性（四处分流必须都走 native-platforms.mjs，防止将来又硬编码）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const serverSrc = read('server/index.mjs');
const nativeSrc = read('server/native-platforms.mjs');
const miniappApiSrc = read('server/miniapp-api.mjs');
const miniappRuntimeSrc = read('server/miniapp-runtime.mjs');
const chatSrc = read('frontend/src/pages/Chat.jsx');
const agentEditSrc = read('frontend/src/pages/AdminAgentEdit.jsx');
const authProvidersSrc = read('frontend/src/pages/AdminAuthProviders.jsx');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
}

// 按大括号配平切出一整段函数源码（避免用正则截断）
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未找到函数 ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`函数 ${name} 大括号不配平`);
}
function sliceBetween(src, from, to) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error(`未找到起点 ${from}`);
  const j = src.indexOf(to, i + from.length);
  if (j < 0) throw new Error(`未找到终点 ${to}`);
  return src.slice(i, j);
}

// ---------- 1. 纯函数真跑（抽取真实源码） ----------
const pureFactory = new Function(`
${sliceFunction(serverSrc, 'normalizeRelayBaseUrl')}
${sliceFunction(serverSrc, 'relayEndpointUrl')}
return { normalizeRelayBaseUrl, relayEndpointUrl };
`);
const { normalizeRelayBaseUrl, relayEndpointUrl } = pureFactory();

check('Base URL 去掉尾部斜杠', normalizeRelayBaseUrl('https://api.easy88ai.com/v1/') === 'https://api.easy88ai.com/v1');
check('Base URL 允许裸域名', normalizeRelayBaseUrl('https://api.easy88ai.com') === 'https://api.easy88ai.com');
check('Base URL 拒绝 http', (() => { try { normalizeRelayBaseUrl('http://api.easy88ai.com'); return false; } catch { return true; } })());
check('Base URL 拒绝空值', (() => { try { normalizeRelayBaseUrl('   '); return false; } catch { return true; } })());
check('Base URL 拒绝非 URL', (() => { try { normalizeRelayBaseUrl('https://'); return false; } catch { return true; } })());

const ep1 = relayEndpointUrl('https://api.easy88ai.com/v1', '/chat/completions');
check('带 /v1 的地址拼出 /v1/chat/completions', ep1.path === '/v1/chat/completions' && ep1.hostname === 'api.easy88ai.com', JSON.stringify(ep1));
const ep2 = relayEndpointUrl('https://api.easy88ai.com', '/chat/completions');
check('裸域名自动补 /v1', ep2.path === '/v1/chat/completions', JSON.stringify(ep2));
const ep3 = relayEndpointUrl('https://api.easy88ai.com/v1/', '/models');
check('模型列表走 /v1/models', ep3.path === '/v1/models', JSON.stringify(ep3));
check('默认端口 443', relayEndpointUrl('https://api.easy88ai.com/v1', '/models').port === 443);
const ep4 = relayEndpointUrl('https://relay.example.com:8443/openai/v1', '/chat/completions');
check('自定义端口与自定义前缀都保留', ep4.port === 8443 && ep4.path === '/openai/v1/chat/completions', JSON.stringify(ep4));

// ---------- 2. 上游请求体契约（抽取真实 payload 构造块） ----------
const payloadBlock = sliceBetween(serverSrc, 'const payload = {', 'if ((isRelay || !thinkingEnabled)');
const buildPayload = new Function('model', 'messages', 'isRelay', 'thinkingEnabled', 'cfg', 'session', 'crypto', `
${payloadBlock}
return payload;
`);
const fakeCrypto = { createHash: () => ({ update: () => ({ digest: () => 'stub' }) }) };
const baseArgs = (isRelay, thinkingEnabled) => ['gpt-4o', [{ role: 'user', content: 'hi' }], isRelay, thinkingEnabled, { reasoningEffort: 'high', maxTokens: 2048 }, { userId: 'u1' }, fakeCrypto];

const relayPayload = buildPayload(...baseArgs(true, false));
check('中转站不带 stream_options', !('stream_options' in relayPayload), JSON.stringify(Object.keys(relayPayload)));
check('中转站不带 thinking', !('thinking' in relayPayload));
check('中转站不带 reasoning_effort', !('reasoning_effort' in relayPayload));
check('中转站仍带 model/messages/stream/max_tokens/user', ['model', 'messages', 'stream', 'max_tokens', 'user'].every((k) => k in relayPayload));
check('中转站的模型名原样透传', relayPayload.model === 'gpt-4o');

const dsThinking = buildPayload(...baseArgs(false, true));
check('DeepSeek 带 stream_options.include_usage', dsThinking.stream_options?.include_usage === true);
check('DeepSeek 开思考时 thinking.enabled', dsThinking.thinking?.type === 'enabled');
check('DeepSeek 开思考时带 reasoning_effort', dsThinking.reasoning_effort === 'high');
const dsPlain = buildPayload(...baseArgs(false, false));
check('DeepSeek 关思考时 thinking.disabled', dsPlain.thinking?.type === 'disabled');
check('DeepSeek 关思考时无 reasoning_effort', !('reasoning_effort' in dsPlain));

// ---------- 3. 服务端接线契约 ----------
check('平台分发改用 isNativePlatform(platform)', serverSrc.includes('if (isNativePlatform(platform)) {'));
check('旧的 handleDeepseekNative 已改名', !serverSrc.includes('handleDeepseekNative'));
check('单一 handler 同时服务两端', serverSrc.includes('async function handleNativeChat(res, session, cfg, body)'));
check('中转站凭证读取器存在', serverSrc.includes('async function getRelayProvider(providerId)'));
check('中转站请求器走凭证里的 Base URL', serverSrc.includes('function requestOpenAICompatible(baseUrl, apiKey, payload, timeoutMs = 300000)'));
check('模型列表拉取器存在', serverSrc.includes('async function fetchRelayModels(baseUrl, apiKey, timeoutMs = 20000)'));
check('凭证类型白名单含 relay', serverSrc.includes("['deepseek', BAILIAN_EMBEDDING_TYPE, RELAY_PROVIDER_TYPE]"));
check('中转站凭证归一化 baseUrl', serverSrc.includes('baseUrl: normalizeRelayBaseUrl(provider.baseUrl)'));
check('保存智能体时有 relay 校验分支', serverSrc.includes('if (merged.platform === RELAY_PLATFORM) {'));
check('relay 智能体不存 baseUrl 快照', /if \(merged\.platform === RELAY_PLATFORM\) \{[\s\S]{0,400}?merged\.baseUrl = '';/.test(serverSrc));
check('测试连接端点存在', serverSrc.includes("p === '/api/admin/relay/test' && req.method === 'POST'"));
check('模型列表端点存在', serverSrc.includes("p === '/api/admin/relay/models' && req.method === 'GET'"));

const modelsRoute = sliceBetween(serverSrc, "p === '/api/admin/relay/models'", "if (p === '/api/bailian/embedding/test'");
check('模型列表端点要求管理员鉴权', modelsRoute.includes('requireAdmin(req, res)'));
check('模型列表只回 ok/baseUrl/models（密钥不外泄）', /res\.end\(JSON\.stringify\(\{\s*ok:\s*true,\s*baseUrl:\s*provider\.baseUrl,\s*models\s*\}\)\)/.test(modelsRoute), modelsRoute.slice(0, 120));
check('模型列表端点带超时', /fetchRelayModels\(provider\.baseUrl,\s*provider\.apiKey\)/.test(modelsRoute));

// ---------- 4. 平台集合唯一性 ----------
check('native-platforms.mjs 定义两个平台', /RELAY_PLATFORM = 'relay-native'/.test(nativeSrc) && /DEEPSEEK_PLATFORM = 'deepseek-native'/.test(nativeSrc));
check('native-platforms.mjs 零依赖（不会造成循环引用）', !/^\s*import\s/m.test(nativeSrc), '出现了 import');
check('index.mjs 不再自行声明 DEEPSEEK_PLATFORM', !serverSrc.includes("const DEEPSEEK_PLATFORM = 'deepseek-native'"));
check('index.mjs 从 native-platforms 导入', serverSrc.includes("from './native-platforms.mjs'"));
check('miniapp-api 走 isNativePlatform', miniappApiSrc.includes('isNativePlatform(item.platform)') && !miniappApiSrc.includes("'deepseek-native'"));
check('miniapp-runtime 走 isNativePlatform', miniappRuntimeSrc.includes('isNativePlatform(target.platform)') && !miniappRuntimeSrc.includes("'deepseek-native'"));
check('网页端 Chat.jsx 走 isNativePlatform', chatSrc.includes('const isNativePlatform = (platform) =>') && !chatSrc.includes("agent.platform === 'deepseek-native'") && !chatSrc.includes("agent.platform !== 'deepseek-native'"));
check('网页端平台集合与小程序端一致', chatSrc.includes("['deepseek-native', 'relay-native']"));
check('后台智能体平台选项含中转站', agentEditSrc.includes("key: 'relay-native'"));
check('后台智能体按中转站凭证过滤', agentEditSrc.includes("p.type === 'relay' && p.status !== 'disabled'"));
check('后台模型可手填也可下拉（datalist）', agentEditSrc.includes('list="relay-model-options"') && agentEditSrc.includes('<datalist id="relay-model-options">'));
check('后台授权页新增中转站类型', authProvidersSrc.includes("relay: '外部大模型中转站'"));
check('中转站的 Base URL 可编辑（只有 DeepSeek 才只读）', authProvidersSrc.includes("readOnly={form.type === 'deepseek'}"));

// ---------- 5. 凭证入库归一化真跑（抽取真实源码 + 桩） ----------
// 这是「AI 授权管理 → 新增授权 → 保存」第一步就会走的路径，出问题会直接卡住后台。
function grabConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!m) throw new Error(`未找到常量 ${name}`);
  return `const ${name} = ${m[1]};`;
}
const providerFactory = new Function(`
${grabConst(serverSrc, 'DEEPSEEK_BASE_URL')}
${grabConst(serverSrc, 'BAILIAN_EMBEDDING_TYPE')}
${grabConst(serverSrc, 'BAILIAN_DEFAULT_BASE_URL')}
${grabConst(serverSrc, 'BAILIAN_EMBEDDING_MODEL')}
${grabConst(serverSrc, 'BAILIAN_EMBEDDING_DIMENSIONS')}
${grabConst(serverSrc, 'DEEPSEEK_DEFAULT_MODEL')}
${grabConst(serverSrc, 'DEEPSEEK_MODEL_ALIASES')}
${grabConst(serverSrc, 'RELAY_PROVIDER_TYPE')}
${grabConst(serverSrc, 'CONFIG_SECRET_FIELDS')}
const PROVIDER_TYPE_LABELS = { deepseek: 'DeepSeek', [RELAY_PROVIDER_TYPE]: '中转站', [BAILIAN_EMBEDDING_TYPE]: '百炼向量' };
${sliceFunction(serverSrc, 'isEmptyOrMaskedSecret')}
${sliceFunction(serverSrc, 'preserveCollectionSecrets')}
${sliceFunction(serverSrc, 'normalizeDeepseekModel')}
${sliceFunction(serverSrc, 'normalizeRelayBaseUrl')}
// 用可逆桩代替真加密：只验证「调用了加密并且明文已删除」，不涉及真实密钥。
function encryptConfigSecret(value) {
  const text = String(value || '').trim();
  return text ? 'enc:v1:stub:' + Buffer.from(text, 'utf8').toString('base64url') : '';
}
${sliceFunction(serverSrc, 'prepareAuthProvidersForStorage')}
return { prepareAuthProvidersForStorage };
`);
const { prepareAuthProvidersForStorage } = providerFactory();
const stubOf = (v) => 'enc:v1:stub:' + Buffer.from(v, 'utf8').toString('base64url');

const relaySaved = prepareAuthProvidersForStorage([{ id: 'r1', name: '中转站', type: 'relay', baseUrl: 'https://api.easy88ai.com/v1/', apiKey: 'sk-test', status: 'active' }], [])[0];
check('中转站凭证：Base URL 去尾斜杠后入库', relaySaved.baseUrl === 'https://api.easy88ai.com/v1', JSON.stringify(relaySaved));
check('中转站凭证：明文 apiKey 已删除', !('apiKey' in relaySaved));
check('中转站凭证：密钥已加密落库', relaySaved.apiKeyEncrypted === stubOf('sk-test'));
check('中转站凭证：其余字段保留', relaySaved.type === 'relay' && relaySaved.status === 'active');

const relayMasked = prepareAuthProvidersForStorage(
  [{ id: 'r1', name: '中转站', type: 'relay', baseUrl: 'https://api.easy88ai.com/v1', apiKey: '***' }],
  [{ id: 'r1', apiKeyEncrypted: 'enc:v1:old' }],
)[0];
check('留空占位时保留原密钥（不会误删）', relayMasked.apiKeyEncrypted === 'enc:v1:old', JSON.stringify(relayMasked));

let relayNoKeyThrew = '';
try { prepareAuthProvidersForStorage([{ id: 'r2', name: '没密钥', type: 'relay', baseUrl: 'https://api.easy88ai.com/v1' }], []); } catch (e) { relayNoKeyThrew = String(e.message || e); }
check('缺 API Key 时报「中转站」而非「DeepSeek」', relayNoKeyThrew.includes('中转站') && relayNoKeyThrew.includes('缺少 API Key'), relayNoKeyThrew);

const dsSaved = prepareAuthProvidersForStorage([{ id: 'd1', name: '官网', type: 'deepseek', baseUrl: 'https://evil.example.com', apiKey: 'sk-ds' }], [])[0];
check('DeepSeek 凭证的 Base URL 仍被强制回官网（未被本次改动放开）', dsSaved.baseUrl === 'https://api.deepseek.com', dsSaved.baseUrl);
check('DeepSeek 凭证的旧模型名仍被归一化', prepareAuthProvidersForStorage([{ id: 'd2', name: 'x', type: 'deepseek', model: 'deepseek-v4-flash' }], [{ id: 'd2', apiKeyEncrypted: 'enc:v1:old' }])[0].model === 'deepseek-flash');

const oauthKept = prepareAuthProvidersForStorage([{ id: 'o1', name: 'usun', type: 'oauth', baseUrl: 'https://api.coze.cn' }], [])[0];
check('非托管类型（Coze）原样通过', oauthKept.baseUrl === 'https://api.coze.cn' && !('apiKeyEncrypted' in oauthKept));

// ---------- 输出 ----------
if (failures.length) {
  console.log(`check-relay-provider: ${pass} PASS / ${failures.length} FAIL`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`check-relay-provider: ALL PASS (${pass} 项)`);
console.log('  · Base URL 归一化与路径拼接（含裸域名自动补 /v1、自定义端口/前缀）');
console.log('  · 中转站请求体不含 DeepSeek 专有字段，DeepSeek 路径逐项未变');
console.log('  · 服务端接线完整，模型列表端点鉴权且不外泄密钥');
console.log('  · 平台集合唯一实现（server/native-platforms.mjs），四处分流均已收口');
console.log('  · 凭证入库归一化真跑（relay 放开 Base URL；DeepSeek 仍被强制回官网，未被本次改动波及）');
