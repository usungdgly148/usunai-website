// 前端图片压缩：把上传的原图（常为 2MB+）缩放到 maxWidth 以内并转 JPEG，
// 体积通常降到 1/5 ~ 1/10，显著加快后台/前台加载、避免 base64 撑爆 localStorage。
// 仅用于 Banner 这类满铺照片，透明 PNG 以白底兜底（JPEG 不支持透明）。GIF 不处理（canvas 会丢动画）。

export async function compressImage(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file; // GIF 直接返回，保留动画
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, maxWidth / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return file;
    const name = (file.name || 'banner').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file; // 压缩失败退回原图
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
