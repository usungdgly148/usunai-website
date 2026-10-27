// 回归：Gemini 原生图片生成 —— 图生图（参考图）契约
//
// 覆盖四层：
//   1. 纯函数真跑（直接 import server/gemini-image.mjs，不是抄一份逻辑）
//   2. 参考图硬校验（张数 / 格式 / 体积 / 编码）
//   3. 请求体契约（参考图必须落在 parts[].inlineData，且 mode 用驼峰）
//   4. 服务端与前端接线（请求体上限放宽 / 先校验再预扣 / 价格不再硬编码）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IMAGE_PRICE_POINTS,
  IMAGE_MAX_REF_IMAGES,
  IMAGE_MODEL_CANDIDATES,
  IMAGE_REF_BODY_LIMIT,
  IMAGE_REF_MAX_BYTES,
  IMAGE_RESOLUTIONS,
  OPENAI_IMAGE_SIZES,
  aspectRatiosForModel,
  buildImagePayload,
  buildOpenAIImageEditBody,
  buildOpenAIImagePayload,
  extractOpenAIImageResult,
  imageApiStyle,
  imageEndpoint,
  imageModelSupportsRefs,
  normalizeImageModels,
  normalizeResolution,
  openAIImageSize,
  prepareReferenceImages,
  resolveImageSelection,
} from '../server/gemini-image.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const serverSrc = read('server/index.mjs');
const userPageSrc = read('frontend/src/pages/ImageGen.jsx');
const adminPageSrc = read('frontend/src/pages/AdminImageGen.jsx');
const pickerSrc = read('frontend/src/RefImagePicker.jsx');
const compressSrc = read('frontend/src/imageCompress.js');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
}
function expectThrow(name, fn, code) {
  try {
    fn();
    failures.push(`${name} —— 期望抛错但没有抛`);
  } catch (error) {
    if (code && error.code !== code) failures.push(`${name} —— code 期望 ${code}，实际 ${error.code}`);
    else pass += 1;
  }
}

const B64 = (text) => Buffer.from(text).toString('base64');
const tiny = B64('fake-image-bytes');
const one = [{ mimeType: 'image/jpeg', data: tiny }];

// ===== 1. 常量 =====
check('定价统一 30 点/张', DEFAULT_IMAGE_PRICE_POINTS === 30, `实际 ${DEFAULT_IMAGE_PRICE_POINTS}`);
check('参考图上限 3 张（只开放实测过的区间）', IMAGE_MAX_REF_IMAGES === 3, `实际 ${IMAGE_MAX_REF_IMAGES}`);
check('单张参考图上限 2MB', IMAGE_REF_MAX_BYTES === 2 * 1024 * 1024, `实际 ${IMAGE_REF_MAX_BYTES}`);
check(
  '生图路由请求体上限放宽且不超过 nginx 25m',
  IMAGE_REF_BODY_LIMIT > 1024 * 1024 && IMAGE_REF_BODY_LIMIT <= 25 * 1024 * 1024,
  `实际 ${IMAGE_REF_BODY_LIMIT}`,
);

// ===== 2. prepareReferenceImages 硬校验 =====
check('参考图为 null → 空数组', prepareReferenceImages(null).length === 0);
check('参考图缺省 → 空数组', prepareReferenceImages(undefined).length === 0);
check('参考图为空数组 → 空数组', prepareReferenceImages([]).length === 0);
expectThrow('参考图非数组要拒绝', () => prepareReferenceImages('abc'), 'IMAGE_REF_INVALID');
expectThrow(
  `参考图超过 ${IMAGE_MAX_REF_IMAGES} 张要拒绝`,
  () => prepareReferenceImages([...one, ...one, ...one, ...one]),
  'IMAGE_REF_TOO_MANY',
);
expectThrow('参考图格式不支持要拒绝', () => prepareReferenceImages([{ mimeType: 'image/gif', data: tiny }]), 'IMAGE_REF_BAD_TYPE');
expectThrow('参考图为空内容要拒绝', () => prepareReferenceImages([{ mimeType: 'image/png', data: '   ' }]), 'IMAGE_REF_EMPTY');
expectThrow('参考图编码非法要拒绝', () => prepareReferenceImages([{ mimeType: 'image/png', data: '!!!!' }]), 'IMAGE_REF_INVALID');
expectThrow(
  '参考图超 2MB 要拒绝',
  () => prepareReferenceImages([{ mimeType: 'image/png', data: Buffer.alloc(IMAGE_REF_MAX_BYTES + 16, 1).toString('base64') }]),
  'IMAGE_REF_TOO_LARGE',
);

const normalizedJpg = prepareReferenceImages([{ mimeType: 'image/jpg', data: tiny }]);
check('image/jpg 归一化为 image/jpeg', normalizedJpg[0].mimeType === 'image/jpeg', normalizedJpg[0].mimeType);

