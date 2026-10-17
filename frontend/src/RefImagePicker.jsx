import { useRef, useState } from 'react';
import { ImagePlus, X, Loader2, AlertCircle } from 'lucide-react';
import { compressImage, formatImageBytes } from './imageCompress.js';

// 与服务端 server/gemini-image.mjs 保持一致（那边是唯一实现）。
// 前端限制只是体验优化，服务端仍会重新硬校验一遍。
export const MAX_REF_IMAGES = 3;
export const REF_MAX_BYTES = 2 * 1024 * 1024;
// 原图上限：再大就不值得在浏览器里解码了（手机原图通常 2~8MB，够用）
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 把 File 读成纯 base64（不含 data: 前缀）。
 */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const marker = text.indexOf('base64,');
      resolve(marker >= 0 ? text.slice(marker + 7) : '');
    };
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/** 页面提交时用它转成接口要的格式。 */
export function toApiImages(refs) {
  return (refs || []).map((item) => ({ mimeType: item.mimeType, data: item.data }));
}

/**
 * 参考图选择器：最多 MAX_REF_IMAGES 张，选中即压缩成 ~1024px 的 JPEG。
 * 受控组件 —— 图片数组由父级持有（提交时要拿 data）。
 */
export default function RefImagePicker({ value = [], onChange, disabled = false, showHint = true }) {
  const inputRef = useRef(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const full = value.length >= MAX_REF_IMAGES;

  const pick = async (event) => {
    const picked = Array.from(event.target.files || []);
    // 同一个文件连续选两次也要能触发 change
    event.target.value = '';
    if (!picked.length) return;
    setError('');
    setWorking(true);
    const next = [...value];
    const problems = [];
    try {
      for (const file of picked) {
        if (next.length >= MAX_REF_IMAGES) {
          problems.push(`最多 ${MAX_REF_IMAGES} 张参考图，多余的已忽略`);
          break;
        }
        if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
          problems.push(`${file.name}：只支持 JPG / PNG / WebP`);
          continue;
        }
        if (file.size > SOURCE_MAX_BYTES) {
          problems.push(`${file.name}：原图超过 ${Math.round(SOURCE_MAX_BYTES / 1024 / 1024)}MB`);
          continue;
        }
        const compressed = await compressImage(file, {
          maxWidth: 1024,
          maxHeight: 1024,
          quality: 0.82,
          mimeType: 'image/jpeg',
        });
        if (compressed.size > REF_MAX_BYTES) {
          problems.push(`${file.name}：压缩后仍有 ${formatImageBytes(compressed.size)}，超过 2MB`);
          continue;
        }
        const data = await readBase64(compressed);
        if (!data) {
          problems.push(`${file.name}：读取失败，请换一张`);
          continue;
        }
        next.push({
          id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || '参考图',
          size: compressed.size,
          mimeType: compressed.type || 'image/jpeg',
          data,
        });
      }
      onChange?.(next);
    } catch (e) {
      problems.push(String(e.message || e));
    } finally {
      setWorking(false);
      if (problems.length) setError(problems.join('；'));
    }
  };

  const remove = (id) => {
    setError('');
    onChange?.(value.filter((item) => item.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">
          参考图 <span className="text-slate-400 font-normal">（选填，最多 {MAX_REF_IMAGES} 张）</span>
        </span>
        <span className="text-xs text-slate-400">{value.length}/{MAX_REF_IMAGES}</span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {value.map((item, index) => (
          <div key={item.id} className="relative group">
            <img
              src={`data:${item.mimeType};base64,${item.data}`}
              alt={`参考图 ${index + 1}`}
              className="w-[86px] h-[86px] object-cover rounded-xl border border-slate-200"
            />
            <span className="absolute left-1 top-1 px-1.5 py-0.5 rounded-md bg-black/55 text-[10px] text-white leading-none">
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(item.id)}
              disabled={disabled}
              title="移除这张参考图"
              className="absolute -right-1.5 -top-1.5 w-5 h-5 rounded-full bg-slate-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-40"
            >
              <X size={12} />
            </button>
            <span className="block mt-1 text-[10px] text-slate-400 text-center">{formatImageBytes(item.size)}</span>
          </div>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || working}
            className="w-[86px] h-[86px] rounded-xl border border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-1 hover:border-brand-500 hover:text-brand-600 transition disabled:opacity-50"
          >
            {working ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            <span className="text-[11px]">{working ? '处理中' : '上传'}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={pick}
      />

      {showHint && (
        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          参考图会让模型「照着改」，不是像素级编辑。上传后自动压到 1024px 以内（单张 ≤2MB）。
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-rose-600 flex items-start gap-1">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
