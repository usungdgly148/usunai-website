import Taro from '@tarojs/taro';
import type { ImageGenConfig, ImageGenModel, ImageGenResult } from '../types';
import { toMiniappUrl } from '../utils/entity-visual';

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
    createdAt: new Date().toISOString(),
  };
}