const stripped = prepareReferenceImages([{ mimeType: 'IMAGE/PNG', data: `data:image/png;base64,${tiny}` }]);
check('data URL 前缀被剥掉', !stripped[0].data.startsWith('data:') && stripped[0].data === tiny);
check('MIME 大小写被归一化', stripped[0].mimeType === 'image/png', stripped[0].mimeType);
check('空白字符被清掉', prepareReferenceImages([{ mimeType: 'image/png', data: tiny.slice(0, 4) + '\n ' + tiny.slice(4) }])[0].data === tiny);
check('带 padding 的 base64 被接受', prepareReferenceImages([{ mimeType: 'image/png', data: B64('ab') }]).length === 1);
check('恰好 3 张要放行', prepareReferenceImages([...one, ...one, ...one]).length === 3);

// ===== 3. buildImagePayload 拼装 =====
const textOnly = buildImagePayload({ prompt: '一只猫' });
check('纯文生图 parts 只有 text', textOnly.contents[0].parts.length === 1);
check('纯文生图 parts[0] 是 text', textOnly.contents[0].parts[0].text === '一只猫');
check('纯文生图 role=user', textOnly.contents[0].role === 'user');
check('不传宽高比时不写 imageConfig', !textOnly.generationConfig.imageConfig);
check('responseModalities 固定 IMAGE', JSON.stringify(textOnly.generationConfig.responseModalities) === '["IMAGE"]');

const withRatio = buildImagePayload({ prompt: '一只猫', aspectRatio: '16:9' });
check('传宽高比时写入 imageConfig', withRatio.generationConfig.imageConfig.aspectRatio === '16:9');

const single = buildImagePayload({ prompt: '把背景换成海边', images: one });
check('带 1 张参考图 parts=2', single.contents[0].parts.length === 2, String(single.contents[0].parts.length));
check('参考图排在文字之后', single.contents[0].parts[0].text === '把背景换成海边' && !!single.contents[0].parts[1].inlineData);
check('参考图用驼峰 inlineData', JSON.stringify(single).includes('"inlineData"') && !JSON.stringify(single).includes('inline_data'));
check('参考图带 mimeType 与 data', single.contents[0].parts[1].inlineData.mimeType === 'image/jpeg' && single.contents[0].parts[1].inlineData.data === tiny);

const triple = buildImagePayload({ prompt: '三张参考图合成', images: [...one, ...one, ...one] });
check('带 3 张参考图 parts=4', triple.contents[0].parts.length === 4, String(triple.contents[0].parts.length));
check('images 为 null 时等价于纯文生图', buildImagePayload({ prompt: 'x', images: null }).contents[0].parts.length === 1);
expectThrow('提示词为空要抛错', () => buildImagePayload({ prompt: '  ' }));

// ===== 4. 服务端接线 =====
check('用户侧路由放宽请求体上限', serverSrc.includes('await readBody(req, IMAGE_REF_BODY_LIMIT)'));
check('IMAGE_REF_BODY_LIMIT 已导入 index.mjs', /IMAGE_REF_BODY_LIMIT,/.test(serverSrc.slice(0, serverSrc.indexOf("} from './gemini-image.mjs';"))));

const userRouteStart = serverSrc.indexOf("if (p === '/api/image-gen' && req.method === 'POST')");
const userRoute = userRouteStart >= 0 ? serverSrc.slice(userRouteStart, userRouteStart + 6000) : '';
check('用户侧路由存在', userRouteStart > 0);
check('已通过 body.images 读参考图', userRoute.includes('prepareReferenceImages(body.images)'));
check(
  '参考图先校验再预扣（顺序不可换）',
  userRoute.indexOf('const refImages = prepareReferenceImages(body.images);') >= 0
    && userRoute.indexOf('const refImages = prepareReferenceImages(body.images);') < userRoute.indexOf('kvRecordNativeUsage'),
);
check('生成时把参考图传下去', userRoute.includes('images: refImages'));
check('计费流水记录参考图张数', userRoute.includes('refImageCount: refImages.length'));
check('失败仍走原额退款', userRoute.includes('kvRefundNativeUsage'));

const adminRouteStart = serverSrc.indexOf("if (p === '/api/admin/image-gen' && req.method === 'POST')");
const adminRoute = adminRouteStart >= 0 ? serverSrc.slice(adminRouteStart, adminRouteStart + 1800) : '';
check('后台路由存在', adminRouteStart > 0);
check('后台路由放宽请求体上限', adminRoute.includes('readBody(req, IMAGE_REF_BODY_LIMIT)'));
check('后台路由透传参考图', adminRoute.includes('images: body.images'));
check('后台路由不扣算力（无计费调用）', !adminRoute.includes('kvRecordNativeUsage'));

