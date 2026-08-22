import { useState, useRef, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Upload, Bot, Clock, AlertCircle, Copy, RotateCcw, CheckCircle2, Image as ImageIcon, Video, FileText, Sparkles, PlusSquare, Download } from 'lucide-react';
import { useStore, getUserPlanStatus } from '../store.jsx';
import { InfoCard, Drawer, SubHeader, RequireLoginModal, Toast, timeAgo } from '../innerUI.jsx';
import { runWorkflow, uploadCozeFile } from '../cozeApi.js';
import { extractResultMedia, classifyAsset, ASSET_TYPE_NAMES, SOURCE_TYPE_NAMES } from '../assetUtils.js';
import { copyText } from '../clipboard.js';

/* ---------- field widgets ---------- */

function FileField({ field, value, onChange, auth }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [previews, setPreviews] = useState({}); // file_id -> dataURL（多图本地预览）
  const inputRef = useRef(null);
  const itemType = (field.items && (field.items.type || field.items.data_type) || '').toLowerCase();
  const typeStr = String(field.type || '').toLowerCase();
  const isImage = field.type === 'image' || itemType === 'image' || (typeStr.startsWith('array<') && typeStr.includes('image'));
  // 扣子期望 Array<Image> 时，前端保存为数组；单 Image/File 时保存为对象
  const isArray = field.type === 'array' || typeStr.startsWith('array<');
  // 多文件：array 容器 + 元素是 image / file（array<image>、array<file>、{type:array, items.type:image/file}）
  const isMulti = isArray && (
    itemType === 'image' || itemType === 'file'
    || /array<(image|file)/.test(typeStr)
  );

  const fileIds = useMemo(() => {
    if (!value) return [];
    try {
      const o = JSON.parse(value);
      if (Array.isArray(o)) return o.map((x) => x.file_id || x).filter(Boolean);
      return o.file_id ? [o.file_id] : [];
    } catch { return []; }
  }, [value]);

  // File → dataURL（本地预览；不上传也能在编辑器里看图）
  const readDataURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  // 把当前 ids 序列化成 formData 存的 JSON
  const buildValue = (ids) => {
    if (!ids || !ids.length) return '';
    if (isMulti) return JSON.stringify(ids.map((id) => ({ file_id: id })));
    return JSON.stringify({ file_id: ids[0] });
  };

  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    setErr('');
    setUploading(true);
    const newIds = [];
    const newPreviewMap = {};
    try {
      for (const file of list) {
        const r = await uploadCozeFile(auth, file);
        if (!r.ok || !r.fileId) throw new Error(r.error || '未返回 file_id');
        newIds.push(r.fileId);
        if (isImage) {
          try { newPreviewMap[r.fileId] = await readDataURL(file); } catch { /* 预览失败不影响上传 */ }
        }
      }
      // 合并：multi 追加到末尾，single 整体替换（保持单文件语义）
      const mergedIds = isMulti ? [...fileIds, ...newIds] : [newIds[0]];
      onChange(field.key, buildValue(mergedIds));
      setPreviews((prev) => (isMulti ? { ...prev, ...newPreviewMap } : newPreviewMap));
    } catch (e) {
      setErr(String(e.message || e));
      // 部分成功：保留已上传的，避免前功尽弃
      if (newIds.length) {
        const mergedIds = isMulti ? [...fileIds, ...newIds] : [newIds[0]];
        onChange(field.key, buildValue(mergedIds));
        setPreviews((prev) => ({ ...prev, ...newPreviewMap }));
      }
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (idx) => {
    if (!isMulti) {
      onChange(field.key, '');
      setPreviews({});
      return;
    }
    const removed = fileIds[idx];
    const next = fileIds.filter((_, i) => i !== idx);
    onChange(field.key, buildValue(next));
    if (removed) {
      setPreviews((prev) => {
        const { [removed]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const clearAll = () => {
    onChange(field.key, '');
    setPreviews({});
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {field.label}{field.required && <span className="text-red-500">*</span>}
      </label>
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        multiple={isMulti}
        accept={isImage ? 'image/*' : '*/*'}
        onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
      />
      {!fileIds.length ? (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files || [])); }}
          className="border-2 border-dashed border-slate-200 rounded-2xl p-5 text-center bg-slate-50/70 hover:bg-blue-50/40 hover:border-blue-300 transition cursor-pointer"
        >
          <div className="w-10 h-10 rounded-full bg-white text-blue-500 flex items-center justify-center mx-auto mb-2 shadow-soft">
            {uploading ? <Clock size={20} className="animate-spin" /> : <Upload size={20} />}
          </div>
          <p className="text-sm text-slate-600 mb-1">{uploading ? '正在上传…' : (isMulti ? '点击选择或拖拽本地文件上传（可多张）' : '点击选择或拖拽本地文件上传')}</p>
          <p className="text-xs text-slate-400">{field.hint || field.placeholder || (isImage ? '支持 JPG / PNG / WebP' : '支持常见文件格式')}</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl p-3 bg-slate-50/70">
          {isImage && (
            <div className={`grid gap-2 mb-3 ${isMulti && fileIds.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
              {fileIds.map((fid, i) => (
                <div key={fid + ':' + i} className="relative group rounded-lg overflow-hidden border border-slate-200 aspect-square bg-white">
                  {previews[fid] ? (
                    <img src={previews[fid]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs px-1 text-center">
                      {fid.slice(0, 12)}…
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-rose-600 transition"
                    title="移除"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          {!isImage && (
            <div className="text-xs text-slate-600 mb-2 truncate">已上传 {fileIds.length} 个文件</div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">共 {fileIds.length} 个</span>
            <div className="flex gap-3">
              <button type="button" onClick={() => inputRef.current?.click()} className="text-blue-600 hover:underline">
                {isMulti ? '继续添加' : '重新选择'}
              </button>
              <button type="button" onClick={clearAll} className="text-rose-600 hover:underline">清空全部</button>
            </div>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-rose-600 mt-1">{err}</p>}
    </div>
  );
}

// 按字段 style 渲染输入控件（与后台「样式」选项对齐）
function Field({ field, value, onChange, auth }) {
  const baseInput = 'w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition text-[15px] text-slate-700 placeholder:text-slate-400';

  // 高级：按 advanced.component 渲染
  if (field.style === 'advanced' && field.advanced?.component) {
    const c = field.advanced.component;
    if (c === 'select') {
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
          <select value={value || ''} onChange={(e) => onChange(field.key, e.target.value)} className={baseInput}>
            <option value="">请选择…</option>
            {(field.advanced.options || []).map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
          </select>
          {field.advanced.hint && <p className="text-xs text-slate-400 mt-2">{field.advanced.hint}</p>}
        </div>
      );
    }
    if (c === 'radio' || c === 'checkbox') {
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
          <div className="space-y-1.5">
            {(field.advanced.options || []).map((o, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-slate-700">
                <input type={c} name={field.key} checked={c === 'checkbox' ? Array.isArray(value) && value.includes(o.value) : value === o.value}
                  onChange={() => {
                    if (c === 'checkbox') {
                      const arr = Array.isArray(value) ? value : [];
                      onChange(field.key, arr.includes(o.value) ? arr.filter(v => v !== o.value) : [...arr, o.value]);
                    } else onChange(field.key, o.value);
                  }} className="text-blue-600" />
                {o.label}
              </label>
            ))}
          </div>
          {field.advanced.hint && <p className="text-xs text-slate-400 mt-2">{field.advanced.hint}</p>}
        </div>
      );
    }
    if (c === 'switch') {
      return (
        <div className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => onChange(field.key, !value)} className={`relative w-10 h-6 rounded-full transition ${value ? 'bg-blue-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 ${value ? 'left-5' : 'left-0.5'} w-5 h-5 rounded-full bg-white shadow transition-all`} />
          </button>
          <span className="text-sm text-slate-700">{field.label}{field.required && <span className="text-red-500">*</span>}</span>
        </div>
      );
    }
    if (c === 'slider') {
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
          <input type="range" min={field.advanced.min ?? 0} max={field.advanced.max ?? 100} value={value ?? field.advanced.min ?? 0}
            onChange={e => onChange(field.key, Number(e.target.value))} className="w-full accent-blue-600" />
          <div className="text-xs text-slate-400 text-right">{value ?? field.advanced.min ?? 0}</div>
        </div>
      );
    }
    if (c === 'date') {
      return (
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
          <input type="date" value={value || ''} onChange={e => onChange(field.key, e.target.value)} className={baseInput} />
        </div>
      );
    }
  }

  // 文件/图片上传（调用扣子 /v1/files/upload 换取 file_id）
  const itemType = (field.items && (field.items.type || field.items.data_type) || '').toLowerCase();
  const rawType = (field.type || '').toLowerCase();
  const isFileField = field.style === 'file'
    || rawType === 'file'
    || rawType === 'image'
    || (rawType === 'array' && (itemType === 'image' || itemType === 'file'))
    || (rawType.startsWith('array<') && (rawType.includes('image') || rawType.includes('file')));
  if (isFileField) {
    return <FileField field={field} value={value} onChange={onChange} auth={auth} />;
  }
  if (field.style === 'textarea' || field.type === 'textarea') {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
        <textarea value={value || ''} onChange={(e) => onChange(field.key, e.target.value)} placeholder={field.hint || field.placeholder} rows={4} className={`${baseInput} resize-none leading-relaxed`} />
      </div>
    );
  }
  if (field.style === 'select') {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
        <select value={value || ''} onChange={(e) => onChange(field.key, e.target.value)} className={baseInput}>
          {(field.options || []).map((o, i) => <option key={i} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (field.style === 'boolean' || field.type === 'boolean') {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button type="button" onClick={() => onChange(field.key, !value)} className={`relative w-10 h-6 rounded-full transition ${value ? 'bg-blue-600' : 'bg-slate-200'}`}>
          <span className={`absolute top-0.5 ${value ? 'left-5' : 'left-0.5'} w-5 h-5 rounded-full bg-white shadow transition-all`} />
        </button>
        <span className="text-sm text-slate-700">{field.label}{field.required && <span className="text-red-500">*</span>}</span>
      </div>
    );
  }
  if (field.style === 'number' || field.type === 'number' || field.type === 'integer') {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
        <input type="number" value={value ?? ''} onChange={(e) => onChange(field.key, e.target.value)} placeholder={field.hint || field.placeholder} className={baseInput} />
      </div>
    );
  }
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-2">{field.label}{field.required && <span className="text-red-500">*</span>}</label>
      <input type="text" value={value || ''} onChange={(e) => onChange(field.key, e.target.value)} placeholder={field.hint || field.placeholder} className={baseInput} />
    </div>
  );
}

function ConfigPanel({ workflow, formData, onChange, onRun, running, errMsg, auth }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-200/60">
        <h3 className="text-base font-bold text-slate-900">配置参数</h3>
        <p className="text-xs text-slate-400 mt-1">填写下方参数，一键运行工作流</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        {!workflow.workflowId && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-700 text-xs border border-amber-100">
            提示：当前工作流尚未配置工作流 ID，请联系管理员到后台「工作流编辑」补全「智能获取」信息。
          </div>
        )}
        {workflow.formFields.filter(f => f.enabled !== false).map(f => (
          <Field key={f.key} field={f} value={formData[f.key]} onChange={onChange} auth={auth} />
        ))}
        {workflow.formFields.length === 0 && (
          <div className="text-xs text-slate-400 py-4 text-center">没有可配置参数</div>
        )}
      </div>

      <div className="p-5 border-t border-slate-200/60 bg-white/40">
        {errMsg && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-xs border border-rose-100 flex items-start gap-2">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <div className="break-all">{errMsg}</div>
          </div>
        )}
        <button
          onClick={onRun}
          disabled={running}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium flex items-center justify-center gap-2 shadow-soft hover:shadow-pop hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0 transition"
        >
          {running ? <Clock size={18} className="animate-spin" /> : <Play size={18} fill="white" />}
          {running ? '运行中…' : '开始运行'}
        </button>
        <p className="text-[11px] text-slate-400 text-center mt-3">AI 生成内容仅供参考，请自行核对</p>
      </div>
    </div>
  );
}

/* ---------- center run history / result stream ---------- */

function formatInputs(inputs, fields) {
  if (!inputs) return [];
  return fields
    .filter((f) => f.enabled !== false && inputs[f.key] !== undefined && inputs[f.key] !== '' && inputs[f.key] !== null)
    .map((f) => {
      const v = inputs[f.key];
      let display = v;
      if (f.style === 'boolean' || f.type === 'boolean') display = v ? '是' : '否';
      if (typeof v === 'object') display = JSON.stringify(v);
      return { label: f.label || f.key, value: String(display) };
    });
}

// 从工作流返回中抽取图片/视频/文本（兼容多种结构）
function extractMedia(result) {
  if (!result) return { text: '', images: [], videos: [] };
  const text = result.text || (result.kind === 'json' ? '' : '');
  const images = [];
  const videos = [];

  const isImageUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i.test(url)) return true;
    if (/^data:image\//i.test(url)) return true;
    if (!/^https?:\/\//.test(url)) return false;
    const IMG_HINTS = ['image', 'img', 'oss-', 'coze', 'byteimg', 'volces', 'juejin', 'bytedance', 'pstatp', 'toutiao', 'snssdk', 'douyin', 'alicdn', 'wsrv', 'picsum', 's.coze'];
    return IMG_HINTS.some((h) => lower.includes(h));
  };
  const isVideoUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (/\.(mp4|mov|webm|mkv)(\?|$)/i.test(url)) return true;
    if (!/^https?:\/\//.test(url)) return false;
    const VIDEO_HINTS = ['video', 'vod', 'mp4', 'mov', 'webm'];
    return VIDEO_HINTS.some((h) => lower.includes(h));
  };

  const collect = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      if (isImageUrl(v)) images.push(v);
      else if (isVideoUrl(v)) videos.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (typeof v === 'object') {
      // 深度遍历对象所有属性（如扣子常见的 { output: [...] }）
      Object.values(v).forEach(collect);
    }
  };

  if (result.kind === 'json' && result.data) collect(result.data);
  if (result.kind === 'mixed' && result.data) collect(result.data);
  if (result.text) {
    // 如果 text 是 JSON 字符串，也解析后抽取媒体
    if (result.text.trim().startsWith('{') || result.text.trim().startsWith('[')) {
      try { collect(JSON.parse(result.text)); } catch { /* ignore */ }
    }
    collect(result.text);
  }
  return { text, images: [...new Set(images)], videos: [...new Set(videos)] };
}

