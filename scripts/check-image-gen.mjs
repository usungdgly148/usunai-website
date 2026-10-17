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
  buildImagePayload,
  normalizeImageModels,
  normalizeResolution,
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
const configRoute = configStart >= 0 ? serverSrc.slice(configStart, configStart + 1600) : '';
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
check('候选清单含 gemini-2.5-flash-image', IMAGE_MODEL_CANDIDATES.includes('gemini-2.5-flash-image'), IMAGE_MODEL_CANDIDATES.join(','));
check(
  '新模型自动补进配置表且未上架',
  withCandidates.some((item) => item.id === 'gemini-2.5-flash-image' && item.enabled === false && Object.keys(item.prices).length === 0),
  JSON.stringify(withCandidates.map((item) => item.id)),
);
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
check('保存后回吐最新配置', serverSrc.includes('settings: await loadImageGenSettings()'));

// ===== 10. 前端接线（模型/清晰度选择）=====
check('用户页提交 model 与 resolution', /model,\s*\n\s*resolution,/.test(userPageSrc));
check('用户页档位来自接口下发', userPageSrc.includes('const resolutions =') && userPageSrc.includes('currentModel'));
check('用户页没有写死价格表', !/points:\s*\d+/.test(userPageSrc));
check('后台页有 1K/2K/4K 三档价格输入', adminPageSrc.includes("const RESOLUTIONS = ['1K', '2K', '4K']"));
check('后台页能从中转站拉模型列表', adminPageSrc.includes('fetchRelayModels'));
check('后台页保存配置到 settings 接口', adminPageSrc.includes("adminFetch('/api/admin/image-gen/settings'"));
check('后台页透传分辨率', adminPageSrc.includes('resolution, aspectRatio: aspect'));
check('后台页候选含 gemini-2.5-flash-image', adminPageSrc.includes("'gemini-2.5-flash-image'"));

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

// ===== 结果 =====
const total = pass + failures.length;
if (failures.length) {
  console.error(`\n[FAIL] ${failures.length}/${total} 项不通过：`);
  for (const item of failures) console.error(`  · ${item}`);
  process.exit(1);
}
console.log(`[OK] image-gen 图生图契约 ${pass}/${total} 项全部通过`);