const configStart = serverSrc.indexOf("if (p === '/api/image-gen/config' && req.method === 'GET')");
const configRoute = configStart >= 0 ? serverSrc.slice(configStart, configStart + 3200) : '';
check('配置下发路由存在', configStart > 0);
check('配置路由下发价格', configRoute.includes('pricePoints: settings.pricePoints'));
check('配置路由下发张数上限', configRoute.includes('maxRefImages: IMAGE_MAX_REF_IMAGES'));
check('配置路由不外泄密钥', !/apiKey|apiKeyEncrypted/.test(configRoute));

// ===== 5. 前端接线 =====
check('用户页引用参考图选择器', userPageSrc.includes("from '../RefImagePicker.jsx'"));
check('后台页引用参考图选择器', adminPageSrc.includes("from '../RefImagePicker.jsx'"));
check('用户页提交参考图', userPageSrc.includes('images: toApiImages(refs)'));
check('后台页提交参考图', adminPageSrc.includes('images: toApiImages(refs)'));
check('用户页不再硬编码 20 点', !/PRICE_HINT\s*=\s*20/.test(userPageSrc));
check('用户页从接口取价格', userPageSrc.includes("apiFetch('/api/image-gen/config')"));
check('选择器张数上限与服务端一致', pickerSrc.includes(`export const MAX_REF_IMAGES = ${IMAGE_MAX_REF_IMAGES};`));
check('选择器单张上限与服务端一致（均为 2MB）', pickerSrc.includes('export const REF_MAX_BYTES = 2 * 1024 * 1024;') && IMAGE_REF_MAX_BYTES === 2 * 1024 * 1024);
check('参考图压缩输出 JPEG（WebP 未实测，不用）', pickerSrc.includes("mimeType: 'image/jpeg'"));
check('压缩函数支持指定输出格式', compressSrc.includes("mimeType = 'image/webp'"));
check('JPEG 压缩先铺白底（避免透明变黑）', compressSrc.includes("ctx.fillStyle = '#ffffff'"));

// ===== 6. 分辨率（imageConfig.imageSize，实测 1K/2K/4K 真生效）=====
check('分辨率档位固定为 1K/2K/4K', JSON.stringify(IMAGE_RESOLUTIONS) === '["1K","2K","4K"]');
check('normalizeResolution 大小写归一化', normalizeResolution('2k') === '2K');
check('normalizeResolution 拒绝非法档位', normalizeResolution('8K') === '');

const payload1K = buildImagePayload({ prompt: 'x', resolution: '1K' });
check('带分辨率时写入 imageSize', payload1K.generationConfig.imageConfig.imageSize === '1K', JSON.stringify(payload1K.generationConfig));
const payloadBoth = buildImagePayload({ prompt: 'x', aspectRatio: '16:9', resolution: '4K' });
check('宽高比与分辨率可共存', payloadBoth.generationConfig.imageConfig.aspectRatio === '16:9' && payloadBoth.generationConfig.imageConfig.imageSize === '4K');
check('不传分辨率时不写 imageConfig', !buildImagePayload({ prompt: 'x' }).generationConfig.imageConfig);
check('分辨率键名是驼峰 imageSize', JSON.stringify(payload1K).includes('"imageSize"') && !JSON.stringify(payload1K).includes('image_size'));

// ===== 7. 模型清单归一化（后台配置收敛）=====
const normModels = normalizeImageModels([
  { id: 'm1', label: 'M1', prices: { '1K': 30, '2K': 60.4, '4K': -1 } },
  { id: 'm1', label: 'dup', prices: { '1K': 99 } },
  { id: 'm2', enabled: true },
  { id: '', prices: { '1K': 10 } },
]);
check('重复模型去重', normModels.filter((item) => item.id === 'm1').length === 1);
check('价格取整并过滤非法值', normModels[0].prices['2K'] === 61 && !normModels[0].prices['4K'], JSON.stringify(normModels[0].prices));
check('没配价的模型自动不上架', normModels.find((item) => item.id === 'm2').enabled === false);
check('空 id 被丢弃', !normModels.some((item) => item.id === ''));
const legacyModels = normalizeImageModels(null, { legacyModel: 'old-model', legacyPrice: 20, includeCandidates: false });
check('老配置迁移成单模型单档', legacyModels.length === 1 && legacyModels[0].prices['1K'] === 20, JSON.stringify(legacyModels));

