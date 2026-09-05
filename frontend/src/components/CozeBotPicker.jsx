import { useState, useEffect, useMemo } from 'react';
import { Loader2, Search, AlertCircle, CheckCircle2, Bot, ChevronRight } from 'lucide-react';
import { Modal } from '../adminUI.jsx';
import { listCozeBots } from '../cozeApi.js';

const MOCK_PROVIDER_ID = '__mock__';

// 旧版 Coze 智能体单选对话框：左侧个人空间，右侧空间下 AI 智能体，点中高亮 → 确认导入。
// authProviderId 为 '__mock__' 时默认走演示数据（无需真实账号）。
export default function CozeBotPicker({ open, onClose, authProviderId, onPick }) {
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState('');
  const [bots, setBots] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [manualWsId, setManualWsId] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [useMock, setUseMock] = useState(authProviderId === MOCK_PROVIDER_ID);
  const pageSize = 12;

  const loadWorkspaces = async (mockOverride) => {
    const mock = mockOverride !== undefined ? mockOverride : useMock;
    setLoading(true);
    setError('');
    setShowManual(false);
    setWorkspaces([]);
    setActiveWs('');
    try {
      const body = mock ? { mock: true } : { authProviderId };
      const r = await listCozeBots(body);
      if (!r.ok) {
        setError(r.error || '拉取空间失败');
        setShowManual(true);
      } else {
        const list = r.workspaces || [];
        setWorkspaces(list);
        if (list[0]) setActiveWs(list[0].id);
        else { setError('该账号下未找到任何个人空间，可手动填写空间 ID'); setShowManual(true); }
      }
    } catch (e) {
      setError(String(e.message || e));
      setShowManual(true);
    } finally {
      setLoading(false);
    }
  };

  const loadBots = async (wsId, mockOverride) => {
    const mock = mockOverride !== undefined ? mockOverride : useMock;
    if (!wsId) return;
    setLoading(true);
    setError('');
    setBots([]);
    setSelected(null);
    try {
      const body = mock ? { mock: true, workspaceId: wsId } : { authProviderId, workspaceId: wsId, pageNum: 1, pageSize: 50 };
      const r = await listCozeBots(body);
      if (!r.ok) {
        setError(r.error || '拉取智能体失败');
        setBots([]);
      } else {
        setBots(r.bots || []);
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setActiveWs('');
      setBots([]);
      setSelected(null);
      setKeyword('');
      setPage(1);
      setError('');
      setManualWsId('');
      setShowManual(false);
      const initialMock = authProviderId === MOCK_PROVIDER_ID;
      setUseMock(initialMock);
      loadWorkspaces(initialMock);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (activeWs) loadBots(activeWs, useMock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWs]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return bots;
    return bots.filter(b => (b.bot_name || '').toLowerCase().includes(k) || (b.description || '').toLowerCase().includes(k));
  }, [bots, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const confirm = () => {
    if (!selected) return;
    onPick(selected);
  };

  return (
    <Modal open={open} onClose={onClose} title="选择 Coze 智能体" footer={null} panelClassName="max-w-[1240px]">
      <div className="-mx-6 -my-6">
        {/* 顶部：演示数据开关 */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-slate-100 bg-slate-50/60">
          <span className="text-xs text-slate-500">请左侧选择个人空间，右侧点选智能体，再点右下角「确认导入」。</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={useMock} onChange={e => { const m = e.target.checked; setUseMock(m); setWorkspaces([]); setActiveWs(''); setBots([]); setSelected(null); loadWorkspaces(m); }} className="accent-blue-600" />
            演示数据（无需真实账号）
          </label>
        </div>
        <div className="flex h-[520px]">
          {/* 左：空间列表 */}
          <div className="w-56 border-r border-slate-100 bg-slate-50/50 overflow-y-auto p-3 space-y-1">
            <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">个人空间</div>
            {loading && !workspaces.length ? (
              <div className="px-2 py-3 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />加载中…</div>
            ) : (
              workspaces.map(ws => (
                <button key={ws.id} type="button" onClick={() => { setActiveWs(ws.id); setPage(1); setSelected(null); setShowManual(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${activeWs === ws.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <div className="font-medium truncate flex items-center gap-1"><ChevronRight size={12} className={activeWs === ws.id ? 'opacity-100' : 'opacity-30'} />{ws.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{ws.id}</div>
                </button>
              ))
            )}
            {showManual && (
              <div className="pt-2 border-t border-slate-200 mt-2 space-y-2">
                <div className="text-[11px] text-slate-500 px-2">自动拉取空间失败，可手动填写空间 ID</div>
                <input value={manualWsId} onChange={e => setManualWsId(e.target.value)} placeholder="如 7455..." className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono" />
                <button type="button" disabled={!manualWsId.trim() || loading} onClick={() => { setActiveWs(manualWsId.trim()); setPage(1); setSelected(null); }}
                  className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 加载该空间智能体
                </button>
              </div>
            )}
          </div>

          {/* 右：智能体卡片 + 搜索 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }} placeholder="搜索当前页…" className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs" />
              </div>
              <div className="text-xs text-slate-400">{filtered.length} 个</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {error ? (
                <div className="p-4 rounded-lg bg-rose-50 text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />{error}
                </div>
              ) : loading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin mr-2" />加载智能体…</div>
              ) : paged.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">该空间下暂无智能体</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                  {paged.map(b => {
                    const isSel = selected && selected.bot_id === b.bot_id;
                    return (
                      <button key={b.bot_id} type="button" onClick={() => setSelected(b)}
                        className={`w-full text-left px-3 py-3 rounded-xl border transition flex items-center gap-3 ${isSel ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center overflow-hidden shrink-0">
                          {b.icon_url ? <img src={b.icon_url} alt="" className="w-full h-full object-cover" /> : <Bot size={20} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm text-slate-800 truncate">{b.bot_name}</div>
                          <div className="text-[11px] text-slate-400 truncate">{b.description}</div>
                          <div className="text-[10px] text-slate-300 font-mono truncate">{b.bot_id}</div>
                        </div>
                        {isSel && <CheckCircle2 size={18} className="text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 分页 + 确认导入 */}
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {pageCount > 1 && (
                  <>
                    <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">上一页</button>
                    <span>{page} / {pageCount}</span>
                    <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">下一页</button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selected && <span className="text-xs text-slate-500 truncate max-w-[200px]">已选：{selected.bot_name}</span>}
                <button type="button" onClick={confirm} disabled={!selected}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                  确认导入
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { MOCK_PROVIDER_ID };
