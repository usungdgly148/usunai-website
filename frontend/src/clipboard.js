// 复制到剪贴板：兼容非安全上下文（本项目线上是 HTTP 部署，
// navigator.clipboard 在 http:// 域名下为 undefined，直接调用会抛错导致点击无反应）。
// 优先用异步 Clipboard API（HTTPS / localhost），失败或不可用时回退 execCommand('copy')。
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  // 1) 现代异步 API（仅安全上下文：HTTPS / localhost）
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // 落到兜底方案
    }
  }

  // 2) execCommand 兜底（必须同步在用户手势内执行）
  //    关键：textarea 仅离屏定位，不要 display:none / pointerEvents:none / 负 z-index
  //    （这些会导致 focus() 失效、选区为空，execCommand 返回 true 却不复制）。
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.padding = '0';
      ta.style.border = 'none';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {
      // 落到最后的兜底
    }
  }

  // 3) 最后再试一次 clipboard（兼容某些环境下 isSecureContext 误判）
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // 忽略
    }
  }

  return false;
}