// 新接入的模型必须自动出现在后台配置表（未上架、无价），否则后台永远看不到它
const withCandidates = normalizeImageModels(null, { legacyModel: 'gemini-nano-banana-2.1', legacyPrice: 30 });
check('候选清单含 gpt-image-2.5-flare', IMAGE_MODEL_CANDIDATES.includes('gpt-image-2.5-flare'), IMAGE_MODEL_CANDIDATES.join(','));
check(
  '新模型自动补进配置表且未上架',
  withCandidates.some((item) => item.id === 'gpt-image-2.5-flare' && item.enabled === false && Object.keys(item.prices).length === 0),
  JSON.stringify(withCandidates.map((item) => item.id)),
);
// 主人 2026-10-17 要求移除：该模型上游无可用渠道，不再出现在候选/后台表/前端兜底里
check('候选清单已移除 gemini-2.5-flash-image', !IMAGE_MODEL_CANDIDATES.includes('gemini-2.5-flash-image'));
check('配置表不再补出 gemini-2.5-flash-image', !withCandidates.some((item) => item.id === 'gemini-2.5-flash-image'));
check('候选补齐不影响原模型价格', withCandidates.find((item) => item.id === 'gemini-nano-banana-2.1').prices['1K'] === 30);
check('候选补齐不会顺带把模型上架', withCandidates.filter((item) => item.enabled !== false).length === 1);

// ===== 8. 计费解析：模型 × 分辨率 → 点数（**唯一计费入口**）=====
const settingsFixture = {
  models: normalizeImageModels([
    { id: 'A', label: 'A', prices: { '1K': 30, '2K': 60, '4K': 120 } },
    { id: 'B', label: 'B', prices: { '1K': 45 } },
    { id: 'C', enabled: false, prices: { '1K': 10 } },
  ]),
  defaultModel: 'A',
  defaultResolution: '1K',
  fallbackPoints: 30,
};
check('同模型 1K/2K 扣点不同', resolveImageSelection(settingsFixture, 'A', '1K').points === 30 && resolveImageSelection(settingsFixture, 'A', '2K').points === 60);
check('4K 扣点按配置取', resolveImageSelection(settingsFixture, 'A', '4K').points === 120);
check('不同模型同档位可不同价', resolveImageSelection(settingsFixture, 'B', '1K').points === 45);
check('未传分辨率时用默认档', resolveImageSelection(settingsFixture, 'A', '').resolution === '1K');
check('未传模型时用默认模型', resolveImageSelection(settingsFixture, '', '1K').model === 'A');
check('未上架模型被拒', resolveImageSelection(settingsFixture, 'C', '1K').code === 'IMAGE_MODEL_NOT_AVAILABLE');
check('未配置的档位被拒', resolveImageSelection(settingsFixture, 'B', '4K').code === 'IMAGE_RESOLUTION_NOT_SUPPORTED');
check('没有可用模型时被拒', resolveImageSelection({ models: [] }, 'A', '1K').code === 'IMAGE_NO_MODEL_AVAILABLE');
const fallbackSelection = resolveImageSelection({ models: [{ id: 'A', label: 'A', enabled: true, prices: { '1K': 0 } }], fallbackPoints: 77 }, 'A', '1K');
check('缺价时用后台兜底点数', fallbackSelection.ok === true && fallbackSelection.points === 77, JSON.stringify(fallbackSelection));

// ===== 9. 服务端接线（分辨率 + 动态定价）=====
check('用户路由统一走 resolveImageSelection 算价', serverSrc.includes('resolveImageSelection(settings, body.model, body.resolution)'));
check('用户路由不再拿 pricePoints 当扣费额', !/const price = settings\.pricePoints/.test(serverSrc));
check('用户路由把 model/resolution 传给生成函数', userRoute.includes('aspectRatio, resolution, model'));
check('后台路由透传分辨率', adminRoute.includes('resolution: body.resolution'));
check('配置下发默认分辨率', configRoute.includes('defaultResolution: settings.defaultResolution'));
check('配置下发已上架模型清单', configRoute.includes('models,') && configRoute.includes('resolutions:'));
check('后台配置读写路由都存在', serverSrc.includes("'/api/admin/image-gen/settings' && req.method === 'GET'") && serverSrc.includes("'/api/admin/image-gen/settings' && req.method === 'POST'"));
check('保存配置走 KV（不发版即可改价）', serverSrc.includes("await KV.kvPut('imageGenSettings', next)"));
check('保存后回吐最新配置', serverSrc.includes('settings: withRefSupport(await loadImageGenSettings())'));

// ===== 10. 前端接线（模型/清晰度选择）=====
check('用户页提交 model 与 resolution', /model,\s*\n\s*resolution,/.test(userPageSrc));
check('用户页档位来自接口下发', userPageSrc.includes('const resolutions =') && userPageSrc.includes('currentModel'));
check('用户页没有写死价格表', !/points:\s*\d+/.test(userPageSrc));
check('后台页有 1K/2K/4K 三档价格输入', adminPageSrc.includes("const RESOLUTIONS = ['1K', '2K', '4K']"));
check('后台页能从中转站拉模型列表', adminPageSrc.includes('fetchRelayModels'));
check('后台页保存配置到 settings 接口', adminPageSrc.includes("adminFetch('/api/admin/image-gen/settings'"));
check('后台页透传分辨率', adminPageSrc.includes('resolution, aspectRatio: aspect'));
check('后台页兜底模型已移除 gemini-2.5-flash-image', !adminPageSrc.includes("'gemini-2.5-flash-image'"));
// 凭证选择必须能保存：旧写法 draft.providerId 优先 ⇒ 下拉框改了永远存不进去
check('后台页保存时以「生图凭证」下拉为准', adminPageSrc.includes('providerId: providerId || draft.providerId'));
check('后台页加载时回显已保存的凭证', adminPageSrc.includes('if (data.settings.providerId) setProviderId(data.settings.providerId)'));

