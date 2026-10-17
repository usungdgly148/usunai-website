// Gemini 原生图片生成（零依赖）。
//
// 为什么单独一个模块：凭证与 relay 通道共用（同一个中转站、同一个 Base URL），
// 但**接口根路径不同** —— relay 走 OpenAI 兼容的 `/v1/...`，Gemini 原生走 `/v1beta/models/{model}:generateContent`。
// 直接复用 relayEndpointUrl() 会拼成 `/v1/v1beta/...` → 404，所以这里自己推导根路径。
//
// 实测（2026-10-17，easy88ai / gemini-nano-banana-2.1）：
//   · 响应 **不含 base64**，图片以 `fileData.fileUri`（第三方 CDN）返回，响应体仅 ~537 字节；
//   · CDN 可直接 GET 下载，无需 Authorization；1:1 → 1024×1024 / 852KB，16:9 → 1376×768 / 647KB；
//   · 单张耗时 20~23 秒，candidatesTokenCount ≈ 1377~1441（⇒ 按 token 计价会亏，必须按张计费）;
//   · `generationConfig.imageConfig.aspectRatio` 确实生效。
//   · **图生图不需要单独接口** —— 参考图塞进 parts 的 inlineData 即可，见下方 IMAGE_MAX_REF_IMAGES 段。
// ⚠️ CDN 地址含日期目录（/easy88ai-media/10/17/…），不保证长期有效 ⇒ **必须立刻转存本站**，
//    绝不能把上游 URL 直接交给前端。

import https from 'https';

export const IMAGE_MODEL_DEFAULT = 'gemini-nano-banana-2.1';

// 后台下拉给用户选的宽高比。实测 1:1 与 16:9 生效；其余为 Gemini 原生标准档位，未逐个实测。
export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

// ===== 分辨率（imageConfig.imageSize）=====
// **实测支持（2026-10-17，gemini-nano-banana-2.1，1:1）**：
//   不传 → 1024×1024 / 1.51MB / 29.8s / candidatesToken 599
//   1K   → 1024×1024 / 1.35MB / 23.3s / 565
//   2K   → **2048×2048** / 5.40MB / 36.6s / 2037
//   4K   → **4096×4096** / 18.46MB / 47.4s / 3040
// ⇒ 分辨率是真生效的，且 4K 的 token 是 1K 的 5.4 倍（成本确实上升，必须按档位定价）。
// ⚠️ 另外两个模型（gpt-image-2.5-flare / -sunburst）当前走不通：前者连不传分辨率都回 503，
//    后者报「No available channel … under group」，所以**它们是否支持 imageSize 无法判定**，
//    后台默认不上架，等上游有渠道了再开。
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'];
export const DEFAULT_IMAGE_RESOLUTION = '1K';

// 兜底单张扣点（各模型各档位应有自己的价；这个只在配置缺价时保底，可在 KV 里改）。
export const DEFAULT_IMAGE_PRICE_POINTS = 30;

// 上游单张耗时实测 20~23 秒（4K 47 秒、带 3 张参考图 42 秒），留足余量。
export const IMAGE_TIMEOUT_MS = 180000;
// 下载上限：4K PNG 实测 18.46MB，20MB 会踩线 ⇒ 提到 64MB。
export const IMAGE_MAX_BYTES = 64 * 1024 * 1024;

