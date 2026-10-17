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
// ⚠️ CDN 地址含日期目录（/easy88ai-media/10/17/…），不保证长期有效 ⇒ **必须立刻转存本站**，
//    绝不能把上游 URL 直接交给前端。

import https from 'https';

export const IMAGE_MODEL_DEFAULT = 'gemini-nano-banana-2.1';

// 后台下拉给用户选的宽高比。实测 1:1 与 16:9 生效；其余为 Gemini 原生标准档位，未逐个实测。
export const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

// 单张扣点默认值（可在 KV `imageGenSettings.pricePoints` 覆盖）。
export const DEFAULT_IMAGE_PRICE_POINTS = 20;

// 上游单张耗时实测 20~23 秒，留足余量。
export const IMAGE_TIMEOUT_MS = 150000;
// 下载上限：实测最大 852KB，给 20MB 余量（换更高分辨率模型也不至于被卡）。
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

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

/** 构造请求体。aspectRatio 为空则不传 imageConfig（走上游默认）。 */
export function buildImagePayload({ prompt, aspectRatio } = {}) {
  const text = String(prompt == null ? '' : prompt).trim();
  if (!text) throw new Error('请填写画面描述');
  const generationConfig = { responseModalities: ['IMAGE'] };
  const ratio = String(aspectRatio == null ? '' : aspectRatio).trim();
  if (ratio) generationConfig.imageConfig = { aspectRatio: ratio };
  return { contents: [{ role: 'user', parts: [{ text }] }], generationConfig };
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