// ===== 11. 名称统一为「AI全能设计」+ 入口归位「AI 创作」组 =====
const sidebarSrc = read('frontend/src/components.jsx');
const adminUiSrc = read('frontend/src/adminUI.jsx');
check('用户页标题改为 AI全能设计', userPageSrc.includes('AI全能设计') && !userPageSrc.includes('AI 生图'));
check('后台导航改名', adminUiSrc.includes("label: 'AI全能设计'") && !adminUiSrc.includes("label: 'AI 生图'"));
check('后台页标题改名', adminPageSrc.includes('title="AI全能设计"'));
check('后端流水名称同步', serverSrc.includes("reason: 'AI 全能设计'"));
check('侧栏入口挂在 AI 创作 组内第一项', sidebarSrc.includes('group.name === DESIGN_ENTRY_GROUP'));
check('侧栏入口有兜底（分组改名也不丢入口）', sidebarSrc.includes('hasDesignEntryGroup'));
check('分类「AI 生图」保持原样（不与入口混用）', read('frontend/src/mock.js').includes("name: 'AI 生图'"));

// ===== 12. 用户页三处说明文案已移除 =====
check('已删「描述画面即可生成…」', !userPageSrc.includes('描述画面即可生成'));
check('已删「清晰度越高越慢…」', !userPageSrc.includes('清晰度越高越慢'));
check('用户页关闭参考图说明（不带到页面）', userPageSrc.includes('showHint={false}'));

// ===== 13. gpt-image-* 走 OpenAI 兼容 images 接口（2026-10-17 接入，2026-10-27 补齐图生图）=====
// 两套风格必须互不干扰：gemini-* 走 :generateContent（imageConfig + inlineData）；
// gpt-image-* 按**有没有参考图**分流：无图 → /v1/images/generations（JSON），
// 有图 → /v1/images/edits（multipart）。带图走 generations 会被上游静默忽略（image_tokens=0）。
check('gpt-image-* 判为 openai-images', imageApiStyle('gpt-image-2.5-flare') === 'openai-images');
check('gemini-* 判为 gemini-native', imageApiStyle('gemini-nano-banana-2.1') === 'gemini-native');
check('空模型名退化为 gemini-native', imageApiStyle('') === 'gemini-native');
check('gpt-image-* 支持参考图（走 /images/edits）', imageModelSupportsRefs('gpt-image-2.5-flare') === true);
check('gpt-image sunburst 也支持参考图', imageModelSupportsRefs('gpt-image-2.5-sunburst') === true);
check('gemini 吃参考图', imageModelSupportsRefs('gemini-nano-banana-2.1') === true);

const epFlare = imageEndpoint('https://api.easy88ai.com/v1', 'gpt-image-2.5-flare');
check('flare 端点路径为 /v1/images/generations', epFlare.path === '/v1/images/generations', epFlare.path);
check('flare 端点不重复拼 /v1', !epFlare.path.includes('/v1/v1'), epFlare.path);
check('flare 端点带样式标记', epFlare.style === 'openai-images', epFlare.style);
const epGemini = imageEndpoint('https://api.easy88ai.com/v1', 'gemini-nano-banana-2.1');
check('gemini 端点保持不变', epGemini.path === '/v1beta/models/gemini-nano-banana-2.1:generateContent', epGemini.path);
const epProxy = imageEndpoint('https://api.easy88ai.com/proxy/v1', 'gpt-image-2.5-flare');
check('带子路径的 Base URL 只剥末尾 /v1', epProxy.path === '/proxy/v1/images/generations', epProxy.path);
// 图生图必须换端点：/generations 会静默忽略参考图（实测 image_tokens=0）
const epEdit = imageEndpoint('https://api.easy88ai.com/v1', 'gpt-image-2.5-flare', { edit: true });
check('带参考图时端点切到 /v1/images/edits', epEdit.path === '/v1/images/edits', epEdit.path);
const epEditProxy = imageEndpoint('https://api.easy88ai.com/proxy/v1', 'gpt-image-2.5-flare', { edit: true });
check('子路径 + 图生图也正确', epEditProxy.path === '/proxy/v1/images/edits', epEditProxy.path);
const epGeminiEdit = imageEndpoint('https://api.easy88ai.com/v1', 'gemini-nano-banana-2.1', { edit: true });
check('gemini 不受 edit 标记影响', epGeminiEdit.path === '/v1beta/models/gemini-nano-banana-2.1:generateContent', epGeminiEdit.path);