// ===== 参考图（图生图）=====
// 实测（2026-10-17，同一端点、同一模型）：把参考图放进 `parts[].inlineData` 就能被读取，
// 证据是响应的 `usageMetadata.promptTokensDetails` 里出现 `{ modality:'IMAGE', tokenCount:N }`：
//   1 张 → IMAGE 282 tok / 26.8s / 输出 1024×1024
//   2 张 → IMAGE 574 tok / 36.7s / 输出 1024×1024
//   3 张 → IMAGE 853 tok / 42.2s / 输出 **1792×592**
// ⚠️ 两个必须记住的副作用：① 参考图会拉高上游 token（成本 + 耗时）；
//    ② 参考图数量/比例会**带偏输出尺寸** —— aspectRatio 不再是唯一决定因素。
// ⚠️ 只实测到 3 张，所以上限就钉在 3 张：没验过的区间不开放。
export const IMAGE_MAX_REF_IMAGES = 3;
// 单张解码后上限 2MB。前端会先压到 ~1024px 的 JPEG（实测 150~350KB），这里留足余量。
export const IMAGE_REF_MAX_BYTES = 2 * 1024 * 1024;
// 生图路由**专用**的请求体上限：3 张 ×（2MB → base64 约 2.73MB）+ prompt，给 12MB 让得开。
// ⚠️ 绝不能用全局 MAX_JSON_BODY_BYTES（1MB）—— 那会把所有带参考图的请求直接 413 掉。
export const IMAGE_REF_BODY_LIMIT = 12 * 1024 * 1024;
// 实测驼峰 inlineData 可用。png/jpeg 是 Gemini 原生支持格式，webp 也在官方支持列表内。
export const IMAGE_REF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * 把中转站 Base URL 归一化成 Gemini 原生接口的根路径。
 *   https://api.easy88ai.com/v1      → { hostname, port:443, root:'' }
 *   https://api.easy88ai.com/v1beta  → root:''
 *   https://api.easy88ai.com         → root:''
 *   https://api.easy88ai.com/proxy/v1 → root:'/proxy'
 */
export function resolveGeminiRoot(baseUrl) {
  const raw = String(baseUrl == null ? '' : baseUrl).trim().replace(/\/+$/, '');
  if (!raw) throw new Error('中转站 Base URL 为空');
  if (!/^https:\/\//i.test(raw)) throw new Error('中转站 Base URL 必须使用 HTTPS');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('中转站 Base URL 格式不正确');
  }
  if (!parsed.hostname) throw new Error('中转站 Base URL 格式不正确');
  const root = parsed.pathname.replace(/\/+$/, '').replace(/\/(v1beta|v1)$/i, '');
  return { hostname: parsed.hostname, port: Number(parsed.port) || 443, root };
}

/** 拼出 :generateContent 的完整目标（hostname / port / path）。 */
export function imageEndpoint(baseUrl, model) {
  const name = String(model || '').trim() || IMAGE_MODEL_DEFAULT;
  const { hostname, port, root } = resolveGeminiRoot(baseUrl);
  return { hostname, port, model: name, path: `${root}/v1beta/models/${name}:generateContent` };
}

/**
 * 校验并归一化参考图。返回 `[{ mimeType, data }]`，data 是**纯 base64**（剥掉 data:...;base64, 前缀）。
 * 这里是硬校验 —— 前端压缩只是体验优化，**不能当成信任边界**（任何人都能直接打接口）。
 * 出错抛 Error，并带 code 便于前端区分文案。
 */
export function prepareReferenceImages(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw Object.assign(new Error('参考图参数格式不正确'), { code: 'IMAGE_REF_INVALID' });
  }
  if (list.length > IMAGE_MAX_REF_IMAGES) {
    throw Object.assign(new Error(`参考图最多 ${IMAGE_MAX_REF_IMAGES} 张`), { code: 'IMAGE_REF_TOO_MANY' });
  }
  const out = [];
  for (const item of list) {
    const rawMime = String((item && item.mimeType) || '')
      .trim()
      .toLowerCase()
      .replace(/^image\/jpg$/, 'image/jpeg');
    if (!IMAGE_REF_MIME_TYPES.includes(rawMime)) {
      throw Object.assign(new Error('参考图只支持 JPG / PNG / WebP'), { code: 'IMAGE_REF_BAD_TYPE' });
    }
    let data = String((item && (item.data || item.base64)) || '').trim();
    if (/^data:/i.test(data)) {
      const marker = data.indexOf('base64,');
      data = marker >= 0 ? data.slice(marker + 7) : '';
    }
    data = data.replace(/\s+/g, '');
    if (!data) throw Object.assign(new Error('参考图内容为空'), { code: 'IMAGE_REF_EMPTY' });
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw Object.assign(new Error('参考图编码不正确'), { code: 'IMAGE_REF_INVALID' });
    }
    const bytes = Math.floor((data.replace(/=+$/, '').length * 3) / 4);
    if (bytes > IMAGE_REF_MAX_BYTES) {
      throw Object.assign(
        new Error(`单张参考图不能超过 ${Math.round(IMAGE_REF_MAX_BYTES / 1024 / 1024)}MB`),
        { code: 'IMAGE_REF_TOO_LARGE' },
      );
    }
    out.push({ mimeType: rawMime, data });
  }
  return out;
}

