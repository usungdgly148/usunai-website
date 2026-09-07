// 资产展示工具：输出格式与网页端（frontend/src/assetUtils.js + Assets.jsx）保持一致。
// 表格列与「任务详情」弹窗共用这里的格式化/媒体提取逻辑，避免双端展示不一致。

export const SOURCE_TYPE_NAMES: Record<string, string> = {
  agent: 'AI 对话',
  workflow: '工作流',
};

export const ASSET_TYPE_NAMES: Record<string, string> = {
  task: '任务',
  copy: '文案',
  image: '图片',
  video: '视频',
  audio: '音频',
  graphic: '图文',
};

const textOf = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

/** 时间：与网页端 toLocaleString('zh-CN') 视觉一致 —— 「YYYY/M/D HH:mm:ss」。 */
export function formatTime(value: unknown): string {
  const raw = textOf(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 秒 → 「22s」/「1分3秒」（与网页端 formatDuration 完全同款）。 */
function formatSeconds(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}分${s}秒`;
  }
  return `${seconds < 1 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/** 耗时：数值按秒处理（与网页端一致）；已是展示串则原样返回。 */
export function formatDuration(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return textOf(value) || '-';
  return formatSeconds(n);
}

/** 消耗算力：tokens 优先「N Tokens」，其次「N 点」（与网页端 formatCost 一致）。 */
export function formatCost(cost: unknown, tokens: unknown): string {
  const t = Number(tokens);
  if (Number.isFinite(t) && t > 0) return `${t} Tokens`;
  const c = Number(cost);
  if (Number.isFinite(c) && c > 0) return `${c} 点`;
  return '-';
}

/** 从资产对象读取消耗（兼容 tokens / cost 之外的历史字段名）。 */
export function formatAssetCost(item: Record<string, unknown>): string {
  const tokens = item.tokens ?? item.computeTokens ?? item.consumeTokens;
  const cost = item.cost ?? item.points ?? item.delta ?? item.costPoints ?? item.amount;
  return formatCost(cost, tokens);
}

/** 类型列：优先网页端的来源类型（agent→AI 对话 / workflow→工作流），缺失时回退资产类型枚举。 */
export function formatAssetType(item: Record<string, unknown>): string {
  const sourceType = textOf(item.sourceType).trim().toLowerCase();
  if (sourceType && SOURCE_TYPE_NAMES[sourceType]) return SOURCE_TYPE_NAMES[sourceType];
  const raw = textOf(item.kind ?? item.type ?? item.category ?? '').trim();
  if (!raw) return sourceType || '-';
  const key = raw.toLowerCase();
  if (ASSET_TYPE_NAMES[key]) return ASSET_TYPE_NAMES[key];
  const map: Record<string, string> = {
    agent: 'AI 对话', chat: 'AI 对话', workflow: '工作流',
    copy: '文案', text: '文案',
    image: '图片', picture: '图片', photo: '图片',
    video: '视频',
    audio: '音频', voice: '音频',
    article: '图文', graphic: '图文', 'image-text': '图文', image_text: '图文',
  };
  return map[key] || raw;
}

/** 来源：网页端底部展示「AI 对话 · xxx」。 */
export function formatAssetSource(item: Record<string, unknown>): string {
  const type = textOf(item.sourceType).trim().toLowerCase();
  const name = textOf(item.sourceName).trim();
  const typeLabel = SOURCE_TYPE_NAMES[type] || type;
  if (typeLabel && name) return `${typeLabel} · ${name}`;
  return typeLabel || name || '-';
}

/** 状态 → 徽标 class。 */
export function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (['succeeded', 'success', 'completed', 'finished', 'done', '成功'].some(k => s.includes(k))) return 'mini-asset-status-success';
  if (['running', 'pending', 'processing', 'queued', '执行中', '进行中'].some(k => s.includes(k))) return 'mini-asset-status-running';
  if (['failed', 'error', 'fail', '失败'].some(k => s.includes(k))) return 'mini-asset-status-failed';
  return 'mini-asset-status-default';
}

/** 状态 → 中文文案。 */
export function statusText(status: string): string {
  const s = status.toLowerCase();
  if (['succeeded', 'success', 'completed', 'finished', 'done'].some(k => s.includes(k))) return '成功';
  if (['running', 'processing'].some(k => s.includes(k))) return '执行中';
  if (['pending', 'queued', 'waiting'].some(k => s.includes(k))) return '排队中';
  if (['failed', 'error', 'fail'].some(k => s.includes(k))) return '失败';
  return status || '-';
}

// ============ 媒体提取（移植自网页端 assetUtils.js） ============

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|webm|mkv|avi|flv|m3u8)(\?|$)/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac|wma)(\?|$)/i;