// size 换算表必须满足文档硬约束：两边都是 16 的倍数、单边 ≤3840、长宽比 ≤3:1、总像素 655,360~8,294,400
const sizeViolations = [];
for (const [level, table] of Object.entries(OPENAI_IMAGE_SIZES)) {
  for (const [ratio, size] of Object.entries(table)) {
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (!m) { sizeViolations.push(`${level}/${ratio}=${size}（格式）`); continue; }
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w % 16 !== 0 || h % 16 !== 0) sizeViolations.push(`${level}/${ratio}=${size}（非16倍数）`);
    if (w > 3840 || h > 3840) sizeViolations.push(`${level}/${ratio}=${size}（超单边）`);
    if (Math.max(w, h) / Math.min(w, h) > 3.0001) sizeViolations.push(`${level}/${ratio}=${size}（超3:1）`);
    const px = w * h;
    if (px < 655360 || px > 8294400) sizeViolations.push(`${level}/${ratio}=${size}（像素${px}）`);
    const [rw, rh] = ratio.split(':').map(Number);
    if (Math.abs(w / h - rw / rh) > 0.06) sizeViolations.push(`${level}/${ratio}=${size}（比例偏太多）`);
  }
}
check('五档比例 × 三档清晰度的 size 全部合法', sizeViolations.length === 0, sizeViolations.join(', '));
check('4K 1:1 用 2880x2880（3840 会超像素上限）', openAIImageSize('1:1', '4K') === '2880x2880', openAIImageSize('1:1', '4K'));
check('4K 16:9 用 3840x2160', openAIImageSize('16:9', '4K') === '3840x2160');
check('1K 16:9 用 1280x720（1024x576 低于像素下限）', openAIImageSize('16:9', '1K') === '1280x720');
check('未知比例退回该档 1:1', openAIImageSize('7:3', '2K') === '2048x2048');
check('未指定清晰度则不传 size', openAIImageSize('1:1', '') === '');
check('未指定清晰度时 payload 不含 size', !('size' in buildOpenAIImagePayload({ prompt: '猫', model: 'gpt-image-2.5-flare' })));

const flarePayload = buildOpenAIImagePayload({ prompt: '  一只猫  ', aspectRatio: '16:9', resolution: '2K', model: 'gpt-image-2.5-flare' });
check('flare payload 带 model', flarePayload.model === 'gpt-image-2.5-flare', flarePayload.model);
check('flare payload prompt 去空白', flarePayload.prompt === '一只猫');
check('flare payload n 固定 1', flarePayload.n === 1);
check('flare payload 带 quality', flarePayload.quality === 'high', String(flarePayload.quality));
check('flare payload 带 output_format=png', flarePayload.output_format === 'png');
check('flare payload size 按档位换算', flarePayload.size === '2048x1152', String(flarePayload.size));
check('flare payload 没有 Gemini 的 contents 字段', !('contents' in flarePayload));
// 带参考图却走 /generations 必须当场报错（开发者护栏：宁可 500 也不能「扣了点给张无关图」）
expectThrow(
  'flare 走 /generations 却带参考图必须报错',
  () => buildOpenAIImagePayload({ prompt: '猫', model: 'gpt-image-2.5-flare', images: one }),
  'IMAGE_REF_ROUTE_REQUIRED',
);

// /v1/images/edits 的 multipart 契约
// 实测（2026-10-27）：字段名按张数区分 —— 单张 `image`、多张 `image[]`；两者都验过 image_tokens>0。
const editForm = buildOpenAIImageEditBody({ prompt: '  改成蓝色  ', aspectRatio: '1:1', resolution: '1K', model: 'gpt-image-2.5-flare', images: one });
const editBoundary = /boundary=(\S+)$/.exec(editForm.contentType)[1];
const editText = editForm.body.toString('latin1');
check('multipart Content-Type 带 boundary', /^multipart\/form-data; boundary=/.test(editForm.contentType), editForm.contentType);
check('multipart 以 boundary 开头', editText.startsWith(`--${editBoundary}\r\n`));
check('multipart 以 --boundary-- 收尾', editText.trimEnd().endsWith(`--${editBoundary}--`));
check('multipart 带 model 字段', editText.includes('name="model"\r\n\r\ngpt-image-2.5-flare'));
// 中文必须按 UTF-8 字节比对：body 是二进制，转 latin1 后中文会被拆成双字节，字面量比不出来
check('multipart prompt 已去空白', editForm.body.includes(Buffer.from('name="prompt"\r\n\r\n改成蓝色', 'utf8')));
check('multipart n 固定 1', editText.includes('name="n"\r\n\r\n1'));
check('multipart size 按档位换算', editText.includes('name="size"\r\n\r\n1024x1024'));
check('multipart 带 quality', editText.includes('name="quality"\r\n\r\nhigh'));
check('单张参考图字段名为 image', editText.includes('name="image"; filename="ref-1.jpg"'));
check('参考图字节原样嵌入', editForm.body.includes(Buffer.from(tiny, 'base64')));
check('参考图 part 带正确 Content-Type', editText.includes('Content-Type: image/jpeg'));
const editMulti = buildOpenAIImageEditBody({ prompt: '合成', model: 'gpt-image-2.5-sunburst', aspectRatio: '16:9', resolution: '2K', images: [...one, ...one] });
const editMultiText = editMulti.body.toString('latin1');
check('多张参考图字段名为 image[]（重复）', (editMultiText.match(/"image\[\]"/g) || []).length === 2, String((editMultiText.match(/"image\[\]"/g) || []).length));
check('多张时不再出现单数 image 字段', !editMultiText.includes('name="image";'));
check('多张 size 也按档位换算', editMultiText.includes('name="size"\r\n\r\n2048x1152'));
expectThrow('edits 缺参考图要报错', () => buildOpenAIImageEditBody({ prompt: 'x', model: 'gpt-image-2.5-flare', images: [] }));

