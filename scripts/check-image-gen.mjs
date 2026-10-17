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
  IMAGE_REF_BODY_LIMIT,
  IMAGE_REF_MAX_BYTES,
  buildImagePayload,
  prepareReferenceImages,
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
const userRoute = userRouteStart >= 0 ? serverSrc.slice(userRouteStart, userRouteStart + 4200) : '';
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
const configRoute = configStart >= 0 ? serverSrc.slice(configStart, configStart + 900) : '';
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

// ===== 结果 =====
const total = pass + failures.length;
if (failures.length) {
  console.error(`\n[FAIL] ${failures.length}/${total} 项不通过：`);
  for (const item of failures) console.error(`  · ${item}`);
  process.exit(1);
}
console.log(`[OK] image-gen 图生图契约 ${pass}/${total} 项全部通过`);
