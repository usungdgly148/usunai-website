// 资产库通用工具：从文本/结果中提取媒体并判定资产类型

export const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i;
export const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv|avi|flv|m3u8)(\?|$)/i;
export const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac|wma)(\?|$)/i;

// 图片 CDN 域名提示（fallback，仅当 URL 不匹配扩展名时才用）
// 2026-07-31：加上 Coze/ByteDance/火山方舟 等 AI 平台的图床域名（byteimg/volces/ark/cdn.coze 等），
// 这些平台的图片 URL 经常不带 .png/.jpg 扩展名（例：xxx.byteimg.com/...~tplv-xxx-image.image），
// 漏掉这些 hint 会导致即梦/GPT image 等 AI 生图工作流的结果无法加入资产库。
// 误判风险可控：仅 workflow 结果转资产时触发，非图像 URL 在 byteimg 上很罕见。
const IMAGE_HINTS = [
  'picsum', 'unsplash', 'imgur', 'flickr', 'images.unsplash', 'placeholder',
  'coze', 's.coze', 'byteimg', 'volces', 'ark-', 'bytedance', 'pstatp',
  'snssdk', 'douyin', 'alicdn', 'oss-', 'juejin',
];
const VIDEO_HINTS = ['player', 'bilibili', 'youtube', 'youtu', 'vimeo', 'twitch'];
const AUDIO_HINTS = ['soundcloud', 'spotify', 'podcast', 'radio'];

// 必须是干净 URL：以 http(s):// 开头，且不能含 JSON 噪音字符（否则整段 JSON 字符串会被误判为 URL）
function isCleanUrl(s) {
  if (!s || typeof s !== 'string') return false;
  if (!/^https?:\/\//i.test(s)) return false;
  if (/[\s{}"\\\n\r\t]/.test(s)) return false;
  return true;
}

export function isImageUrl(url) {
  if (!isCleanUrl(url)) return false;
  const lower = url.toLowerCase();
  if (IMAGE_EXTENSIONS.test(url)) return true;
  if (/^data:image\//i.test(url)) return true;
  return IMAGE_HINTS.some((h) => lower.includes(h));
}

export function isVideoUrl(url) {
  if (!isCleanUrl(url)) return false;
  const lower = url.toLowerCase();
  if (VIDEO_EXTENSIONS.test(url)) return true;
  return VIDEO_HINTS.some((h) => lower.includes(h));
}

export function isAudioUrl(url) {
  if (!isCleanUrl(url)) return false;
  const lower = url.toLowerCase();
  if (AUDIO_EXTENSIONS.test(url)) return true;
  return AUDIO_HINTS.some((h) => lower.includes(h));
}

export function isMediaUrl(url) {
  return isImageUrl(url) || isVideoUrl(url) || isAudioUrl(url);
}

// 从任意对象/数组/字符串中递归收集媒体 URL
// 字符串优先尝试 JSON.parse（穿透工作流把 data 返成 JSON 字符串的情况），解析失败再走 URL 判定
export function collectMedia(value, out = { images: [], videos: [], audios: [] }) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return collectMedia(parsed, out);
        }
      } catch { /* 不是合法 JSON，按普通字符串处理 */ }
    }
    if (isVideoUrl(value)) out.videos.push(value);
    else if (isAudioUrl(value)) out.audios.push(value);
    else if (isImageUrl(value)) out.images.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectMedia(v, out));
  } else if (typeof value === 'object') {
    Object.values(value).forEach((v) => collectMedia(v, out));
  }
  return out;
}

// 从文本中抽取 URL（支持 Markdown 链接与纯 URL）
export function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const urls = [];
  // Markdown 链接
  const md = text.match(/\[([^\]]*)\]\(([^\)]+)\)/g) || [];
  md.forEach((m) => {
    const match = m.match(/\[([^\]]*)\]\(([^\)]+)\)/);
    if (match) urls.push(match[2]);
  });
  // 裸 URL
  const bare = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) || [];
  bare.forEach((u) => { if (!urls.includes(u)) urls.push(u); });
  return urls;
}

export function extractMediaFromText(text) {
  const out = { images: [], videos: [], audios: [] };
  extractUrls(text).forEach((url) => {
    if (isImageUrl(url)) out.images.push(url);
    else if (isVideoUrl(url)) out.videos.push(url);
    else if (isAudioUrl(url)) out.audios.push(url);
  });
  return out;
}

// 从工作流/智能体结果中提取文本与媒体
export function extractResultMedia(result) {
  if (!result) return { text: '', images: [], videos: [], audios: [] };
  let text = result.text || '';
  if (result.kind === 'json' && result.data) {
    // 如果 data 是字符串，也作为文本来源
    if (typeof result.data === 'string' && !text) text = result.data;
  }
  const out = collectMedia(result);
  const fromText = extractMediaFromText(text);
  fromText.images.forEach((u) => { if (!out.images.includes(u)) out.images.push(u); });
  fromText.videos.forEach((u) => { if (!out.videos.includes(u)) out.videos.push(u); });
  fromText.audios.forEach((u) => { if (!out.audios.includes(u)) out.audios.push(u); });

  // 去重
  out.images = [...new Set(out.images)];
  out.videos = [...new Set(out.videos)];
  out.audios = [...new Set(out.audios)];
  return { text, ...out };
}

// 根据内容特征决定资产类型
// 注意：视频/音频即使附带文案，也应归入对应媒体库（而非图文/文案），避免视频被误判进图文库
export function classifyAsset({ text, images, videos, audios, sourceName } = {}) {
  const hasText = !!(text && String(text).trim());
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasVideos = Array.isArray(videos) && videos.length > 0;
  const hasAudios = Array.isArray(audios) && audios.length > 0;

  // 媒体优先：视频/音频即使带文案也优先归入对应媒体库
  if (hasVideos) return 'video';
  if (hasAudios) return 'audio';
  // 图文：图片 + 文案
  if (hasImages && hasText) return 'graphic';
  if (hasImages) return 'image';
  if (hasText) return 'copy';
  return 'copy';
}

export const ASSET_TYPE_NAMES = {
  task: '任务',
  copy: '文案',
  image: '图片',
  video: '视频',
  audio: '音频',
  graphic: '图文',
};

export const SOURCE_TYPE_NAMES = {
  agent: 'AI 对话',
  workflow: '工作流',
};

export function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) return '-';
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}分${s}秒`;
  }
  return `${seconds < 1 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

export function formatCost(cost, tokens) {
  if (tokens && Number(tokens) > 0) return `${tokens} Tokens`;
  if (cost !== undefined && cost !== null && Number(cost) > 0) return `${cost} 点`;
  return '-';
}