const openaiB64 = extractOpenAIImageResult({ data: [{ b64_json: tiny }] });
check('flare 响应 b64_json 可解析', openaiB64.ok && openaiB64.inline.base64 === tiny);
const openaiUrl = extractOpenAIImageResult({ data: [{ url: 'https://res.easy88ai.com/a.png' }] });
check('flare 响应 url 可解析', openaiUrl.ok && openaiUrl.file.url === 'https://res.easy88ai.com/a.png');
check('flare 响应为空时判失败', extractOpenAIImageResult({ data: [] }).ok === false);
check('flare 响应带 error 时透出原因', String(extractOpenAIImageResult({ error: { message: 'blocked' } }).text).includes('blocked'));

// 接线断言：服务端按风格分流、参考图在扣费前就被拒、前端按模型能力隐藏上传区
check('服务端按风格构造 payload', serverSrc.includes('buildOpenAIImagePayload({ prompt, aspectRatio, resolution, images: refs, model })'));
check('服务端按风格解析响应', serverSrc.includes('extractOpenAIImageResult(json)'));
check('服务端有图时构造 multipart（edits）', serverSrc.includes('buildOpenAIImageEditBody({ prompt, aspectRatio, resolution, images: refs, model })'));
check('multipart 请求带 contentType 与 edit 标记', serverSrc.includes('contentType: form.contentType') && serverSrc.includes('edit: true'));
check('请求层支持已编码 body', read('server/gemini-image.mjs').includes('body: rawBody') && read('server/gemini-image.mjs').includes("'Content-Type': type"));
check('用户路由在扣费前拒绝不支持的参考图', (() => {
  // 必须只在**用户生图路由**里判断先后：别的路由（对话计费）也会出现 kvRecordNativeUsage
  const routeAt = serverSrc.indexOf("if (p === '/api/image-gen' && req.method === 'POST')");
  if (routeAt < 0) return false;
  const routeSrc = serverSrc.slice(routeAt);
  const guard = routeSrc.indexOf("code: 'IMAGE_REF_UNSUPPORTED'");
  const charge = routeSrc.indexOf('kvRecordNativeUsage({');
  return guard > 0 && charge > 0 && guard < charge;
})());
check('config 下发 supportsRefs', serverSrc.includes('supportsRefs: imageModelSupportsRefs(item.id)'));
check('后台 settings 下发带 supportsRefs 的副本', serverSrc.includes('withRefSupport(settings)'));
check('大响应体上限按风格放大（b64 图不能按 8MB 判）', serverSrc.includes('withRefSupport') && read('server/gemini-image.mjs').includes('48 * 1024 * 1024'));
// 2026-10-28 用户页改版（大输入卡 + 胶囊工具条）后，参考图区变成"点开才显示"：
// 判据从「{refsSupported &&」改为「refsOpen && refsSupported」，语义不变（能力=服务端说了算）。
check('用户页按 refsSupported 决定是否显示参考图区', userPageSrc.includes('refsOpen && refsSupported'));
check('用户页换到不吃图的模型会清空已选参考图', userPageSrc.includes('entry.supportsRefs === false') && userPageSrc.includes('setRefs([])'));
check('后台页按 caps 隐藏参考图', adminPageSrc.includes('caps[model] !== false'));

