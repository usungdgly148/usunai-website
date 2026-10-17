import Taro from '@tarojs/taro';
import type { ImageGenConfig, ImageGenModel, ImageGenResult } from '../types';
import { toMiniappUrl } from '../utils/entity-visual';
import { fileToDataUrl } from './runtime';

/**
 * 「AI 全能设计」小程序端的纯工具层（P0 只有文生图，参考图压缩在 P1 补）。
 *
 * 这里只放三件「页面里写起来啰嗦、而且两端容易写歪」的事：
 *   ① requestId 生成（服务端用它做扣费幂等 + 失败退款标记）
 *   ② 相对地址 → 绝对地址（服务端回的是 /api/blob/serve?key=…，小程序不认相对路径）
 *   ③ 保存到相册（downloadFile + saveImageToPhotosAlbum + 权限被拒后的引导）
 * 业务逻辑（门禁、扣费提示、结果渲染）留在页面，别搬进来。
 */

/** 服务端只接受 ≤80 字符的 requestId（见 /api/image-gen 的 slice(0, 80)）。 */
export function newImageRequestId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 图片绝对地址：`<Image src>` 与 downloadFile 都必须是 https 绝对地址。 */
export function imageUrl(url?: string): string {
  return toMiniappUrl(String(url || ''));
}