// 渲染中间结果区（按 resultKind 区分）
// 根据文件 URL 推断文档类型（用于"文档"标记字段）
const detectDocType = (url) => {
  if (!url || typeof url !== 'string') return 'file';
  const u = url.toLowerCase().split('?')[0].split('#')[0];
  if (u.endsWith('.pdf')) return 'pdf';
  if (u.endsWith('.doc') || u.endsWith('.docx')) return 'docx';
  if (u.endsWith('.xls') || u.endsWith('.xlsx') || u.endsWith('.csv')) return 'xlsx';
  if (u.endsWith('.ppt') || u.endsWith('.pptx')) return 'pptx';
  if (u.endsWith('.txt') || u.endsWith('.md') || u.endsWith('.json') || u.endsWith('.xml')) return 'text';
  if (u.endsWith('.zip') || u.endsWith('.rar') || u.endsWith('.7z')) return 'zip';
  return 'file';
};
const DOC_META = {
  pdf:   { name: 'PDF',    color: 'bg-rose-100 text-rose-600' },
  docx:  { name: 'Word',   color: 'bg-blue-100 text-blue-600' },
  xlsx:  { name: 'Excel',  color: 'bg-emerald-100 text-emerald-600' },
  pptx:  { name: 'PPT',    color: 'bg-amber-100 text-amber-600' },
  text:  { name: 'TXT',    color: 'bg-slate-100 text-slate-600' },
  zip:   { name: 'ZIP',    color: 'bg-violet-100 text-violet-600' },
  file:  { name: 'FILE',   color: 'bg-slate-100 text-slate-500' },
};