// ===== 14. 「加入资产库」按钮（用户页生成结果区）=====
// 复用现有资产体系：store.addAsset → 单条 POST /api/data/assets（服务端强制 userId = 登录用户）。
// 默认落到「图片」库：type='image'，资产库的「图片」Tab 直接按 type 过滤。
const assetUtilsSrc = read('frontend/src/assetUtils.js');
const storeSrc = read('frontend/src/store.jsx');
check('用户页从 store 取 addAsset', /const \{[^}]*addAsset[^}]*\} = useStore\(\)/.test(userPageSrc));
check('按钮文案为「加入资产库」', userPageSrc.includes('加入资产库'));
check('加入后按钮变「已加入资产库」', userPageSrc.includes('已加入资产库'));
check('默认写入图片库（type=image）', userPageSrc.includes("type: 'image'"));
check('资产来源标记为 imageGen', userPageSrc.includes("sourceType: 'imageGen'"));
check('资产名与来源名使用 AI全能设计', userPageSrc.includes("sourceName: 'AI全能设计'") && assetUtilsSrc.includes("imageGen: 'AI 全能设计'"));
check('写入生成的图片链接', userPageSrc.includes('images: [result.url]'));
check('提示词一并存进资产（可复制复用）', userPageSrc.includes('content: text'));
check('防重复提交：非 idle 时按钮禁用', userPageSrc.includes("disabled={assetState !== 'idle'}"));
check('重新生成会重置按钮状态', userPageSrc.includes("setAssetState('idle')"));
check('成功后给出状态提示与入口', userPageSrc.includes('已加入「图片」资产库') && userPageSrc.includes('to="/assets"'));
check('资产库「图片」Tab 按 type 过滤（回归锚点）', read('frontend/src/pages/Assets.jsx').includes("(tab === 'image' || tab === 'video' || tab === 'audio')"));
check('store.addAsset 走单条持久化接口', storeSrc.includes("apiFetch('/api/data/assets'") && storeSrc.includes('persistMyAsset'));

// ===== 8. 比例能力表按模型区分（2026-10-18 新增 5 个比例）=====
// 背景：原来全站只有一份 5 个的常量，网页端与后台各抄了一份；而上游实测支持 10 个
// （21:9→1584×672、2:3→848×1264、1:4→512×2064、4:1→2064×512 均真出图）。
// 关键约束：**不能拿全局并集当生成校验** —— gpt-image 的 size 换算表里没有 21:9，
// 静默回落会变成「扣了点、提示成功、给了方图」。
const geminiRatios = aspectRatiosForModel('gemini-nano-banana-2.1');
const openaiRatios = aspectRatiosForModel('gpt-image-2.5-flare');
check('gemini 系 10 个比例', geminiRatios.length === 10, String(geminiRatios.length));
for (const ratio of ['2:3', '3:2', '21:9', '1:4', '4:1']) {
  check(`gemini 系含新增比例 ${ratio}`, geminiRatios.includes(ratio));
}
check('原有 5 个比例仍在', ['1:1', '16:9', '9:16', '4:3', '3:4'].every((r) => geminiRatios.includes(r)));
check('gpt-image 系仍是 5 个', openaiRatios.length === 5, String(openaiRatios.length));
check('gpt-image 系不含 21:9（否则会被静默换成方图）', !openaiRatios.includes('21:9'));
check('gpt-image 系不含 1:4', !openaiRatios.includes('1:4'));
check('OpenAI 比例是 Gemini 的子集', openaiRatios.every((r) => geminiRatios.includes(r)));
check('OpenAI 比例与 size 换算表一致',
  JSON.stringify([...openaiRatios].sort()) === JSON.stringify(Object.keys(OPENAI_IMAGE_SIZES['1K']).sort()));

const serverImageSrc = read('server/index.mjs');
check('用户路由按模型校验比例（不再用全局常量）',
  serverImageSrc.includes('const ratioTable = aspectRatiosForModel(model);'));
check('配置端点逐模型下发 aspectRatios',
  serverImageSrc.includes('aspectRatios: aspectRatiosForModel(item.id),'));
check('后台试生成端点也校验比例（补历史缺口）',
  serverImageSrc.includes('IMAGE_RATIO_UNSUPPORTED'));

const webImageGenSrc = read('frontend/src/pages/ImageGen.jsx');
check('网页端不再自带「有哪些比例」的清单', !/const ASPECTS = \[/.test(webImageGenSrc));
check('网页端按当前模型的 aspectRatios 渲染', webImageGenSrc.includes('currentModel.aspectRatios'));

const mpImageGenSrc = read('miniapp/src/pages/image-gen/index.tsx');
check('小程序按当前模型的比例渲染', mpImageGenSrc.includes('currentModel.aspectRatios'));
check('小程序比例也做归一化（防回填值越界）', mpImageGenSrc.includes('effectiveAspect'));

// ===== 结果 =====
const total = pass + failures.length;
if (failures.length) {
  console.error(`\n[FAIL] ${failures.length}/${total} 项不通过：`);
  for (const item of failures) console.error(`  · ${item}`);
  process.exit(1);
}
console.log(`[OK] image-gen 图生图契约 ${pass}/${total} 项全部通过`);
