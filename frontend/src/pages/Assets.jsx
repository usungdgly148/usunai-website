import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import {
  Search, FileText, Image as ImageIcon, Video, Mic, Layers, CheckSquare,
  Eye, Copy, Trash2, X, Download, Edit2, Save, CheckCircle2, ChevronLeft, ChevronRight, Plus
} from 'lucide-react';
import { ASSET_TYPE_LABELS } from '../mock.js';
import { SOURCE_TYPE_NAMES, formatDuration, formatCost, collectMedia, extractResultMedia } from '../assetUtils.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText } from '../clipboard.js';
import UserPagination from '../components/UserPagination.jsx';
import { paginate, USER_PAGE_SIZE } from '../pagination.js';

const TABS = [
  { key: 'task', label: '任务', icon: CheckSquare },
  { key: 'copy', label: '文案', icon: FileText },
  { key: 'image', label: '图片', icon: ImageIcon },
  { key: 'video', label: '视频', icon: Video },
  { key: 'audio', label: '音频', icon: Mic },
  { key: 'graphic', label: '图文', icon: Layers },
];

const STATUS_STYLE = {
  success: 'bg-emerald-50 text-emerald-700',
  running: 'bg-blue-50 text-blue-700',
  failed: 'bg-rose-50 text-rose-700',
};

const STATUS_TEXT = { success: '成功', running: '运行中', failed: '失败' };

function formatTime(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return String(iso); }
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function CopyButton({ text, label = '复制' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    // HTTP 下 navigator.clipboard 是 undefined；copyText 自动走 execCommand 兜底
    const ok = await copyText(text || '');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
      {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
      {copied ? '已复制' : label}
    </button>
  );
}

function TextDetail({ asset, onClose, updateAsset }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(asset.content || '');
  const handleSave = () => {
    updateAsset(asset.id, { content: text });
    setEditing(false);
  };
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">{ASSET_TYPE_LABELS[asset.type] || '文案'}详情</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 md:p-6">
        <div className="text-xs text-slate-400 mb-1">{formatTime(asset.createdAt)}</div>
        <h4 className="text-lg font-semibold text-slate-900 mb-4">{asset.name}</h4>
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-64 md:h-80 p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
          />
        ) : (
          <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4 md:p-5 border border-slate-100">
            <Markdown remarkPlugins={[remarkGfm]}>{asset.content || '无内容'}</Markdown>
          </div>
        )}
        {asset.images?.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
            {asset.images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-slate-200 hover:shadow-md transition">
                <img src={src} alt="" className="w-full h-32 object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        <CopyButton text={asset.content} label="一键复制" />
        {editing ? (
          <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
            <Save size={14} /> 保存
          </button>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition">
            <Edit2 size={14} /> 编辑
          </button>
        )}
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
  );
}