// AI 平台图床域名提示：这些 URL 常不带扩展名（例：xxx.byteimg.com/...~tplv-xxx-image.image）
const IMAGE_HINTS = [
  'picsum', 'unsplash', 'imgur', 'flickr', 'placeholder',
  'coze', 'byteimg', 'volces', 'ark-', 'bytedance', 'pstatp',
  'snssdk', 'douyin', 'alicdn', 'oss-', 'juejin',
];
const VIDEO_HINTS = ['player', 'bilibili', 'youtube', 'youtu', 'vimeo', 'twitch'];
const AUDIO_HINTS = ['soundcloud', 'spotify', 'podcast', 'radio'];

function isCleanUrl(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  // 不能含 JSON 噪音字符，否则整段 JSON 会被误判成 URL
  return !/[\s{}"\\\n\r\t]/.test(s);
}

export function isImageUrl(url: unknown): boolean {
  if (!isCleanUrl(url)) return false;
  const s = String(url);
  if (IMAGE_EXTENSIONS.test(s)) return true;
  if (/^data:image\//i.test(s)) return true;
  return IMAGE_HINTS.some(h => s.toLowerCase().includes(h));
}

export function isVideoUrl(url: unknown): boolean {
  if (!isCleanUrl(url)) return false;
  const s = String(url);
  if (VIDEO_EXTENSIONS.test(s)) return true;
  return VIDEO_HINTS.some(h => s.toLowerCase().includes(h));
}

export function isAudioUrl(url: unknown): boolean {
  if (!isCleanUrl(url)) return false;
  const s = String(url);
  if (AUDIO_EXTENSIONS.test(s)) return true;
  return AUDIO_HINTS.some(h => s.toLowerCase().includes(h));
}

/** 从文本中抽取 URL（支持 Markdown 链接与裸 URL）。 */
export function extractUrls(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const urls: string[] = [];
  const md = text.match(/\[([^\]]*)\]\(([^)]+)\)/g) || [];
  md.forEach((m) => {
    const match = m.match(/\[([^\]]*)\]\(([^)]+)\)/);
    if (match) urls.push(match[2]);
  });
  const bare = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) || [];
  bare.forEach((u) => { if (!urls.includes(u)) urls.push(u); });
  return urls;
}

export interface MediaBuckets { images: string[]; videos: string[]; audios: string[]; }
export interface MediaSet extends MediaBuckets { text: string; }

/** 递归收集任意对象/数组/字符串中的媒体 URL（字符串先尝试 JSON.parse 穿透）。 */
export function collectMedia(value: unknown, out: MediaBuckets = { images: [], videos: [], audios: [] }): MediaBuckets {
  if (value === null || value === undefined) return out;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') return collectMedia(parsed, out);
      } catch { /* 非合法 JSON，按普通字符串处理 */ }
    }
    if (isVideoUrl(value)) out.videos.push(value);
    else if (isAudioUrl(value)) out.audios.push(value);
    else if (isImageUrl(value)) out.images.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectMedia(v, out));
  } else if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => collectMedia(v, out));
  }
  return out;
}

export function extractMediaFromText(text: unknown): MediaBuckets {
  const out: MediaBuckets = { images: [], videos: [], audios: [] };
  extractUrls(text).forEach((url) => {
    if (isImageUrl(url)) out.images.push(url);
    else if (isVideoUrl(url)) out.videos.push(url);
    else if (isAudioUrl(url)) out.audios.push(url);
  });
  return out;
}

/** 从工作流/智能体结果中提取文本与媒体。 */
export function extractResultMedia(result: { text?: string; kind?: string; data?: unknown } | null | undefined): MediaSet {
  if (!result) return { text: '', images: [], videos: [], audios: [] };
  let text = result.text || '';
  if (result.kind === 'json' && result.data && typeof result.data === 'string' && !text) text = result.data;
  const out = collectMedia(result);
  const fromText = extractMediaFromText(text);
  fromText.images.forEach((u) => { if (!out.images.includes(u)) out.images.push(u); });
  fromText.videos.forEach((u) => { if (!out.videos.includes(u)) out.videos.push(u); });
  fromText.audios.forEach((u) => { if (!out.audios.includes(u)) out.audios.push(u); });
  return {
    text,
    images: [...new Set(out.images)],
    videos: [...new Set(out.videos)],
    audios: [...new Set(out.audios)],
  };
}

/** 从资产 content 字段抽取媒体（content 可能是 {"output":"..."} 这类 JSON 串）。 */
export function mediaFromAssetContent(content: unknown): MediaSet {
  const raw = typeof content === 'string' ? content : content === null || content === undefined ? '' : String(content);
  const trimmed = raw.trim();
  if (!trimmed) return { text: raw, images: [], videos: [], audios: [] };
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return extractResultMedia({ text: raw, kind: 'json', data: parsed });
    } catch { /* 非合法 JSON，按纯文本处理 */ }
  }
  return extractResultMedia({ text: raw, kind: 'text' });
}