/** 千分位：小程序 JS 核心对 toLocaleString 支持不稳，按 3 位断点自己插逗号。 */
export function formatPoints(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return String(Math.max(0, Math.trunc(num))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 体积：与网页端一致用 MB 一位小数（1.35MB 比 1382400 好读）。 */
export function formatFileSize(bytes: unknown): string {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '-';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
  return `${(size / 1024 / 1024).toFixed(2)}MB`;
}

/**
 * 默认选中的「模型 + 档位」：优先后台配置的默认值，默认值不在上架清单里就落到第一个。
 * 抽出来的原因：这段选择逻辑网页端写过一遍，两端必须算出同一个默认值，
 * 否则同一个用户在两端看到的初始状态不一样（最容易出现的「两端不一致」）。
 */
export function pickDefaultSelection(config: ImageGenConfig | null | undefined): { model: string; resolution: string } {
  const models = (config?.models || []).filter((item) => item && item.id);
  if (!models.length) return { model: '', resolution: '' };
  const picked = models.find((item) => item.id === config?.defaultModel) || models[0];
  const wanted = (picked.resolutions || []).find((item) => item.value === config?.defaultResolution);
  return { model: picked.id, resolution: (wanted || (picked.resolutions || [])[0] || {}).value || '' };
}

/** 换模型后要不要改档位：新模型不支持当前档位时落到它的第一档，返回 '' 表示维持不变。 */
export function resolutionForModel(model: ImageGenModel | null | undefined, current: string): string {
  const options = (model && model.resolutions) || [];
  if (options.some((item) => item.value === current)) return current;
  return (options[0] || {}).value || '';
}

/**
 * 保存图片到系统相册。
 *
 * @returns 'saved' 已保存 / 'denied' 用户拒绝了相册权限（已弹引导） / 'canceled' 用户在引导弹窗里放弃
 * @throws 下载失败或写入失败（调用方给一句「保存失败，请稍后重试」即可）
 *
 * ⚠️ 微信的相册权限**只会自动弹一次**：用户第一次点了「拒绝」之后再调就静默失败，
 * 必须引导去 openSetting 打开，否则用户会一直觉得「点了没反应」。
 */
export async function saveImageToAlbum(url: string): Promise<'saved' | 'denied' | 'canceled'> {
  const full = imageUrl(url);
  if (!full) throw new Error('图片地址无效');
  const download = await Taro.downloadFile({ url: full });
  const status = Number(download.statusCode) || 0;
  if (status && (status < 200 || status >= 300)) throw new Error(`图片下载失败（HTTP ${status}）`);
  try {
    await Taro.saveImageToPhotosAlbum({ filePath: download.tempFilePath });
    return 'saved';
  } catch (error) {
    const message = String((error as { errMsg?: unknown })?.errMsg || '');
    const denied = /auth\s*deny|auth\s*denied|authorize|permission/i.test(message);
    if (!denied) throw error;
    const confirm = await Taro.showModal({
      title: '需要相册权限',
      content: '保存图片需要「保存到相册」权限，去设置里打开后即可保存。',
      confirmText: '去设置',
      cancelText: '暂不保存',
      confirmColor: '#2864ea',
    });
    if (!confirm.confirm) return 'canceled';
    await Taro.openSetting();
    return 'denied';
  }
}

/**
 * 组装「加入资产库」的记录。
 *
 * 字段与网页端 store.addAsset 完全同构（`/api/data/assets` 按 id 幂等合并，
 * 小程序这条链路是 saveRuntimeAsset → /api/miniapp/v1/assets → 转手写 /api/data/assets），
 * 所以小程序加的图，网页端「我的资产 → 图片」里立刻能看到。
 *
 * ⚠️ 默认落点固定是**图片库**（type:'image'），不做「图文 / 图片」的自动推断 ——
 * 那是网页端已经定死的口径，两端必须一致。
 */
export function buildImageAsset(result: ImageGenResult, fallbackPrompt = ''): Record<string, unknown> {
  const text = String(result.prompt || fallbackPrompt || '').trim();
  const name = text ? (text.length > 24 ? `${text.slice(0, 24)}…` : text) : 'AI全能设计 · 图片';
  return {
    // id 必填：服务端按 id 幂等合并，缺失直接 400（见 /api/data/assets）
    id: `asset${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'success',
    sourceType: 'imageGen',
    sourceId: String(result.model || ''),
    sourceName: 'AI全能设计',
    type: 'image',
    name,
    // 提示词一并存下来，方便在资产库里复制复用
    content: text,
    images: [result.url],
    videos: [],
    audios: [],
    // 算力消耗列（资产库的「消耗算力」直接读 points）
    points: Number(result.chargedPoints) || 0,
    // 档位与比例一并存下来：作品墙的「再次生成」要靠它原样回填
    // （老记录没有这两个字段 → 回填时只用模型，档位落到该模型的第一档）
    resolution: result.resolution || '',
    aspectRatio: result.aspectRatio || '',
    createdAt: new Date().toISOString(),
  };
}

/* ===================== P1：参考图（图生图） ===================== */

/**
 * 参考图上限 —— 三条限制**同时存在**，任何一条超了服务端都会拒：
 *   ① 张数 3（`IMAGE_MAX_REF_IMAGES`）
 *   ② 单张解码后 ≤2MB（`IMAGE_REF_MAX_BYTES`）
 *   ③ 整个请求体 ≤12MB（`IMAGE_REF_BODY_LIMIT`）＋ 微信小程序单请求 10MB
 * 所以客户端必须**真压**：只压质量不缩尺寸时，一张 4000px 的手机原图仍有 500KB+，三张就贴近上限。
 */
export const REF_IMAGE_MAX = 3;
/** 压缩后的最长边（像素）。服务端注释里写的也是「前端先压到 ~1024px 的 JPEG」。 */
const REF_MAX_SIDE = 1024;
const REF_MAX_BYTES = 2 * 1024 * 1024;

export interface RefImage {
  uid: string;
  /** 压缩后的本地临时路径（用于预览与删除后重读） */
  path: string;
  /** 压缩后的字节数（用于在界面上显示「已压到 xxxKB」） */
  size: number;
  mimeType: string;
  /** 纯 base64（不含 data: 前缀）—— 服务端两种都收，但传原始 base64 更省 20 字节/张 */
  data: string;
}

/** 按扩展名判 MIME：compressImage 一般输出 .jpg，但 PNG 入参可能仍是 .png。 */
function mimeOfPath(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

function getImageInfoAsync(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    Taro.getImageInfo({
      src,
      success: (res) => resolve({ width: Number(res.width) || 0, height: Number(res.height) || 0 }),
      fail: (error) => reject(new Error(error.errMsg || '读取图片信息失败')),
    });
  });
}

function getFileSizeAsync(filePath: string) {
  return new Promise<number>((resolve) => {
    Taro.getFileSystemManager().getFileInfo({
      filePath,
      success: (res) => resolve(Number(res.size) || 0),
      // 拿不到体积不该阻断流程：后续 base64 长度校验会兜底
      fail: () => resolve(0),
    });
  });
}

/**
 * 把一张选中图压到「最长边 ≤1024 + 质量 80」。
 *
 * ⚠️ `compressedWidth` / `compressHeight` 需要基础库 2.26.0+（本项目最低版本足够）；
 *    Taro 的类型定义里还没有这两个字段，所以这里显式收窄成一个自定义签名，避免 TS 报错。
 * ⚠️ 压缩本身失败时**不抛错**，退回原图 —— 体积校验会在 pickReferenceImages 里兜底，
 *    在这里抛会让用户「选了一张图就整批失败」。
 */
const compressImageCompat = Taro.compressImage as unknown as (
  options: { src: string; quality?: number; compressedWidth?: number; compressHeight?: number },
) => Promise<{ tempFilePath?: string }>;

export async function compressRefImage(tempPath: string): Promise<{ path: string; size: number }> {
  let path = tempPath;
  try {
    const info = await getImageInfoAsync(tempPath);
    const longest = Math.max(info.width, info.height);
    const scale = longest > REF_MAX_SIDE ? REF_MAX_SIDE / longest : 1;
    const result = await compressImageCompat({
      src: tempPath,
      quality: 80,
      ...(scale < 1
        ? { compressedWidth: Math.max(1, Math.round(info.width * scale)), compressHeight: Math.max(1, Math.round(info.height * scale)) }
        : {}),
    });
    if (result?.tempFilePath) path = result.tempFilePath;
  } catch {
    // 压缩失败 → 用原图，交给下面的体积判定
  }
  let size = await getFileSizeAsync(path);
  if (size > REF_MAX_BYTES) {
    try {
      const again = await compressImageCompat({ src: path, quality: 60 });
      if (again?.tempFilePath) { path = again.tempFilePath; size = await getFileSizeAsync(path); }
    } catch { /* 二次压缩失败就按原样交给调用方判定 */ }
  }
  return { path, size };
}

/**
 * 选参考图：`chooseMedia` → 逐张压缩 → 转 base64。
 *
 * @param remaining 还能选几张（上限 3，调用方用 `REF_IMAGE_MAX - refs.length` 算）
 * @returns 已经压好、可直接塞进 `POST /api/image-gen` 的参考图数组（可能少于请求数：用户可取消）
 * @throws 压缩后仍 >2MB 时抛错 —— 这种图不该悄悄发出去（服务端会 413/400，白等一轮）
 */
export async function pickReferenceImages(remaining: number): Promise<RefImage[]> {
  const count = Math.max(0, Math.min(remaining, REF_IMAGE_MAX));
  if (!count) return [];
  const selected = await Taro.chooseMedia({ count, mediaType: ['image'], sourceType: ['album', 'camera'] });
  const files = (selected.tempFiles || []) as Array<{ tempFilePath: string; size?: number }>;
  const out: RefImage[] = [];
  for (const file of files) {
    const compressed = await compressRefImage(file.tempFilePath);
    if (!compressed.size) continue;
    if (compressed.size > REF_MAX_BYTES) {
      throw new Error('有参考图压缩后仍超过 2MB，请换一张更简单的图');
    }
    const mimeType = mimeOfPath(compressed.path);
    const dataUrl = await fileToDataUrl(compressed.path, mimeType);
    out.push({
      uid: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path: compressed.path,
      size: compressed.size,
      mimeType,
      data: dataUrl.replace(/^data:[^,]*,/, ''),
    });
  }
  return out;
}

/** 参考图 → 服务端认的形态（`prepareReferenceImages` 只认 `{mimeType, data}` 对象，不认裸字符串）。 */
export function toApiRefImages(refs: RefImage[]) {
  return refs.map((item) => ({ mimeType: item.mimeType, data: item.data }));
}

/* ===================== P1：作品墙「再次生成」回填 ===================== */

/**
 * 「再次生成」的参数交接。
 *
 * 为什么不走 URL 参数：提示词最长 2000 字，塞进 query 会超长且被各种转义坑到。
 * 走本地存储 + `navigateBack`，回到创作页由 `useDidShow` 取一次即删。
 */
const REGENERATE_KEY = 'usunai_image_regen_v1';

export interface RegenerateParams {
  prompt: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

export function stashRegenerate(params: RegenerateParams): void {
  try { Taro.setStorageSync(REGENERATE_KEY, params); } catch { /* 存储满时不阻断返回 */ }
}

/** 取出并**立刻清掉**（只用一次，避免下次进页面又被回填一遍）。 */
export function takeRegenerate(): RegenerateParams | null {
  try {
    const raw = Taro.getStorageSync<RegenerateParams>(REGENERATE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    Taro.removeStorageSync(REGENERATE_KEY);
    return {
      prompt: String(raw.prompt || ''),
      model: raw.model ? String(raw.model) : '',
      resolution: raw.resolution ? String(raw.resolution) : '',
      aspectRatio: raw.aspectRatio ? String(raw.aspectRatio) : '',
    };
  } catch {
    return null;
  }
}

/** 作品墙卡片的时间：`M/D HH:mm`（完整时间在预览页/任务详情里看，列表不需要秒）。 */
export function wallTime(value: unknown): string {
  const raw = String(value || '');
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 从一条资产记录里取第一张图（作品墙只收 type==='image' 的记录，理论上必有）。 */
export function firstImageOf(item: Record<string, unknown>): string {
  const list = Array.isArray(item.images) ? item.images : [];
  const first = list.map(String).find((url) => !!url);
  return first || '';
}
