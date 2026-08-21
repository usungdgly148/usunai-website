import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import {
  Search, FileText, Image as ImageIcon, Video, Mic, Layers, CheckSquare,
  Eye, Trash2, X, Download
} from 'lucide-react';
import { AdminPageHeader, AdminPagination, Card } from '../adminUI.jsx';
import { ASSET_TYPE_LABELS } from '../mock.js';
import { SOURCE_TYPE_NAMES, formatDuration, formatCost } from '../assetUtils.js';
import { adminFetch } from '../authFetch.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'task', label: '任务' },
  { key: 'copy', label: '文案' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'graphic', label: '图文' },
];

const TYPE_ICON = {
  task: CheckSquare, copy: FileText, image: ImageIcon, video: Video, audio: Mic, graphic: Layers,
};

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Detail({ asset, onClose }) {
  const src = asset.images?.[0] || asset.videos?.[0] || asset.audios?.[0] || asset.content || '';
  const isMedia = asset.type === 'image' || asset.type === 'video' || asset.type === 'audio';
  const handleDownload = async () => {
    try {
      const res = await fetch(src, { mode: 'cors' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = asset.type === 'video' ? 'mp4' : asset.type === 'audio' ? 'mp3' : 'jpg';
      a.download = asset.name ? `${asset.name}.${ext}` : `download.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank');
    }
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
        {asset.userId && (
          <div className="text-sm text-slate-500 mb-4">所属用户：{asset.userId}</div>
        )}
        {isMedia && src ? (
          <div className="bg-slate-100/50 rounded-xl p-4 flex items-center justify-center">
            {asset.type === 'image' && <img src={src} alt={asset.name} className="max-w-full max-h-[60vh] rounded-xl" />}
            {asset.type === 'video' && <video src={src} controls className="max-w-full max-h-[60vh] rounded-xl" />}
            {asset.type === 'audio' && <audio src={src} controls className="w-full" />}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4 md:p-5 border border-slate-100 whitespace-pre-wrap">
            {asset.content ? <Markdown remarkPlugins={[remarkGfm]}>{asset.content}</Markdown> : '无内容'}
          </div>
        )}
        {asset.images?.length > 0 && asset.type !== 'image' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
            {asset.images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-slate-200">
                <img src={src} alt="" className="w-full h-28 object-cover" />
              </a>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-500">
          <span>来源：{SOURCE_TYPE_NAMES[asset.sourceType] || asset.sourceType} · {asset.sourceName}</span>
          <span>耗时：{formatDuration(asset.duration)}</span>
          <span>消耗：{formatCost(asset.cost, asset.tokens)}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
        {isMedia && src && (
          <button onClick={handleDownload} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
            <Download size={14} /> 下载
          </button>
        )}
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition">关闭</button>
      </div>
    </Modal>
  );
}

export default function AdminAssets() {
  const { deleteAssetAdmin } = useStore();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          type: tab,
          search: debouncedSearch,
        });
        const response = await adminFetch(`/api/admin/assets?${params.toString()}`);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || !result.ok) {
          throw new Error((result && result.msg) || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        setAssets(Array.isArray(result.items) ? result.items : []);
        setTotal(Number(result.total) || 0);
      } catch (error) {
        if (cancelled) return;
        setAssets([]);
        setTotal(0);
        setLoadError((error && error.message) || '资产列表加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [page, tab, debouncedSearch, refreshVersion]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openDetail = async (asset) => {
    setLoadingDetailId(String(asset.id));
    try {
      const params = new URLSearchParams({ userId: String(asset.userId || ''), assetId: String(asset.id || '') });
      const response = await adminFetch(`/api/admin/assets/detail?${params.toString()}`);
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok || !result.item) {
        throw new Error((result && result.msg) || `HTTP ${response.status}`);
      }
      setSelected(result.item);
    } catch (error) {
      window.alert(`资产详情加载失败：${(error && error.message) || '请稍后重试'}`);
    } finally {
      setLoadingDetailId('');
    }
  };

  const removeAsset = async (asset) => {
    if (!window.confirm('确定删除该资产？')) return;
    const result = await deleteAssetAdmin(asset.userId, asset.id);
    if (!result || !result.ok) {
      window.alert(`删除失败：${(result && result.msg) || '请稍后重试'}`);
      return;
    }
    setSelected(null);
    setRefreshVersion(value => value + 1);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="资产管理" subtitle="查看与管理用户创作的任务、文案、图片、视频等资产" />

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资产 / 用户" className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-5 py-3 font-medium">资产名称</th>
              <th className="text-left px-5 py-3 font-medium">用户</th>
              <th className="text-left px-5 py-3 font-medium">类型</th>
              <th className="text-left px-5 py-3 font-medium">状态</th>
              <th className="text-left px-5 py-3 font-medium">消耗</th>
              <th className="text-left px-5 py-3 font-medium">创建时间</th>
              <th className="text-left px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const Icon = TYPE_ICON[a.type] || FileText;
              return (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{a.name}</div>
                    <div className="text-xs text-slate-400 font-mono truncate max-w-[220px]">{a.sourceName}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    <div>{a.userName || a.userId}</div>
                    {a.userEmail && <div className="text-xs text-slate-400">{a.userEmail}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-slate-600"><Icon size={14} /> {ASSET_TYPE_LABELS[a.type] || a.type}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[a.status] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_TEXT[a.status] || a.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{formatCost(a.cost, a.tokens)}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{formatTime(a.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <button disabled={loadingDetailId === String(a.id)} onClick={() => openDetail(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-40" title="查看"><Eye size={15} /></button>
                      <button onClick={() => removeAsset(a)} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="删除"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {loading && <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400 text-sm">正在加载资产...</td></tr>}
            {!loading && loadError && <tr><td colSpan={7} className="px-5 py-12 text-center text-rose-500 text-sm">加载失败：{loadError}</td></tr>}
            {!loading && !loadError && assets.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-slate-400 text-sm">暂无资产</td></tr>}
          </tbody>
        </table>
        <AdminPagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} />
      </Card>

      {selected && <Detail asset={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