/** 归一化分辨率：只认 1K/2K/4K（大小写不敏感），其它一律当未指定。 */
export function normalizeResolution(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  return IMAGE_RESOLUTIONS.includes(text) ? text : '';
}

/**
 * 构造请求体。aspectRatio 为空则不传 imageConfig（走上游默认）。
 * 有参考图时：text 在前、图在后，全部平铺在同一个 parts 数组里（实测上游按顺序读）。
 * resolution 非空时写 `imageConfig.imageSize`（实测真生效，见文件头实测表）。
 */
export function buildImagePayload({ prompt, aspectRatio, resolution, images } = {}) {
  const text = String(prompt == null ? '' : prompt).trim();
  if (!text) throw new Error('请填写画面描述');
  const refs = prepareReferenceImages(images);
  const parts = [{ text }];
  for (const image of refs) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  const generationConfig = { responseModalities: ['IMAGE'] };
  const ratio = String(aspectRatio == null ? '' : aspectRatio).trim();
  const size = normalizeResolution(resolution);
  if (ratio || size) {
    generationConfig.imageConfig = {};
    if (ratio) generationConfig.imageConfig.aspectRatio = ratio;
    if (size) generationConfig.imageConfig.imageSize = size;
  }
  return { contents: [{ role: 'user', parts }], generationConfig };
}

/**
 * 从上游响应里取图。两种形态都要认：
 *   · inlineData（base64）—— 部分模型/网关会这样回；
 *   · fileData.fileUri（CDN URL）—— 实测 gemini-nano-banana-2.1 走这条。
 * ⚠️ 只有 HTTP 200 是不够的：安全策略拦截会回 200 + 无图，必须显式判「没有图」。
 */
export function extractImageResult(json) {
  const candidates = Array.isArray(json && json.candidates) ? json.candidates : [];
  const blockReason = (json && json.promptFeedback && json.promptFeedback.blockReason) || null;
  if (!candidates.length) {
    return { ok: false, reason: blockReason ? 'blocked' : 'empty', blockReason, finishReason: null, text: '' };
  }
  const cand = candidates[0] || {};
  const parts = Array.isArray(cand.content && cand.content.parts) ? cand.content.parts : [];
  let inline = null;
  let file = null;
  let text = '';
  for (const part of parts) {
    if (!inline && part && part.inlineData && part.inlineData.data) {
      inline = { mimeType: String(part.inlineData.mimeType || 'image/png'), base64: String(part.inlineData.data) };
    }
    if (!file && part && part.fileData && part.fileData.fileUri) {
      file = { mimeType: String(part.fileData.mimeType || 'image/jpeg'), url: String(part.fileData.fileUri) };
    }
    if (part && part.text) text += String(part.text);
  }
  const finishReason = cand.finishReason || null;
  if (inline || file) return { ok: true, inline, file, text, finishReason, blockReason };
  return { ok: false, reason: blockReason ? 'blocked' : 'no_image', blockReason, finishReason, text };
}

/** 把上游 HTTP 错误翻译成给人看的中文，并给出机器可读 code。 */
export function describeUpstreamError(statusCode, bodyText) {
  const detail = String(bodyText || '').trim().slice(0, 300).replace(/\s+/g, ' ');
  if (statusCode === 401 || statusCode === 403) {
    return { code: 'IMAGE_AUTH_INVALID', status: 502, message: '图片模型授权无效或该令牌没有图片模型权限，请到「AI 授权管理」检查 usun-img 凭证的分组' };
  }
  if (statusCode === 404) {
    return { code: 'IMAGE_MODEL_NOT_FOUND', status: 502, message: `图片模型不存在或接口路径不对${detail ? '（上游：' + detail + '）' : ''}` };
  }
  if (statusCode === 429) {
    return { code: 'IMAGE_RATE_LIMITED', status: 429, message: '图片生成频率或配额已超限，请稍后再试' };
  }
  if (statusCode === 400) {
    return { code: 'IMAGE_BAD_REQUEST', status: 502, message: `图片生成参数被上游拒绝${detail ? '（上游：' + detail + '）' : ''}` };
  }
  // 503 实测有两种成因（都用这一条覆盖）：模型服务临时不可用、或该分组下没有可用渠道。
  // 2026-10-17 实测：gpt-image-2.5-flare 连不传分辨率都 503；-sunburst 报「No available channel …」。
  if (statusCode === 503) {
    return { code: 'IMAGE_MODEL_UNAVAILABLE', status: 503, message: `该模型上游暂无可用渠道或服务暂时不可用，请换一个模型或稍后再试${detail ? '（上游：' + detail + '）' : ''}` };
  }
  return { code: 'IMAGE_UPSTREAM_ERROR', status: 502, message: `图片生成上游异常（HTTP ${statusCode}）${detail ? '：' + detail : ''}` };
}