function ImageDetail({ asset, onClose }) {
  const src = asset.images?.[0] || asset.content || '';
  const handleDownload = async () => {
    try {
      const res = await fetch(src, { mode: 'cors' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.name ? `${asset.name}.jpg` : 'download.jpg';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank');
    }
  };
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">{asset.name}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 flex items-center justify-center bg-slate-100/50">
        <img src={src} alt={asset.name} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-lg" />
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        <button onClick={handleDownload} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
          <Download size={14} /> 一键下载
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
  );
}

function MediaDetail({ asset, onClose }) {
  const src = asset.videos?.[0] || asset.audios?.[0] || asset.content || '';
  const isVideo = asset.type === 'video';
  const [mediaError, setMediaError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 完整下载：fetch + blob（同源 / CORS 允许），跨域无 CORS 时回退新窗口打开
  const handleDownload = async () => {
    if (!src) return;
    setDownloading(true);
    const ext = isVideo ? 'mp4' : 'mp3';
    const filename = asset.name ? `${asset.name}.${ext}` : `download.${ext}`;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error('empty blob');
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延迟释放，让浏览器有时间真正开始下载
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch {
      // 跨域无 CORS：回退新窗口打开，让用户手动另存为完整文件
      window.open(src, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">{asset.name}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 flex items-center justify-center bg-slate-900/95 min-h-[420px]">
        {mediaError ? (
          <div className="text-center text-slate-300 py-10 max-w-md">
            <Video size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm mb-2">{isVideo ? '视频' : '音频'}加载失败</p>
            <p className="text-xs text-slate-500 break-all mb-4">{src}</p>
            <a href={src} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition">
              在新窗口打开
            </a>
          </div>
        ) : isVideo ? (
          <video
            src={src}
            controls
            autoPlay
            muted
            playsInline
            preload="auto"
            className="max-w-full max-h-[70vh] w-full rounded-xl shadow-lg"
            onError={() => setMediaError(true)}
          />
        ) : (
          <audio
            src={src}
            controls
            autoPlay
            preload="auto"
            className="w-full"
            onError={() => setMediaError(true)}
          />
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Download size={14} /> {downloading ? '下载中…' : '一键下载'}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
  );
}

function GraphicDetail({ asset, onClose, updateAsset }) {
  const imgs = asset.images || [];
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(asset.content || '');
  // 2026-07-31：点主图 → 弹窗预览原图（-1 = 关闭）
  const [previewIdx, setPreviewIdx] = useState(-1);
  const handleSave = () => { updateAsset(asset.id, { content: text }); setEditing(false); };
  const main = imgs[active];
  const previewSrc = previewIdx >= 0 ? imgs[previewIdx] : '';
  const handlePreviewDownload = async () => {
    if (!previewSrc) return;
    try {
      const r = await fetch(previewSrc, { mode: 'cors' });
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
      a.download = (asset.name || 'image') + (previewIdx > 0 ? `-${previewIdx + 1}` : '') + '.' + ext;
      a.click();
      URL.revokeObjectURL(u);
    } catch {
      window.open(previewSrc, '_blank');
    }
  };
  return (
    <>
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">图文详情</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 md:p-6">
        <div className="text-xs text-slate-400 mb-1">{formatTime(asset.createdAt)}</div>
        <h4 className="text-lg font-semibold text-slate-900 mb-4">{asset.name}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 左侧：主图 + 缩略图轮播 */}
          <div>
            {imgs.length > 0 ? (
              <>
                <div className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                  <img
                    src={main}
                    alt=""
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    onClick={() => setPreviewIdx(active)}
                    className="w-full h-full object-cover cursor-zoom-in"
                    title="点击预览原图"
                  />
                  {imgs.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActive((i) => (i - 1 + imgs.length) % imgs.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-700 hover:bg-white transition"
                        title="上一张"
                      ><ChevronLeft size={18} /></button>
                      <button
                        type="button"
                        onClick={() => setActive((i) => (i + 1) % imgs.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center text-slate-700 hover:bg-white transition"
                        title="下一张"
                      ><ChevronRight size={18} /></button>
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-medium">{active + 1} / {imgs.length}</span>
                    </>
                  )}
                </div>
                {imgs.length > 1 && (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                    {imgs.map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActive(i)}
                        className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${i === active ? 'border-blue-500' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        <img src={src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="aspect-square rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-sm">无图片</div>
            )}
          </div>
          {/* 右侧：标题 + 正文 + 操作 */}
          <div className="flex flex-col min-w-0">
            <div className="mb-3">
              <div className="text-sm font-medium text-slate-700 mb-1.5">标题</div>
              <div className="text-sm text-slate-900">{asset.name}</div>
            </div>
            <div className="mb-3">
              <div className="text-sm font-medium text-slate-700 mb-1.5">标签</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">{SOURCE_TYPE_NAMES[asset.sourceType] || asset.sourceType}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600">{ASSET_TYPE_LABELS[asset.type] || '图文'}</span>
                {asset.sourceName && <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">{asset.sourceName}</span>}
              </div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="text-sm font-medium text-slate-700 mb-1.5 flex items-center justify-between">
                <span>正文</span>
                {!editing && asset.content && <span className="text-xs text-slate-400 font-normal">{asset.content.length} 字</span>}
              </div>
              {editing ? (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="flex-1 min-h-[200px] md:min-h-[280px] p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm leading-relaxed focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
                />
              ) : (
                <div className="flex-1 overflow-y-auto prose prose-sm max-w-none text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100 whitespace-pre-wrap">
                  {asset.content || <span className="text-slate-400">无文本内容</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        {asset.content && <CopyButton text={asset.content} label="复制正文" />}
        {editing ? (
          <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
            <Save size={14} /> 保存
          </button>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition">
            <Edit2 size={14} /> 编辑
          </button>
        )}
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
    {/* 2026-07-31：点主图 → 弹窗预览原图 + 下载 */}
    {previewIdx >= 0 && (
      <Modal onClose={() => setPreviewIdx(-1)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">图片预览</h3>
          <button onClick={() => setPreviewIdx(-1)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 flex items-center justify-center bg-slate-900/95">
          <img
            src={previewSrc}
            alt={asset.name}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          {imgs.length > 1 && (
            <span className="text-xs text-slate-400 mr-auto">{previewIdx + 1} / {imgs.length}</span>
          )}
          <button onClick={handlePreviewDownload} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
            <Download size={14} /> 下载
          </button>
          <button onClick={() => setPreviewIdx(-1)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
        </div>
      </Modal>
    )}
  </>
  );
}

function TaskDetail({ asset, onClose }) {
  const inputs = asset.inputs || {};
  // 2026-07-31：从 content 文本里抽取媒体 URL（content 通常是 {"output":"..."} 这种 JSON 串）。
  // 用现有的 collectMedia / extractResultMedia 做递归穿透 + JSON.parse 兜底。
  const media = (() => {
    const raw = asset.content || '';
    const trimmed = raw.trim();
    if (!trimmed) return { images: [], videos: [], audios: [], text: raw };
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return extractResultMedia({ text: raw, kind: 'json', data: parsed });
        }
      } catch { /* 非合法 JSON，按纯文本提取 */ }
    }
    return { images: [], videos: [], audios: [], text: raw };
  })();
  const { images: mediaImages = [], videos: mediaVideos = [] } = media;
  const allImages = [...(asset.images || []), ...mediaImages];
  // 去重
  const seen = new Set();
  const images = allImages.filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });
  const videos = [...(asset.videos || []), ...mediaVideos];
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">任务详情</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 md:p-6">
        <div className="mb-4">
          <div className="text-xs text-slate-400 mb-1">{formatTime(asset.createdAt)}</div>
          <h4 className="text-lg font-semibold text-slate-900">{asset.name}</h4>
        </div>
        {Object.keys(inputs).length > 0 && (
          <div className="mb-5">
            <div className="text-sm font-medium text-slate-700 mb-2">输入参数</div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-sm">
              {Object.entries(inputs).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-slate-400 shrink-0">{k}：</span>
                  <span className="text-slate-700 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mb-5">
          <div className="text-sm font-medium text-slate-700 mb-2">运行结果</div>
          {videos.length > 0 && (
            <div className="space-y-3 mb-3">
              {videos.map((src, i) => (
                <video key={i} src={src} controls className="w-full max-h-[60vh] rounded-xl border border-slate-200 bg-black" />
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                  <img src={src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-auto object-contain max-h-[60vh]" />
                </a>
              ))}
            </div>
          )}
          {(images.length > 0 || videos.length > 0) && (
            <div className="text-xs text-slate-400 mb-2">原始输出</div>
          )}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {asset.content || '无文本结果'}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>耗时：{formatDuration(asset.duration)}</span>
          <span>消耗：{formatCost(asset.cost, asset.tokens)}</span>
          <span>来源：{SOURCE_TYPE_NAMES[asset.sourceType] || asset.sourceType} · {asset.sourceName}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        {asset.content && <CopyButton text={asset.content} label="复制结果" />}
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
  );
}

function TextCard({ asset, onSelect, onCopy, onDelete }) {
  const preview = (asset.content || '').slice(0, 180);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition flex flex-col h-full">
      <div className="flex-1 min-h-0 cursor-pointer" onClick={onSelect}>
        <div className="text-xs text-slate-400 mb-1">{formatTime(asset.createdAt)}</div>
        <h4 className="font-semibold text-slate-900 mb-2 line-clamp-1">{asset.name}</h4>
        <p className="text-sm text-slate-600 leading-relaxed line-clamp-4 whitespace-pre-wrap">{preview}</p>
      </div>
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">{SOURCE_TYPE_NAMES[asset.sourceType] || asset.sourceType}</span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600">{ASSET_TYPE_LABELS[asset.type] || '文案'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onSelect} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="查看详情"><Eye size={15} /></button>
          <button onClick={onCopy} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="复制"><Copy size={15} /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition" title="删除"><Trash2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function MediaCard({ asset, onSelect, onDelete }) {
  const src = asset.images?.[0] || asset.videos?.[0] || asset.audios?.[0] || asset.content || '';
  const isImage = asset.type === 'image' || asset.type === 'graphic';
  return (
    <div className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition cursor-pointer" onClick={onSelect}>
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        {isImage ? (
          <img src={src} alt={asset.name} onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : asset.type === 'video' ? (
          <video src={src} className="w-full h-full object-cover" muted preload="metadata" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300"><Mic size={48} /></div>
        )}
        {/* 删除按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-white/90 text-slate-500 hover:text-rose-600 hover:bg-rose-50 shadow-sm transition"
          title="删除"
        >
          <Trash2 size={14} />
        </button>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="text-white text-sm font-medium truncate">{asset.name}</div>
          <div className="text-white/80 text-xs">{SOURCE_TYPE_NAMES[asset.sourceType] || asset.sourceType} · {ASSET_TYPE_LABELS[asset.type] || '文案'}</div>
        </div>
      </div>
      <div className="p-4">
        <div className="text-xs text-slate-400 mb-1">{formatTime(asset.createdAt)}</div>
        <h4 className="font-medium text-slate-900 line-clamp-1">{asset.name}</h4>
      </div>
    </div>
  );
}

export default function Assets() {
  const { user, assets, deleteAsset, updateAsset, loadUserAssets } = useStore();
  const [tab, setTab] = useState('task');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);

  // 2026-08-05 拆表后：我的资产按用户单独存储，页面挂载/登录态变化时从服务端拉取
  useEffect(() => {
    if (user && user.id) loadUserAssets(user.id);
    else setTab('task');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.id, loadUserAssets]);

  if (!user) return <div className="text-center text-slate-500 py-20">请先登录</div>;

  const filtered = assets
    .filter((a) => a.userId === user.id)
    .filter((a) => a.type === tab || (tab === 'copy' && a.type === 'soft'))
    .filter((a) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (a.name || '').toLowerCase().includes(q)
        || (a.content || '').toLowerCase().includes(q)
        || (a.sourceName || '').toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pagination = paginate(filtered, page);
  const pagedAssets = pagination.items;

  const handleCopy = async (text) => {
    // HTTP 下 navigator.clipboard 是 undefined；copyText 自动走 execCommand 兜底
    await copyText(text || '');
  };

  const handleDelete = (id) => {
    if (window.confirm('确定删除该资产？此操作不可恢复。')) deleteAsset(id);
  };

  const currentTab = TABS.find((t) => t.key === tab);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">我的资产</h1>
        <p className="text-slate-500 text-sm">管理您的所有创作资产与任务记录</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 工具栏 */}
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setPage(1); }}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${tab === t.key ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                >
                  <Icon size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="relative flex-1 lg:max-w-sm lg:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="搜索资产..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
          </div>
        </div>

        {/* 内容区：底部+右侧留白，避免右下角「联系我们」浮窗遮挡操作列按钮（删除/任务详情） */}
        <div className="p-4 md:p-5 pb-28 md:pr-12 lg:pr-20">
          {tab === 'task' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-3.5 font-medium">任务名称</th>
                    <th className="text-left px-4 py-3.5 font-medium">类型</th>
                    <th className="text-left px-4 py-3.5 font-medium">状态</th>
                    <th className="text-left px-4 py-3.5 font-medium">创建时间</th>
                    <th className="text-left px-4 py-3.5 font-medium">耗时</th>
                    <th className="text-left px-4 py-3.5 font-medium">消耗算力</th>
                    <th className="text-left px-4 py-3.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedAssets.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">{a.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-[200px]">{a.sourceName}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">{SOURCE_TYPE_NAMES[a.sourceType] || a.sourceType}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${STATUS_STYLE[a.status] || 'bg-slate-100 text-slate-600'}`}>
                          {STATUS_TEXT[a.status] || a.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-500 text-xs">{formatTime(a.createdAt)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatDuration(a.duration)}</td>
                      <td className="px-4 py-4 text-slate-600">{formatCost(a.cost, a.tokens)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setSelected(a)} className="text-xs text-slate-500 hover:text-slate-700 hover:underline font-normal cursor-pointer transition" title="任务详情">任务详情</button>
                          <button onClick={() => { if (window.confirm('确定删除该资产？')) deleteAsset(a.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer" title="删除"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-400 text-sm">暂无「任务」记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {(tab === 'copy') && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedAssets.map((a) => (
                <TextCard
                  key={a.id}
                  asset={a}
                  onSelect={() => setSelected(a)}
                  onCopy={() => handleCopy(a.content)}
                  onDelete={() => handleDelete(a.id)}
                />
              ))}
              {filtered.length === 0 && <div className="col-span-full text-center text-slate-400 py-16 text-sm">暂无「{currentTab?.label}」资产</div>}
            </div>
          )}

          {(tab === 'image' || tab === 'video' || tab === 'audio') && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {pagedAssets.map((a) => (
                <MediaCard key={a.id} asset={a} onSelect={() => setSelected(a)} onDelete={() => handleDelete(a.id)} />
              ))}
              {filtered.length === 0 && <div className="col-span-full text-center text-slate-400 py-16 text-sm">暂无「{currentTab?.label}」资产</div>}
            </div>
          )}

          {tab === 'graphic' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pagedAssets.map((a) => {
                const imgs = a.images || [];
                return (
                <div key={a.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition">
                  <div className="cursor-pointer" onClick={() => setSelected(a)}>
                    {imgs.length > 0 && (
                      imgs.length === 1 ? (
                        <div className="aspect-video overflow-hidden bg-slate-100">
                          <img src={imgs[0]} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                        </div>
                      ) : (
                        <div className="relative aspect-video overflow-hidden bg-slate-100">
                          <img src={imgs[0]} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 p-1.5 flex gap-1 overflow-x-auto bg-gradient-to-t from-black/40 to-transparent">
                            {imgs.slice(1, 7).map((src, i) => (
                              <img key={i} src={src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-10 h-10 object-cover rounded border border-white/40 shrink-0" />
                            ))}
                            {imgs.length > 7 && <span className="w-10 h-10 rounded border border-white/40 bg-black/40 text-white text-[10px] flex items-center justify-center shrink-0">+{imgs.length - 7}</span>}
                          </div>
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">共 {imgs.length} 张</span>
                        </div>
                      )
                    )}
                    <div className="p-4">
                      <div className="text-xs text-slate-400 mb-1">{formatTime(a.createdAt)}</div>
                      <h4 className="font-semibold text-slate-900 mb-2 line-clamp-1">{a.name}</h4>
                      <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">{(a.content || '').slice(0, 120)}</p>
                    </div>
                  </div>
                  <div className="px-4 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">{SOURCE_TYPE_NAMES[a.sourceType] || a.sourceType}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600">{ASSET_TYPE_LABELS[a.type]}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleCopy(a.content)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="复制"><Copy size={15} /></button>
                      <button onClick={() => handleDelete(a.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition" title="删除"><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
                );
              })}
              {filtered.length === 0 && <div className="col-span-full text-center text-slate-400 py-16 text-sm">暂无「图文」资产</div>}
            </div>
          )}
          <UserPagination
            page={pagination.currentPage}
            total={pagination.total}
            totalPages={pagination.totalPages}
            pageSize={USER_PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>

      {selected && selected.type === 'task' && <TaskDetail asset={selected} onClose={() => setSelected(null)} />}
      {selected && selected.type === 'copy' && <TextDetail asset={selected} onClose={() => setSelected(null)} updateAsset={updateAsset} />}
      {selected && selected.type === 'graphic' && <GraphicDetail asset={selected} onClose={() => setSelected(null)} updateAsset={updateAsset} />}
      {selected && selected.type === 'image' && <ImageDetail asset={selected} onClose={() => setSelected(null)} />}
      {selected && (selected.type === 'video' || selected.type === 'audio') && <MediaDetail asset={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