function MediaPreviewList({ children }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

function ImageThumbnail({ src, alt }) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title="点击查看原图"
      className="group block w-44 max-w-full sm:w-52 lg:w-60 aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-soft hover:border-blue-300 hover:shadow-pop transition"
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform"
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    </a>
  );
}

function VideoThumbnail({ src, label }) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title="点击查看原视频"
      aria-label={label}
      className="group relative block w-52 max-w-full sm:w-60 lg:w-72 aspect-video rounded-xl overflow-hidden border border-slate-200 bg-slate-900 shadow-soft hover:border-blue-300 hover:shadow-pop transition"
    >
      <video src={src} preload="metadata" muted playsInline className="w-full h-full object-contain pointer-events-none" />
      <span className="absolute inset-0 flex items-center justify-center bg-slate-950/15 group-hover:bg-slate-950/25 transition">
        <span className="w-11 h-11 rounded-full bg-white/90 text-blue-600 flex items-center justify-center shadow-pop">
          <Play size={20} fill="currentColor" />
        </span>
      </span>
    </a>
  );
}

// 从 result.data 中按 outputFields 定义逐字段渲染（"标记"驱动）
// 命中规则：result.data 是对象 + outputFields 存在 + 至少一个字段有非空 tag
function FieldByTag({ field, value }) {
  const tag = field.tag || '';
  const name = field.name || field.key || '输出';
  // 数组场景
  if (Array.isArray(value)) {
    if (!value.length) return null;
    if (tag === 'image-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <MediaPreviewList>
            {value.map((src, i) => (
              <ImageThumbnail key={i} src={src} alt={`${name}-${i}`} />
            ))}
          </MediaPreviewList>
        </div>
      );
    }
    if (tag === 'video-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <MediaPreviewList>
            {value.map((src, i) => <VideoThumbnail key={i} src={src} label={`${name}-${i + 1}`} />)}
          </MediaPreviewList>
        </div>
      );
    }
    if (tag === 'audio-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <div className="space-y-2">
            {value.map((src, i) => <audio key={i} src={src} controls className="w-full" />)}
          </div>
        </div>
      );
    }
    if (tag === 'document') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <div className="space-y-1.5">
            {value.map((src, i) => {
              const t = detectDocType(src);
              const m = DOC_META[t] || DOC_META.file;
              return (
                <a key={i} href={src} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition group">
                  <span className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${m.color}`}>{m.name}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{name} {value.length > 1 ? `· ${i + 1}` : ''}</div>
                    <div className="text-xs text-slate-400 truncate">{src}</div>
                  </div>
                  <Download size={14} className="text-slate-400 group-hover:text-blue-600 shrink-0" />
                </a>
              );
            })}
          </div>
        </div>
      );
    }
    // 其他 tag（如 code）按文本数组处理
    return (
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700">{name}</div>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100">{value.join('\n')}</pre>
      </div>
    );
  }
  // 单值场景
  if (typeof value === 'string' && value) {
    if (tag === 'image-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <MediaPreviewList><ImageThumbnail src={value} alt={name} /></MediaPreviewList>
        </div>
      );
    }
    if (tag === 'video-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <MediaPreviewList><VideoThumbnail src={value} label={name} /></MediaPreviewList>
        </div>
      );
    }
    if (tag === 'audio-required') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <audio src={value} controls className="w-full" />
        </div>
      );
    }
    if (tag === 'code') {
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-100 overflow-x-auto"><code>{value}</code></pre>
        </div>
      );
    }
    if (tag === 'document') {
      const t = detectDocType(value);
      const m = DOC_META[t] || DOC_META.file;
      return (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <a href={value} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition group">
            <span className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${m.color}`}>{m.name}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{name}</div>
              <div className="text-xs text-slate-400 truncate">{value}</div>
            </div>
            <Download size={14} className="text-slate-400 group-hover:text-blue-600 shrink-0" />
          </a>
        </div>
      );
    }
  }
  // 对象/其他/无 tag：原始 JSON 预览
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-slate-700">{name}</div>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100 overflow-x-auto">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// 按 outputFields 逐字段渲染（标记驱动的主分支）
function TaggedFieldsView({ result, outputFields }) {
  if (!result || !outputFields || !outputFields.length) return null;
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  // 至少有一个字段有非空 tag 才走标记分支
  const hasTagged = outputFields.some(f => f.tag && f.enabled !== false);
  if (!hasTagged) return null;
  // 收集未在 outputFields 中的额外字段（保留显示）
  const knownKeys = new Set(outputFields.map(f => f.key));
  const extraEntries = Object.entries(data).filter(([k]) => !knownKeys.has(k));
  return (
    <div className="space-y-4">
      {outputFields.filter(f => f.enabled !== false && f.show !== false).map(f => {
        const v = data[f.key];
        if (v === undefined || v === null || v === '') return null;
        return <FieldByTag key={f.key || f.name} field={f} value={v} />;
      })}
      {extraEntries.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-500">其他输出</div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100 overflow-x-auto">
            {JSON.stringify(Object.fromEntries(extraEntries), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ResultContent({ result, kind, outputFields }) {
  if (!result) return null;
  // 优先走"标记驱动"渲染：result.data 是对象 + 至少一个 outputField 有 tag
  const hasTaggedFields = outputFields && outputFields.length
    && result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    && outputFields.some(f => f.tag && f.enabled !== false);
  if (hasTaggedFields) {
    return <TaggedFieldsView result={result} outputFields={outputFields} />;
  }
  // 兜底：旧的"按 kind 整体渲染"逻辑（保留兼容）
  const { text, images, videos } = extractMedia(result);
  const auto = !kind || kind === 'auto';
  // 自适应：当 kind 未指定时按数据特征决定
  const effective = auto
    ? (images.length || videos.length ? (text ? 'mixed' : (images.length ? 'image' : 'video')) : 'text')
    : kind;

  if (effective === 'image') {
    return (
      <div className="space-y-3">
        {images.length > 0 ? (
          <MediaPreviewList>
            {images.map((src, i) => (
              <ImageThumbnail key={i} src={src} alt={`result-${i}`} />
            ))}
          </MediaPreviewList>
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100">{text || '未识别到图片 URL'}</pre>
        )}
      </div>
    );
  }
  if (effective === 'mixed' && images.length) {
    return (
      <div className="space-y-3">
        <MediaPreviewList>
          {images.map((src, i) => (
            <ImageThumbnail key={i} src={src} alt={`result-${i}`} />
          ))}
        </MediaPreviewList>
        {text && <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100">{text}</pre>}
      </div>
    );
  }
  if (effective === 'video' || (effective === 'mixed' && videos.length)) {
    return (
      <div className="space-y-3">
        <MediaPreviewList>
          {videos.map((src, i) => <VideoThumbnail key={i} src={src} label={`视频 ${i + 1}`} />)}
        </MediaPreviewList>
        {text && effective === 'mixed' && <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100">{text}</pre>}
      </div>
    );
  }
  // 默认：纯文案
  return (
    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100 overflow-x-auto">
      {text || (result.kind === 'json' ? JSON.stringify(result.data, null, 2) : '')}
    </pre>
  );
}

function RunItem({ run, workflow, onAsset }) {
  const inputs = formatInputs(run.inputs, workflow.formFields) || [];
  const result = run.result || { text: run.content, kind: 'text' };
  const kind = run.resultKind || workflow.resultKind || 'text';
  const meta = extractMedia(result);
  const hasMedia = meta.images.length || meta.videos.length;
  const hasText = (result.text || '').trim() || (result.kind === 'json');

  return (
    <div className="animate-fade-up mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-400">{timeAgo(run.createdAt)}</span>
        {run.cost > 0 && <span className="text-xs text-slate-400">· 消耗 {run.cost} 点</span>}
      </div>

      {/* user inputs */}
      <div className="flex gap-3 mb-4 flex-row-reverse">
        <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 text-sm font-medium">我</div>
        <div className="max-w-[82%] rounded-2xl px-4 py-3 bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-soft text-[15px] leading-relaxed">
          {inputs.length > 0 ? (
            <div className="space-y-1">
              {inputs.map((i, idx) => (
                <div key={idx}>
                  <span className="text-blue-100 text-[13px]">{i.label}：</span>
                  <span className="break-words">{i.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>已提交运行请求</div>
          )}
        </div>
      </div>

      {/* assistant result */}
      <div className="flex gap-3">
        <div className={`w-9 h-9 rounded-full ${workflow.iconColor} text-white flex items-center justify-center shadow-soft shrink-0`}>
          <Bot size={16} />
        </div>
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-100 shadow-soft p-4 lg:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-sm font-semibold text-slate-700">{workflow.name}</div>
            <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 size={13} /> 运行完成
            </span>
          </div>

          {hasMedia && (
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
              {meta.images.length > 0 && <><ImageIcon size={13} /> {meta.images.length} 张图</>}
              {meta.videos.length > 0 && <><Video size={13} /> {meta.videos.length} 段视频</>}
            </div>
          )}

          <ResultContent result={result} kind={kind} outputFields={workflow.outputFields} />

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button onClick={() => onAsset(run)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition" title="加入资产库">
              <PlusSquare size={13} /> 加入资产库
            </button>
            {result.text && (
              <button onClick={async () => { const ok = await copyText(result.text); showToast(ok ? '已复制到剪贴板' : '复制失败'); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
                <Copy size={13} /> 复制结果
              </button>
            )}
            {meta.images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
                <ImageIcon size={13} /> 图片 {i + 1}
              </a>
            ))}
            {meta.videos.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
                <Video size={13} /> 视频 {i + 1}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 animate-fade-up">
      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-100 flex items-center justify-center text-slate-300 mb-4 shadow-soft">
        <Play size={28} className="ml-1" />
      </div>
      <div className="text-base font-semibold text-slate-700 mb-1">暂无运行记录</div>
      <div className="text-sm text-slate-400 max-w-xs">
        填写参数并点击「开始运行」，结果会在这里显示
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function Workflow() {
  const { id } = useParams();
  const { user, points, consume, addHistory, history, workflows, authProviders, addAsset, addTask, openRechargeModal, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig]);
  const workflow = useMemo(() => workflows.find((w) => w.id === id) || null, [id, workflows]);
  const auth = useMemo(() => authProviders.find(p => p.id === workflow?.authProviderId) || null, [authProviders, workflow]);
  const [formData, setFormData] = useState({});
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [mobileConfigView, setMobileConfigView] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [toast, setToast] = useState('');
  const scrollRef = useRef(null);
  const toastTimer = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!workflow) return;
    const init = {};
    workflow.formFields.forEach((f) => { init[f.key] = f.default || ''; });
    setFormData(init);
    setRunErr('');
  }, [workflow]);

  // 2026-07-31：workflowHistory 按 createdAt 升序（最早在上、最新在下），scroll 到底部 = 最新记录。
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' }));
    return () => cancelAnimationFrame(frame);
  }, [history, running, id, mobileConfigView]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const handleChange = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));
  const showToast = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2200); };

  const handleAddAsset = (run) => {
    if (!user) { setShowLogin(true); return; }
    const { text, images, videos, audios } = extractResultMedia(run.result || { text: run.content, kind: 'text' });
    // 优先按工作流输出字段标记判定（标记驱动最准确，admin 显式指定视频/音频/图片/文档）
    const tags = (workflow.outputFields || [])
      .filter((f) => f && f.tag)
      .map((f) => f.tag);
    const hasText = !!(text && String(text).trim());
    const hasImages = images && images.length > 0;
    let type;
    // 2026-07-31：多模态判定优先级最高。
    // 即便标签是 image-required/视频required，只要实际内容里还有文本，类型就归「图文」，
    // 因为图文 Tab 能同时承载图+文，而纯 image Tab 只放单图就丢文案了。
    if (hasText && (hasImages || (videos && videos.length > 0) || (audios && audios.length > 0))) {
      type = 'graphic';
    } else if (tags.includes('video-required')) type = 'video';
    else if (tags.includes('audio-required')) type = 'audio';
    else if (tags.includes('image-required')) type = 'image';
    else if (tags.includes('document') || tags.includes('code')) type = 'copy';
    // 无标记时回退到内容特征判定
    if (!type) type = classifyAsset({ text, images, videos, audios, sourceName: workflow.name });
    addAsset({
      sourceType: 'workflow',
      sourceId: workflow.id,
      sourceName: workflow.name,
      type,
      name: `${workflow.name} · ${ASSET_TYPE_NAMES[type]}`,
      content: text,
      images,
      videos,
      audios,
    });
    showToast(`已加入「${ASSET_TYPE_NAMES[type]}」资产库`);
  };

  const workflowHistory = useMemo(() => (
    user
      ? history
          .filter((h) => h.workflowId === workflow?.id && h.userId === user.id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // 升序：最早在上，最新在下
      : []
  ), [history, workflow, user]);

  const handleRun = async () => {
    if (!workflow || running) return;
    const enabled = workflow.formFields.filter(f => f.enabled !== false);
    const missing = enabled.filter((f) => f.required && (formData[f.key] === undefined || formData[f.key] === '' || formData[f.key] === null));
    if (missing.length) { setRunErr(`请填写：${missing.map((f) => f.label).join('、')}`); return; }
    if (!user) { setShowLogin(true); return; }
    // 套餐有效期拦截：已绑定套餐且已到期 → 完全阻断并弹充值窗（剩余算力保留，需续费才能继续）
    const plan = getUserPlanStatus(user);
    if (plan.expired) { setRunErr(''); openRechargeModal(plan.validTo); return; }
    if (points < workflow.priceRate) { setRunErr('算力不足，请前往个人中心充值'); return; }

    setRunning(true);
    setRunErr('');
    startTimeRef.current = Date.now();
    const snapshot = { ...formData };
    const title = enabled
      .map((f) => `${f.label}：${f.style === 'boolean' || f.type === 'boolean' ? (snapshot[f.key] ? '是' : '否') : (snapshot[f.key] || '-')}`)
      .join('，');

    try {
      // 找授权凭证
      if (!auth) throw new Error('当前工作流未配置授权凭证，请联系管理员在后台绑定授权。');
      if (auth.type !== 'pat' && auth.type !== 'oauth') {
        throw new Error('旧版工作流需要 PAT 或 OAuth 类型的授权。');
      }

      // 调扣子工作流
      const cfg = {
        baseUrl: auth.baseUrl,
        workflowId: workflow.workflowId,
        platform: 'coze-old',
        authType: auth.type === 'oauth' ? 'oauth' : 'pat',
        userId: user.id,
      };
      if (auth.type === 'oauth') {
        cfg.clientId = auth.clientId;
        cfg.keyId = auth.keyId;
        cfg.privateKey = auth.privateKey;
      } else {
        cfg.apiKey = auth.apiKey;
      }

      // 文件/图片字段按扣子期望格式包装：Array<Image> 传数组，单 Image/File 传对象
      const parameters = {};
      for (const f of enabled) {
        const raw = snapshot[f.key];
        if (raw === undefined || raw === '' || raw === null) continue;
        const t = (f.type || '').toLowerCase();
        const tItem = (f.items && (f.items.type || f.items.data_type) || '').toLowerCase();
        const isArray = t === 'array' || t.startsWith('array<');
        const isFile = f.style === 'file'
          || t === 'image' || t === 'file'
          || (t === 'array' && (tItem === 'image' || tItem === 'file'))
          || (t.startsWith('array<') && (t.includes('image') || t.includes('file')));
        if (isFile) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) parameters[f.key] = parsed;
            else if (isArray) parameters[f.key] = [parsed];
            else parameters[f.key] = parsed;
          } catch {
            // 兜底：非 JSON 字符串直接透传（理论上不应出现）
            parameters[f.key] = raw;
          }
        } else {
          parameters[f.key] = raw;
        }
      }

      const result = await runWorkflow({ parameters, cfg });

      const duration = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;
      // 扣算力并记历史
      consume(workflow.priceRate, `运行工作流：${workflow.name}`, { workflowId: workflow.id });
      const historyItem = {
        id: Date.now() + Math.random(),
        workflowId: workflow.id,
        workflowName: workflow.name,
        title,
        content: result.text || (result.kind === 'json' ? JSON.stringify(result.data) : ''),
        result,
        resultKind: workflow.resultKind,
        inputs: snapshot,
        cost: workflow.priceRate,
        createdAt: new Date().toISOString(),
      };
      addHistory(historyItem);
      addTask({
        sourceType: 'workflow',
        sourceId: workflow.id,
        sourceName: workflow.name,
        name: workflow.name,
        content: historyItem.content,
        inputs: snapshot,
        cost: workflow.priceRate,
        duration,
        result,
      });
      showToast('已生成 · 可复制使用');
    } catch (e) {
      setRunErr(String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  if (!workflow) return <div className="p-10 text-center text-slate-500">工作流不存在</div>;

  return (
    <div className="h-[calc(100vh-64px)] flex bg-[#f0f4f9] overflow-hidden" style={{ height: 'calc(100dvh - 64px)' }}>
      {/* Left: config panel (desktop) */}
      <aside className="hidden md:flex w-80 lg:w-96 bg-white/55 backdrop-blur border-r border-slate-200/50 flex-col shrink-0 rounded-t-2xl">
        <ConfigPanel workflow={workflow} formData={formData} onChange={handleChange} onRun={handleRun} running={running} errMsg={runErr} auth={auth} />
      </aside>

      {/* Center: run history / result */}
      <div className="flex-1 flex flex-col min-w-0">
        <SubHeader
          entity={workflow}
          type="workflow"
          onToggleHistory={() => setMobileConfigView(v => !v)}
          onToggleInfo={() => setInfoOpen(true)}
          mobileActionTitle={mobileConfigView ? '历史记录' : '配置参数'}
          right={
            workflowHistory.length > 0 ? (
              <button
                onClick={() => { const init = {}; workflow.formFields.forEach((f) => { init[f.key] = f.default || ''; }); setFormData(init); setRunErr(''); }}
                className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0"
              >
                <RotateCcw size={13} /> 重置参数
              </button>
            ) : null
          }
        />

        {mobileConfigView && (
          <div className="md:hidden flex-1 min-h-0 bg-white/55">
            <ConfigPanel workflow={workflow} formData={formData} onChange={handleChange} onRun={handleRun} running={running} errMsg={runErr} auth={auth} />
          </div>
        )}

        <div ref={scrollRef} className={`flex-1 overflow-y-auto scrollbar-thin px-4 lg:px-6 py-6 ${mobileConfigView ? 'hidden md:block' : ''}`}>
          <div className="max-w-3xl mx-auto">
            {workflowHistory.length === 0 && !running ? (
              <EmptyState />
            ) : (
              <>
                {workflowHistory.map((h) => <RunItem key={h.id} run={h} workflow={workflow} onAsset={handleAddAsset} />)}
                {running && (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                    <Clock size={16} className="animate-spin" />
                    <span>AI 正在生成，请稍候…</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right: info card (desktop) */}
      <aside className="hidden xl:flex w-80 bg-white/55 backdrop-blur border-l border-slate-200/50 flex-col shrink-0 rounded-t-2xl">
        <InfoCard entity={workflow} type="workflow" />
      </aside>

      <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} side="right" title="工作流信息">
        <InfoCard entity={workflow} type="workflow" />
      </Drawer>

      {toast && <Toast msg={toast} />}
      {showLogin && <RequireLoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