/**
 * 调上游生成图片。成功返回解析后的 JSON；失败抛错（error.code / error.status / error.message）。
 * ⚠️ 响应体默认上限给 8MB（实测仅 ~537 字节），这与对话通道的 1MB 默认值不同 —— 不要照抄。
 */
export function requestGeminiImage({ baseUrl, apiKey, payload, model, timeoutMs = IMAGE_TIMEOUT_MS }) {
  const target = imageEndpoint(baseUrl, model);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > 8 * 1024 * 1024) {
          req.destroy();
          reject(Object.assign(new Error('图片生成响应体过大'), { code: 'IMAGE_RESPONSE_TOO_LARGE', status: 502 }));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const described = describeUpstreamError(response.statusCode, text);
          reject(Object.assign(new Error(described.message), { code: described.code, status: described.status }));
          return;
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          reject(Object.assign(new Error(`图片生成上游返回的不是 JSON（前 200 字符：${text.slice(0, 200)}）`), { code: 'IMAGE_BAD_RESPONSE', status: 502 }));
          return;
        }
        resolve(json);
      });
      response.on('error', reject);
    });
    req.on('error', (error) => reject(Object.assign(new Error(`图片生成请求失败：${error.message}`), { code: 'IMAGE_NETWORK', status: 502 })));
    req.on('timeout', () => req.destroy(new Error('图片生成超时（上游未在限定时间内返回）')));
    req.end(body);
  });
}

/**
 * 下载上游图片。只允许 HTTPS，带大小上限与超时。
 * 上游 CDN 实测无需鉴权；这里仍显式只接受 https，避免 fileUri 被伪造成 file:// 之类。
 */
export function downloadImage(url, { timeoutMs = 60000, maxBytes = IMAGE_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      reject(new Error('图片地址无效'));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error('图片地址必须是 HTTPS'));
      return;
    }
    const req = https.request({
      hostname: parsed.hostname,
      port: Number(parsed.port) || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { Accept: 'image/*' },
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(Object.assign(new Error(`下载生成的图片失败（HTTP ${response.statusCode}）`), { code: 'IMAGE_DOWNLOAD_FAILED', status: 502 }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > maxBytes) {
          req.destroy();
          reject(Object.assign(new Error('生成的图片超过大小上限'), { code: 'IMAGE_TOO_LARGE', status: 502 }));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: String(response.headers['content-type'] || ''),
      }));
      response.on('error', reject);
    });
    req.on('error', (error) => reject(Object.assign(new Error(`下载生成的图片失败：${error.message}`), { code: 'IMAGE_DOWNLOAD_FAILED', status: 502 })));
    req.on('timeout', () => req.destroy(new Error('下载生成的图片超时')));
    req.end();
  });
}

/** 把图片字节落成本站图床的 key（前缀必须是 uploads/，其它代码靠它识别本站文件）。 */
export function makeImageStorageKey(mimeType) {
  const ext = /png/i.test(String(mimeType || '')) ? 'png' : /webp/i.test(String(mimeType || '')) ? 'webp' : 'jpg';
  return `uploads/gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

// ===== 定价（模型 × 分辨率 → 点数）=====
// 设计要点：价格**不在代码里写死**，全部来自 KV `imageGenSettings.models[].prices`；
// 代码只负责「哪个组合合法、该扣多少」，后台随时改价、改上架模型都不需要发版。

/**
 * 归一化后台配置的模型清单。用于把 KV 里的脏数据收敛成可信结构。
 * 每条：{ id, label, enabled, prices: { '1K':30, '2K':60, '4K':120 } }
 * 兼容老配置（只有 `model` + `pricePoints` 的单模型结构）。
 */
export function normalizeImageModels(list, {
  legacyModel = '',
  legacyPrice = 0,
  fallbackPoints = DEFAULT_IMAGE_PRICE_POINTS,
} = {}) {
  const source = Array.isArray(list) ? list : [];
  const out = [];
  for (const item of source) {
    const id = String((item && item.id) || '').trim();
    if (!id) continue;
    if (out.some((model) => model.id === id)) continue;
    const pricesRaw = (item && item.prices) || {};
    const prices = {};
    for (const resolution of IMAGE_RESOLUTIONS) {
      const value = Number(pricesRaw[resolution]);
      if (Number.isFinite(value) && value > 0) prices[resolution] = Math.ceil(value);
    }
    out.push({
      id,
      label: String((item && item.label) || '').trim() || id,
      // 没配价的模型视为未上架（否则用户能选到「无价」组合）
      enabled: item && item.enabled === false ? false : Object.keys(prices).length > 0,
      prices,
    });
  }
  if (out.length) return out;
  // 老配置迁移：只有一个模型 + 一个价 → 只开放默认档位，其余档位留给后台补价
  const id = String(legacyModel || '').trim() || IMAGE_MODEL_DEFAULT;
  const legacy = Number(legacyPrice);
  const points = Number.isFinite(legacy) && legacy > 0
    ? Math.ceil(legacy)
    : Math.ceil(Number(fallbackPoints) > 0 ? Number(fallbackPoints) : DEFAULT_IMAGE_PRICE_POINTS);
  return [{ id, label: id, enabled: true, prices: { [DEFAULT_IMAGE_RESOLUTION]: points } }];
}

/**
 * 解析一次请求最终用哪个模型、哪档分辨率、扣多少点。
 * 返回 { ok:true, model, label, resolution, points } 或 { ok:false, code, message }。
 * ⚠️ 这是**计费唯一入口**：路由不许自己算价，否则迟早两处不一致。
 */
export function resolveImageSelection(settings, requestedModel, requestedResolution) {
  const models = settings && Array.isArray(settings.models) ? settings.models : [];
  const enabled = models.filter((model) => model && model.enabled !== false);
  if (!enabled.length) {
    return { ok: false, code: 'IMAGE_NO_MODEL_AVAILABLE', message: '暂时没有可用的生图模型，请稍后再试' };
  }
  const wanted = String(requestedModel == null ? '' : requestedModel).trim();
  const fallbackModel = String((settings && settings.defaultModel) || '').trim();
  const modelId = wanted || fallbackModel || enabled[0].id;
  const entry = enabled.find((model) => model.id === modelId);
  if (!entry) {
    return { ok: false, code: 'IMAGE_MODEL_NOT_AVAILABLE', message: `模型 ${modelId} 当前未上架，请换一个模型` };
  }
  const supported = Object.keys(entry.prices || {});
  if (!supported.length) {
    return { ok: false, code: 'IMAGE_PRICE_NOT_CONFIGURED', message: '该模型还没有配置价格，请联系管理员' };
  }
  const asked = normalizeResolution(requestedResolution);
  const presetDefault = normalizeResolution(settings && settings.defaultResolution);
  const resolution = asked
    || (supported.includes(presetDefault) ? presetDefault : (supported.includes(DEFAULT_IMAGE_RESOLUTION) ? DEFAULT_IMAGE_RESOLUTION : supported[0]));
  if (!supported.includes(resolution)) {
    return { ok: false, code: 'IMAGE_RESOLUTION_NOT_SUPPORTED', message: `模型 ${entry.label || entry.id} 不支持 ${String(requestedResolution || resolution)} 分辨率` };
  }
  const raw = Number(entry.prices[resolution]);
  const fallback = Number(settings && settings.fallbackPoints);
  const points = Number.isFinite(raw) && raw > 0
    ? Math.ceil(raw)
    : (Number.isFinite(fallback) && fallback > 0 ? Math.ceil(fallback) : 0);
  if (!points) {
    return { ok: false, code: 'IMAGE_PRICE_NOT_CONFIGURED', message: '该模型该分辨率还没有配置价格，请联系管理员' };
  }
  return { ok: true, model: entry.id, label: entry.label || entry.id, resolution, points };
}
