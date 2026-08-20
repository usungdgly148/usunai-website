import { useStore } from '../store.jsx';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft, Save, Eye, EyeOff, Plus, X, Trash2, KeyRound, Link2, FormInput, Settings2, Sparkles,
  List, Download, Search, ChevronLeft, ChevronRight, Loader2, AlertCircle, CheckCircle2,
  Sliders, Upload, RefreshCw, Pencil, GripVertical, MessageSquare,
} from 'lucide-react';
import { Card, AdminIconPicker, renderIcon, Toggle, PrimaryButton, SecondaryButton, Modal } from '../adminUI.jsx';
import { listCozeWorkspaces, listCozeWorkflows, getCozeWorkflowInfo, runWorkflow } from '../cozeApi.js';

const COLOR_OPTIONS = ['bg-blue-600', 'bg-rose-600', 'bg-emerald-600', 'bg-amber-600', 'bg-violet-600', 'bg-slate-700', 'bg-cyan-600', 'bg-teal-600'];

// 扣子旧版工作流（type 大写 string）
const COZE_TYPES = ['string', 'number', 'integer', 'boolean', 'image', 'file', 'object', 'array<string>', 'array<number>', 'array<boolean>', 'array<image>', 'array<file>', 'array<object>'];

// 字段「样式」：与扣子输入控件一致
const STYLE_OPTIONS = [
  { value: 'input', label: '输入框' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '单选' },
  { value: 'boolean', label: '开关' },
  { value: 'date', label: '日期' },
  { value: 'file', label: '文件' },
  { value: 'advanced', label: '高级' },
];

// 结果渲染类型
const RESULT_KIND_OPTIONS = [
  { value: 'text', label: '纯文案' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'mixed', label: '图文混排' },
];

// 输出字段"标记"列下拉选项（与扣子字段类型联动）
// 作用：前台工作流内页按字段 tag 决定如何渲染（图片/视频/音频/代码/文档/无）
// 关键：主人 2026-07-24 要求"按标记渲染输出"，因此 mark 字段从此列接管
const OUTPUT_TAG_OPTIONS = [
  { value: '', label: '-' },
  { value: 'image-required', label: '图片(强制)' },
  { value: 'video-required', label: '视频(强制)' },
  { value: 'audio-required', label: '音频(强制)' },
  { value: 'code', label: '代码' },
  { value: 'document', label: '文档' },
];

// 根据扣子字段类型推断默认 mark（智能获取时自动填）
const inferOutputTag = (p) => {
  const t = (p.type || 'string').toLowerCase();
  if (t === 'image' || (t.startsWith('array<') && t.includes('image'))) return 'image-required';
  if (t === 'file' || (t.startsWith('array<') && t.includes('file'))) return 'document';
  // 视频/音频扣子无原生类型，多为 string（URL）；这里不强推，避免误判
  return '';
};

const PLATFORMS = [
  { value: 'coze-old', label: 'Coze', note: '旧版 /v1/workflow/run + PAT' },
  { value: 'dify', label: 'Dify', note: '即将支持' },
  { value: 'coze-new', label: 'Coze 新版', note: '即将支持' },
  { value: 'yunti', label: '云之', note: '即将支持' },
  { value: 'third-party', label: '三方开发者', note: '即将支持' },
];

const blankForm = {
  name: '', desc: '', category: 'short-video', icon: 'Clapperboard', iconColor: 'bg-cyan-600',
  avatar: '', tags: [], published: false, vip: false, sortOrder: 999,
  // 工作流专属
  platform: 'coze-old',
  authProviderId: '',
  workspaceId: '',
  workflowId: '',
  workflowName: '',
  formFields: [],
  outputFields: [],
  resultKind: 'text',
  // 兼容旧版
  apiKey: '', baseUrl: '',
  priceType: 'run', priceRate: 10,
  gradientFrom: '#CFFAFE', gradientTo: '#FFFFFF', gradientAngle: 30,
};

const GRADIENT_PRESETS = {
  'bg-blue-600': { gradientFrom: '#DBEAFE', gradientTo: '#FFFFFF' },
  'bg-rose-600': { gradientFrom: '#FFE4E6', gradientTo: '#FFFFFF' },
  'bg-emerald-600': { gradientFrom: '#D1FAE5', gradientTo: '#FFFFFF' },
  'bg-amber-600': { gradientFrom: '#FEF3C7', gradientTo: '#FFFFFF' },
  'bg-violet-600': { gradientFrom: '#EDE9FE', gradientTo: '#FFFFFF' },
  'bg-slate-700': { gradientFrom: '#F1F5F9', gradientTo: '#FFFFFF' },
  'bg-cyan-600': { gradientFrom: '#CFFAFE', gradientTo: '#FFFFFF' },
  'bg-teal-600': { gradientFrom: '#CCFBF1', gradientTo: '#FFFFFF' },
  'bg-green-600': { gradientFrom: '#DCFCE7', gradientTo: '#FFFFFF' },
  'bg-lime-600': { gradientFrom: '#ECFCCB', gradientTo: '#FFFFFF' },
  'bg-purple-600': { gradientFrom: '#F3E8FF', gradientTo: '#FFFFFF' },
  'bg-indigo-600': { gradientFrom: '#E0E7FF', gradientTo: '#FFFFFF' },
  'bg-red-600': { gradientFrom: '#FEE2E2', gradientTo: '#FFFFFF' },
};
function gradientDefaults(iconColor) { return GRADIENT_PRESETS[iconColor] || { gradientFrom: '#F8FAFC', gradientTo: '#FFFFFF' }; }

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';

function Field({ label, hint, children, required }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

/* ============================================================
 * 列表选择弹窗：左侧空间列表 + 右侧工作流卡片网格
 * ============================================================ */
function WorkflowListPicker({ open, onClose, auth, onPick }) {
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState('');
  const [items, setItems] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [manualWsId, setManualWsId] = useState('');
  const [showManual, setShowManual] = useState(false);
  const pageSize = 5;

  const buildCfg = () => {
    if (!auth) return null;
    const base = { baseUrl: auth.baseUrl, authType: auth.type === 'oauth' ? 'oauth' : 'pat' };
    if (auth.type === 'oauth') {
      return { ...base, clientId: auth.clientId, keyId: auth.keyId, privateKey: auth.privateKey };
    }
    return { ...base, apiKey: auth.apiKey };
  };

  const loadWorkspaces = async () => {
    const cfg = buildCfg();
    if (!cfg) { setError('未选择授权凭证'); return; }
    setLoading(true);
    setError('');
    setShowManual(false);
    try {
      const r = await listCozeWorkspaces(cfg);
      if (!r.ok) {
        setError(r.error || '拉取空间失败');
        setWorkspaces([]);
        setShowManual(true);
      } else {
        const list = r.workspaces || [];
        setWorkspaces(list);
        if (list[0]) {
          setActiveWs(list[0].id);
        } else {
          setError('该账号下未找到任何工作空间，请检查授权凭证或手动填写空间 ID');
          setShowManual(true);
        }
      }
    } catch (e) {
      setError(String(e.message || e));
      setShowManual(true);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkflows = async (wsId) => {
    const cfg = buildCfg();
    if (!cfg || !wsId) return;
    setLoading(true);
    setError('');
    setItems([]);
    try {
      const r = await listCozeWorkflows({ ...cfg, workspaceId: wsId });
      if (!r.ok) {
        setError(r.error || '拉取工作流失败');
        setItems([]);
      } else {
        setItems(r.items || []);
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  // 打开时拉取空间列表
  useEffect(() => {
    if (open) {
      setActiveWs('');
      setItems([]);
      setSelected(null);
      setKeyword('');
      setPage(1);
      setError('');
      setManualWsId('');
      setShowManual(false);
      loadWorkspaces();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 空间切换后拉取工作流
  useEffect(() => {
    if (activeWs) loadWorkflows(activeWs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWs]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return items;
    return items.filter(i => (i.workflow_name || '').toLowerCase().includes(k) || (i.description || '').toLowerCase().includes(k));
  }, [items, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Modal open={open} onClose={onClose} title="选择工作流" footer={null}>
      <div className="-mx-6 -my-6">
        <div className="flex items-center justify-between px-6 py-2.5 text-xs border-b border-slate-100 bg-slate-50/40">
          <span className="text-slate-500">空间列表 <b className="text-slate-700 font-semibold">{workspaces.length}</b></span>
          <span className="text-slate-500">工作流列表 <b className="text-slate-700 font-semibold">{(workspaces.find(w => w.id === activeWs) || {}).name || '-'}</b> <b className="text-slate-700 font-semibold">{items.length}</b></span>
        </div>
        <div className="flex h-[520px]">
          {/* 左：空间列表 */}
          <div className="w-52 border-r border-slate-100 bg-slate-50/50 overflow-y-auto p-3 space-y-1">
            <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">空间列表</div>
            {loading && !workspaces.length ? (
              <div className="px-2 py-3 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />加载中…</div>
            ) : (
              workspaces.map(ws => (
                <button key={ws.id} type="button" onClick={() => { setActiveWs(ws.id); setPage(1); setSelected(null); setShowManual(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${activeWs === ws.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`}>
                  <div className="font-medium truncate">{ws.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{ws.id}</div>
                </button>
              ))
            )}
            {showManual && (
              <div className="pt-2 border-t border-slate-200 mt-2 space-y-2">
                <div className="text-[11px] text-slate-500 px-2">自动拉取空间失败，可手动填写空间 ID</div>
                <input
                  value={manualWsId}
                  onChange={e => setManualWsId(e.target.value)}
                  placeholder="如 7455..."
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                />
                <button
                  type="button"
                  disabled={!manualWsId.trim() || loading}
                  onClick={() => { setActiveWs(manualWsId.trim()); setPage(1); setSelected(null); }}
                  className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  加载该空间工作流
                </button>
              </div>
            )}
          </div>

          {/* 右：工作流卡片 + 搜索 */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={keyword} onChange={e => { setKeyword(e.target.value); setPage(1); }} placeholder="搜索工作流名称…" className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs" />
              </div>
              <div className="text-xs text-slate-400">{filtered.length} 个</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {error ? (
                <div className="p-4 rounded-lg bg-rose-50 text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              ) : loading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin mr-2" />加载工作流…</div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {paged.map(wf => {
                    const initial = (wf.workflow_name || '?').trim().charAt(0).toUpperCase();
                    return (
                      <button key={wf.workflow_id} type="button" onClick={() => setSelected(wf.workflow_id)}
                        className={`group relative flex items-center gap-3.5 p-3 rounded-xl border text-left transition ${selected === wf.workflow_id ? 'border-blue-500 bg-blue-50/40 shadow-sm' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}>
                        {/* 左：图标（icon_url 优先，无则首字渐变块） */}
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-gradient-to-br from-cyan-500 to-blue-500 text-white flex items-center justify-center shrink-0 text-xl font-bold">
                          {wf.icon_url ? (
                            <img src={wf.icon_url} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
                          ) : (
                            initial
                          )}
                        </div>
                        {/* 右：名称 + 版本 + 描述（三行清晰布局） */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="font-semibold text-slate-900 text-[14px] leading-tight truncate flex-1">{wf.workflow_name}</div>
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">v{wf.version}</span>
                          </div>
                          <p className="text-[12px] text-slate-500 line-clamp-2 leading-snug">{wf.description || '暂无描述'}</p>
                        </div>
                        {selected === wf.workflow_id && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center"><CheckCircle2 size={12} /></div>
                        )}
                      </button>
                    );
                  })}
                  {!loading && paged.length === 0 && (
                    <div className="col-span-1 text-center text-sm text-slate-400 py-12">{keyword ? '没有匹配的工作流' : '该空间下没有工作流'}</div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <div className="text-slate-500">第 {page} / {pageCount} 页 · 共 {filtered.length} 个</div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="inline-flex items-center gap-0.5 px-2 py-1 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft size={13} />上一页</button>
                <span className="px-2 text-slate-400">·</span>
                <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)} className="inline-flex items-center gap-0.5 px-2 py-1 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">下一页<ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-3">
          <SecondaryButton onClick={onClose}>取消</SecondaryButton>
          <button
            type="button"
            disabled={!selected}
            onClick={() => { const wf = items.find(i => i.workflow_id === selected); if (wf) onPick({ ...wf, workspace_id: activeWs }); }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认导入（已选 {selected ? 1 : 0} 个）
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
 * 高级配置弹窗：组件样式 + 预选选项
 * ============================================================ */
function AdvancedFieldEditor({ open, onClose, value, onChange }) {
  const cfg = value || { component: 'radio', layout: 'list', options: [{ value: '1', label: '选项 1' }], min: 0, max: 5 };
  const set = (p) => onChange({ ...cfg, ...p });
  const updateOption = (i, p) => set({ options: cfg.options.map((o, idx) => idx === i ? { ...o, ...p } : o) });
  const removeOption = (i) => set({ options: cfg.options.filter((_, idx) => idx !== i) });

  return (
    <Modal open={open} onClose={onClose} title={`高级配置 · ${cfg.key || ''}`} footer={null}>
      <div className="-mx-6 -my-6">
        <p className="px-6 pt-3 text-xs text-slate-500">配置参数的预设值、样式及其他高级选项</p>
        <div className="px-6 pt-3 flex gap-2 border-b border-slate-100">
          {['样式与外观', '预选选项'].map((tab, i) => (
            <button key={tab} type="button" onClick={() => set({ _tab: i })}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${(cfg._tab ?? 0) === i ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {tab}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6 px-6 py-5">
          {/* 左侧：编辑区 */}
          <div className="space-y-4">
            {(cfg._tab ?? 0) === 0 ? (
              <>
                <Field label="组件样式">
                  <select value={cfg.component} onChange={e => set({ component: e.target.value })} className={inputCls}>
                    <option value="radio">单选 (Radio)</option>
                    <option value="checkbox">多选 (Checkbox)</option>
                    <option value="select">下拉 (Select)</option>
                    <option value="switch">开关 (Switch)</option>
                    <option value="slider">滑块 (Slider)</option>
                    <option value="date">日期 (Date)</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">选择组件，单选/多选/下拉必须有选项；滑块需要设置范围</p>
                </Field>
                {cfg.component === 'slider' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="最小值"><input type="number" value={cfg.min ?? 0} onChange={e => set({ min: Number(e.target.value) })} className={inputCls} /></Field>
                    <Field label="最大值"><input type="number" value={cfg.max ?? 5} onChange={e => set({ max: Number(e.target.value) })} className={inputCls} /></Field>
                  </div>
                )}
                <Field label="提示文案 (Hint Text)">
                  <input value={cfg.hint || ''} onChange={e => set({ hint: e.target.value })} placeholder="输入框下方的提示说明…" className={inputCls} />
                </Field>
              </>
            ) : (
              <>
                <Field label="预选值" hint={'点击「添加」按钮添加选项，使用 Value 作为实际提交值'}>
                  <div className="flex items-center gap-2 mb-2">
                    <input className={inputCls} placeholder="选项值 (Value)" id="adv-opt-value" />
                    <input className={inputCls} placeholder="显示标签 (Label)" id="adv-opt-label" />
                    <button type="button" onClick={() => {
                      const v = document.getElementById('adv-opt-value').value.trim();
                      const l = document.getElementById('adv-opt-label').value.trim() || v;
                      if (!v) return;
                      set({ options: [...(cfg.options || []), { value: v, label: l }] });
                      document.getElementById('adv-opt-value').value = '';
                      document.getElementById('adv-opt-label').value = '';
                    }} className="shrink-0 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"><Plus size={14} /> 添加</button>
                  </div>
                  <div className="space-y-1.5">
                    {(cfg.options || []).map((o, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                        <input value={o.label} onChange={e => updateOption(i, { label: e.target.value })} placeholder="显示标签" className={`${inputCls} flex-1`} />
                        <input value={o.value} onChange={e => updateOption(i, { value: e.target.value })} placeholder="值" className={`${inputCls} w-32`} />
                        <button type="button" onClick={() => removeOption(i)} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {(!cfg.options || cfg.options.length === 0) && (
                      <div className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">还没有选项，点击上方"添加"</div>
                    )}
                  </div>
                </Field>
              </>
            )}
          </div>

          {/* 右侧：效果预览 */}
          <div className="border border-slate-200 rounded-xl bg-slate-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">效果预览</div>
              <span className="text-[10px] text-slate-400">当前键名：{cfg.key || 'field'}</span>
            </div>
            <div className="bg-white rounded-lg p-4 border border-slate-100">
              <div className="text-sm font-medium text-slate-700 mb-2">{cfg.label || '字段名'}</div>
              {(cfg.component === 'radio' || cfg.component === 'checkbox') && (
                <div className="space-y-1.5">
                  {(cfg.options || []).map((o, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <input type={cfg.component} name={cfg.key} defaultChecked={i === 0} className="text-blue-600" />
                      {o.label}
                    </label>
                  ))}
                </div>
              )}
              {cfg.component === 'select' && (
                <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {(cfg.options || []).map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {cfg.component === 'switch' && (
                <div className="w-10 h-6 rounded-full bg-blue-600 relative"><span className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow" /></div>
              )}
              {cfg.component === 'slider' && (
                <div className="space-y-1">
                  <input type="range" min={cfg.min ?? 0} max={cfg.max ?? 5} defaultValue={Math.round(((cfg.min ?? 0) + (cfg.max ?? 5)) / 2)} className="w-full accent-blue-600" />
                  <div className="text-xs text-slate-400 text-center">{cfg.min ?? 0} ~ {cfg.max ?? 5}</div>
                </div>
              )}
              {cfg.component === 'date' && (
                <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              )}
              {!['radio', 'checkbox', 'select', 'switch', 'slider', 'date'].includes(cfg.component) && (
                <div className="text-xs text-slate-400">未选择组件</div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-3">
          <SecondaryButton onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton onClick={onClose}>保存配置</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
 * 输入字段编辑器（带样式 / 高级）
 * ============================================================ */
function FieldEditor({ f, onChange, onRemove, onAdvanced, dragHandlers, isDragOver }) {
  const set = (p) => onChange({ ...f, ...p });
  return (
    <tr
      className={`border-b border-slate-100 hover:bg-slate-50/50 ${isDragOver ? 'bg-blue-50' : ''}`}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
    >
      <td
        draggable
        onDragStart={dragHandlers.onDragStart}
        className="px-2 py-2 align-top w-8 cursor-grab active:cursor-grabbing"
      ><GripVertical size={14} className="text-slate-300" /></td>
      <td className="px-2 py-2 align-top"><input value={f.label || ''} onChange={e => set({ label: e.target.value })} placeholder="显示名称" className="w-full px-2 py-1 border border-slate-200 rounded text-xs" /></td>
      <td className="px-2 py-2 align-top"><input value={f.key || ''} onChange={e => set({ key: e.target.value })} placeholder="参数名" className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono" /></td>
      <td className="px-2 py-2 align-top">
        <select value={f.type || 'string'} onChange={e => set({ type: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs">
          {COZE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 align-top"><input value={f.default || ''} onChange={e => set({ default: e.target.value })} placeholder="-" className="w-full px-2 py-1 border border-slate-200 rounded text-xs" /></td>
      <td className="px-2 py-2 align-top">
        <select value={f.style || 'input'} onChange={e => set({ style: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs">
          {STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 align-top text-center">
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold ${f.required ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-300'}`}>必</span>
        <button type="button" onClick={() => set({ required: !f.required })} className="ml-1 text-slate-300 hover:text-slate-500 text-[10px]">切换</button>
      </td>
      <td className="px-2 py-2 align-top"><input value={f.hint || ''} onChange={e => set({ hint: e.target.value })} placeholder="提示" className="w-full px-2 py-1 border border-slate-200 rounded text-xs" /></td>
      <td className="px-2 py-2 align-top text-center"><Toggle checked={f.enabled !== false} onChange={v => set({ enabled: v })} /></td>
      <td className="px-2 py-2 align-top text-center">
        <button type="button" onClick={onAdvanced} title="高级" className={`p-1 rounded ${f.style === 'advanced' ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:bg-slate-100'}`}>
          <Sliders size={14} />
        </button>
      </td>
      <td className="px-2 py-2 align-top text-center"><button type="button" onClick={onRemove} className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={14} /></button></td>
    </tr>
  );
}

/* ============================================================
 * 调试与运行（右侧栏）
 * ============================================================ */
function DebugPanel({ form, setForm, authProviders, resultKind, setResultKind }) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState('');

  const setField = (key, v) => setForm(prev => ({ ...prev, [key]: v }));

  const runNow = async () => {
    if (!form.workflowId) { setError('请先在中间区域填写「工作流 ID / Key」'); return; }
    if (form.platform !== 'coze-old') { setError(`平台 ${form.platform} 暂未对接实际 API（演示模式）`); return; }
    const auth = authProviders.find(p => p.id === form.authProviderId);
    if (!auth) { setError('请先选择「授权凭证」'); return; }
    if (auth.type !== 'pat' && auth.type !== 'oauth') {
      setError('旧版工作流需要 PAT 或 OAuth 类型的授权，请到「授权中心」添加');
      return;
    }

    setRunning(true);
    setError('');
    setOutput(null);
    try {
      const cfg = {
        baseUrl: auth.baseUrl,
        workflowId: form.workflowId,
        platform: 'coze-old',
        authType: auth.type === 'oauth' ? 'oauth' : 'pat',
      };
      if (auth.type === 'oauth') {
        cfg.clientId = auth.clientId;
        cfg.keyId = auth.keyId;
        cfg.privateKey = auth.privateKey;
      } else {
        cfg.apiKey = auth.apiKey;
      }
      const r = await runWorkflow({ parameters: form, cfg });
      setOutput(r);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 xl:sticky xl:top-24">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Settings2 size={16} className="text-blue-600" /> 调试与运行</h2>
        <span className="text-[10px] text-slate-400 font-mono">日志</span>
      </div>

      {/* 必填字段集合（按 formFields 渲染） */}
      {form.formFields.length === 0 ? (
        <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg py-4 text-center">
          中间区域还没有输入字段，先在那边添加
        </div>
      ) : (
        <div className="space-y-3">
          {form.formFields.filter(f => f.enabled !== false).map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {f.label} {f.required && <span className="text-rose-500">*</span>}
              </label>
              {f.style === 'textarea' ? (
                <textarea rows={3} value={form[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)} placeholder={f.hint || f.placeholder} className={`${inputCls} resize-none`} />
              ) : f.style === 'select' ? (
                <select value={form[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)} className={inputCls}>
                  <option value="">请选择…</option>
                  {(f.advanced?.options || []).map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.style === 'boolean' ? (
                <button type="button" onClick={() => setField(f.key, !form[f.key])} className={`px-3 py-2 rounded-lg border text-sm ${form[f.key] ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{form[f.key] ? '已开启' : '关闭'}</button>
              ) : f.style === 'advanced' ? (
                <select value={form[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)} className={inputCls}>
                  <option value="">请选择…</option>
                  {(f.advanced?.options || []).map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type={f.type === 'number' || f.type === 'integer' ? 'number' : 'text'} value={form[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)} placeholder={f.hint || f.placeholder} className={inputCls} />
              )}
            </div>
          ))}
        </div>
      )}

      <Field label="结果渲染类型" hint="影响前台工作流内页中间区域的展示方式">
        <select value={resultKind} onChange={e => setResultKind(e.target.value)} className={inputCls}>
          {RESULT_KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <button type="button" disabled={running} onClick={runNow}
        className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-60">
        {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {running ? '运行中…' : '立即开始'}
      </button>

      {(error || output) && (
        <div className={`text-xs rounded-lg p-3 font-mono whitespace-pre-wrap break-all ${error ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700'} max-h-72 overflow-y-auto`}>
          {error ? `Error: ${error}` : (
            <div>
              <div className="font-semibold text-slate-900 mb-1">运行成功</div>
              <div>kind: {output.kind}</div>
              {output.execute_id && <div>execute_id: {output.execute_id}</div>}
              {output.kind === 'text' && <div className="mt-2 whitespace-pre-wrap">{output.text}</div>}
              {output.kind === 'json' && <div className="mt-2">{JSON.stringify(output.data, null, 2)}</div>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ============================================================
 * 主页面
 * ============================================================ */
export default function AdminWorkflowEdit({ isNew: isNewProp }) {
  const { id } = useParams();
  const isNew = isNewProp || id === 'new';
  const navigate = useNavigate();
  const { workflows, sortedCategories, updateWorkflow, addWorkflow, authProviders, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const existing = !isNew ? workflows.find(w => w.id === id) : null;

  const [form, setForm] = useState(() => {
    if (existing) {
      const defaults = gradientDefaults(existing.iconColor || 'bg-cyan-600');
      return { ...blankForm, ...defaults, ...existing };
    }
    const firstValid = sortedCategories.find(c => c.id !== 'all' && c.published !== false);
    return { ...blankForm, category: firstValid?.id || '' };
  });
  const [showToken, setShowToken] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [advFieldIdx, setAdvFieldIdx] = useState(-1);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [toast, setToast] = useState('');
  // 拖拽排序状态（输入/输出字段各自独立）
  const [formDrag, setFormDrag] = useState({ from: -1, over: -1 });
  const [outDrag, setOutDrag] = useState({ from: -1, over: -1 });
  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));
  const setField = (patch) => setForm(prev => ({ ...prev, ...patch }));
  const setResultKind = (v) => set({ resultKind: v });
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  // 调试面板用一份独立 draft 状态（不影响主表单值）
  const [debugForm, setDebugForm] = useState({});

  // addWorkflow / updateWorkflow 已改为 async + persistKey（显式写回服务端），
  // 这里必须 await，否则拿到的会是 Promise 而非真实 id。
  const persist = async () => {
    if (!form.name.trim()) { window.alert('请先填写名称'); return null; }
    if (isNew) { const nid = await addWorkflow(form); return nid; }
    const ok = await updateWorkflow(id, form);
    return ok ? id : null;
  };
  const onSave = async () => { const nid = await persist(); if (nid !== null) navigate('/admin/agents'); };
  const onPreview = async () => { const nid = await persist(); if (nid) window.open(`/workflow/${nid}`, '_blank'); };

  const addTag = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      set({ tags: [...form.tags, e.target.value.trim()] });
      e.target.value = '';
    }
  };

  const addFormField = () => set({ formFields: [...form.formFields, { key: `field_${form.formFields.length + 1}`, label: `字段${form.formFields.length + 1}`, type: 'string', style: 'input', required: false, enabled: true, default: '', hint: '' }] });
  const updateFormField = (i, v) => set({ formFields: form.formFields.map((f, idx) => idx === i ? { ...f, ...v } : f) });
  const removeFormField = (i) => set({ formFields: form.formFields.filter((_, idx) => idx !== i) });

  const addOutputField = () => set({ outputFields: [...form.outputFields, { key: `out_${form.outputFields.length + 1}`, name: `输出${form.outputFields.length + 1}`, type: 'string', tag: '', show: true, enabled: true }] });
  const updateOutputField = (i, v) => set({ outputFields: form.outputFields.map((f, idx) => idx === i ? { ...f, ...v } : f) });
  const removeOutputField = (i) => set({ outputFields: form.outputFields.filter((_, idx) => idx !== i) });

  // 拖拽重排：把 from 位置的元素移动到 to 位置（单点 splice，不重写整列语义）
  const moveItemInArray = (arr, from, to) => {
    if (from < 0 || to < 0 || from === to || from >= arr.length || to >= arr.length) return arr;
    const next = arr.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    return next;
  };
  const moveFormField = (from, to) => set({ formFields: moveItemInArray(form.formFields, from, to) });
  const moveOutputField = (from, to) => set({ outputFields: moveItemInArray(form.outputFields, from, to) });

  // 授权凭证变化时，自动带出 providerId / baseUrl / authType（保存在工作流上）
  const onAuthChange = (providerId) => {
    const p = authProviders.find(x => x.id === providerId);
    if (p) {
      set({ authProviderId: p.id, baseUrl: p.baseUrl, authType: p.type === 'oauth' ? 'oauth' : 'pat' });
    } else {
      set({ authProviderId: '', baseUrl: '', authType: 'pat' });
    }
  };

  // 智能获取：按当前 workflowId 和授权凭证拉取工作流信息并自动填充字段
  const smartFetch = async (forcedWorkflowId) => {
    const wfId = forcedWorkflowId || form.workflowId;
    if (!wfId) { showToast('请先填写工作流 ID / Key'); return; }
    const auth = authProviders.find(p => p.id === form.authProviderId);
    if (!auth) { showToast('请先选择「授权凭证」'); return; }
    setFetching(true);
    setFetchResult(null);
    try {
      const cfg = {
        baseUrl: auth.baseUrl,
        authType: auth.type === 'oauth' ? 'oauth' : 'pat',
        workflowId: wfId,
      };
      if (auth.type === 'oauth') {
        cfg.clientId = auth.clientId;
        cfg.keyId = auth.keyId;
        cfg.privateKey = auth.privateKey;
      } else {
        cfg.apiKey = auth.apiKey;
      }
      const r = await getCozeWorkflowInfo(cfg);
      if (!r.ok) {
        setFetchResult({ ok: false, msg: r.error || '获取失败' });
        showToast('获取失败');
        return;
      }
      const inferStyle = (p) => {
        const t = (p.type || 'string').toLowerCase().trim();
        const itemType = (p.items && (p.items.type || p.items.data_type) || '').toLowerCase();
        // 扣子可能返回 array<Image> / array<File> 这种复合类型字符串，也要识别为文件上传
        if (t === 'image' || t === 'file') return 'file';
        if (t.startsWith('array<') && (t.includes('image') || t.includes('file'))) return 'file';
        if (t === 'array' && (itemType === 'image' || itemType === 'file')) return 'file';
        if (t === 'textarea' || t === 'text') return 'textarea';
        if (t === 'boolean') return 'boolean';
        if (t === 'number' || t === 'integer') return 'number';
        return 'input';
      };
      const inputs = (r.inputs || []).map(p => ({
        key: p.key,
        label: p.name || p.key,
        type: (p.type || 'string').toLowerCase(),
        style: inferStyle(p),
        required: !!p.required,
        enabled: true,
        default: p.defaultValue || '',
        hint: p.description || '',
        items: p.items || null,
      }));
      const outputs = (r.outputs || []).map(p => ({
        key: p.key,
        name: p.name || p.key,
        type: (p.type || 'string').toLowerCase(),
        tag: inferOutputTag(p),
        show: true,
        enabled: true,
        items: p.items || null,
      }));
      set({
        workflowName: r.workflow?.workflow_name || form.workflowName,
        formFields: inputs,
        outputFields: outputs,
      });
      setFetchResult({ ok: true, msg: `已导入 ${inputs.length} 个输入字段、${outputs.length} 个输出字段` });
      showToast('已自动填充字段');
    } catch (e) {
      setFetchResult({ ok: false, msg: String(e.message || e) });
    } finally {
      setFetching(false);
    }
  };

  // 列表选择后：填入工作流 ID、名称、空间 ID，并自动执行智能获取
  const onPickWorkflow = (wf) => {
    set({ workflowId: wf.workflow_id, workflowName: wf.workflow_name, workspaceId: wf.workspace_id || '' });
    setPickerOpen(false);
    setTimeout(() => smartFetch(wf.workflow_id), 50);
  };

  const catName = (cid) => sortedCategories.find(c => c.id === cid)?.name || '未分类';
  const validCategoryIds = new Set(sortedCategories.filter(c => c.id !== 'all').map(c => c.id));
  const categoryInvalid = form.category && !validCategoryIds.has(form.category);

  const auth = authProviders.find(p => p.id === form.authProviderId);
  const authTypeLabel = auth ? (auth.type === 'oauth' ? 'OAuth' : auth.type === 'pat' ? 'PAT' : 'API Token') : '未选择';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/admin/agents')} className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate">{isNew ? '新建工作流' : form.name || '编辑工作流'}</h1>
            <p className="text-xs text-slate-400">平台：扣子工作流（{authTypeLabel}） · 工作流 ID：{form.workflowId || '未设置'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPreview} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white text-slate-700 text-sm font-medium border border-slate-200 hover:bg-slate-50"><Eye size={15} /> 预览前台</button>
          <button onClick={onSave} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700"><Save size={15} /> 保存</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_320px] gap-5 items-start">
        {/* 左：基础信息 */}
        <Card className="p-5 space-y-5">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Sparkles size={16} className="text-blue-600" /> 基础信息</h2>
          <Field label="头像 / 图标">
            <AdminIconPicker icon={form.icon} avatar={form.avatar} onIconChange={v => set({ icon: v })} onAvatarChange={v => set({ avatar: v })} color={form.iconColor} />
          </Field>
          <Field label="名称" required>
            <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="如：小红书爆款笔记" className={inputCls} />
          </Field>
          <Field label="所属分类" required>
            <select value={form.category} onChange={e => set({ category: e.target.value })} className={inputCls}>
              <option value="" disabled>请选择分类</option>
              {categoryInvalid && <option value={form.category} disabled>{form.category}（未匹配，请选择有效分类）</option>}
              {sortedCategories.filter(c => c.id !== 'all').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="简介">
            <textarea value={form.desc} onChange={e => set({ desc: e.target.value })} rows={3} placeholder="工作流能帮用户完成什么？" className={`${inputCls} resize-none`} />
          </Field>
          <Field label="标签" hint="回车添加">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs">
                  {t} <button onClick={() => set({ tags: form.tags.filter(x => x !== t) })}><X size={12} /></button>
                </span>
              ))}
            </div>
            <input onKeyDown={addTag} placeholder="输入标签后回车" className={inputCls} />
          </Field>
          <Field label="图标颜色">
            <div className="flex gap-2 flex-wrap">
              {COLOR_OPTIONS.map(c => (
                <button type="button" key={c} onClick={() => set({ iconColor: c })}
                  className={`w-7 h-7 rounded-full ${c} ${form.iconColor === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`} />
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="渐变起始色"><div className="flex items-center gap-2"><input type="color" value={form.gradientFrom} onChange={e => set({ gradientFrom: e.target.value })} className="w-10 h-9 p-0 border border-slate-200 rounded-lg cursor-pointer" /><input value={form.gradientFrom} onChange={e => set({ gradientFrom: e.target.value })} className={inputCls} /></div></Field>
            <Field label="渐变结束色"><div className="flex items-center gap-2"><input type="color" value={form.gradientTo} onChange={e => set({ gradientTo: e.target.value })} className="w-10 h-9 p-0 border border-slate-200 rounded-lg cursor-pointer" /><input value={form.gradientTo} onChange={e => set({ gradientTo: e.target.value })} className={inputCls} /></div></Field>
          </div>
          <Field label="渐变角度" hint="0–360°">
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="360" value={form.gradientAngle} onChange={e => set({ gradientAngle: Number(e.target.value) })} className="flex-1 accent-blue-600" />
              <input type="number" min="0" max="360" value={form.gradientAngle} onChange={e => set({ gradientAngle: Math.max(0, Math.min(360, Number(e.target.value) || 0)) })} className={`${inputCls} w-16 text-center`} />
              <span className="text-slate-400 text-xs">°</span>
            </div>
            <div className="h-12 rounded-lg border border-slate-200 mt-2" style={{ background: `linear-gradient(${Number(form.gradientAngle) || 30}deg, ${form.gradientFrom}, ${form.gradientTo})` }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="排序"><input type="number" value={form.sortOrder} onChange={e => set({ sortOrder: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="算力点/次"><input type="number" value={form.priceRate} onChange={e => set({ priceRate: Number(e.target.value) })} className={inputCls} /></Field>
          </div>
          <label className="flex items-center justify-between pt-1"><span className="text-sm font-medium text-slate-700">立即上架</span>
            <button type="button" onClick={() => set({ published: !form.published })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.published ? 'bg-blue-600' : 'bg-slate-200'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.published ? 'translate-x-4' : 'translate-x-0.5'}`} /></button>
          </label>
          <label className="flex items-center justify-between pt-1"><span className="text-sm font-medium text-slate-700">VIP 专享</span>
            <button type="button" onClick={() => set({ vip: !form.vip })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.vip ? 'bg-amber-500' : 'bg-slate-200'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.vip ? 'translate-x-4' : 'translate-x-0.5'}`} /></button>
          </label>
        </Card>

        {/* 中：平台 + 授权 + 字段配置 */}
        <div className="space-y-5">
          {/* 平台 + 授权 + 工作流ID */}
          <Card className="p-5 space-y-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2"><KeyRound size={16} className="text-blue-600" /> 工作流平台与连接</h2>

            {/* 平台选择 */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">选择平台 <span className="text-rose-500">*</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {PLATFORMS.map(p => (
                  <button key={p.value} type="button" onClick={() => p.value === 'coze-old' && set({ platform: p.value })}
                    disabled={p.value !== 'coze-old'}
                    title={p.value === 'coze-old' ? '' : '即将支持'}
                    className={`relative px-3 py-2.5 rounded-lg text-sm border transition ${form.platform === p.value ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-slate-200 text-slate-600'} ${p.value !== 'coze-old' ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}>
                    <div>{p.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">{p.note}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label="选择授权凭证" required hint="先到「授权中心」完成扣子 OAuth 授权">
                <select value={form.authProviderId} onChange={e => onAuthChange(e.target.value)} className={inputCls}>
                  <option value="">请选择授权凭证</option>
                  {authProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {authProviders.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">还没有授权凭证，请先到「授权中心」添加</p>
                )}
              </Field>
            </div>

            <Field label="工作流 ID / Key" required hint="通过添加平台所有应用 ID 访问 API 权限后获取">
              <div className="flex gap-2">
                <input value={form.workflowId} onChange={e => set({ workflowId: e.target.value })} placeholder="7634474639327379506" className={`${inputCls} flex-1 font-mono`} />
                <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-300 bg-blue-50 text-blue-600 text-sm font-medium hover:bg-blue-100 shrink-0">
                  <List size={14} /> 列表选择
                </button>
                <button type="button" onClick={smartFetch} disabled={fetching} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 disabled:opacity-60 shrink-0">
                  {fetching ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  智能获取
                </button>
              </div>
            </Field>

            {form.workflowName && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-sm">
                <CheckCircle2 size={14} className="text-emerald-600" />
                <span className="text-slate-700">获取结果：</span>
                <span className="font-semibold text-slate-900">{form.workflowName}</span>
                <span className="text-xs text-slate-400 ml-auto">v1.0</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">已绑定</span>
              </div>
            )}
            {fetchResult && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${fetchResult.ok ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700'}`}>
                {fetchResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {fetchResult.msg}
              </div>
            )}
          </Card>

          {/* 输入字段配置 */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><FormInput size={16} className="text-blue-600" /> 输入字段配置 <span className="text-xs text-slate-400 font-normal">{form.formFields.length}</span></h2>
              <button onClick={addFormField} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"><Plus size={14} /> 添加参数</button>
            </div>
            {form.formFields.length === 0 ? (
              <div className="text-center text-sm text-slate-400 py-6 border border-dashed border-slate-200 rounded-xl">还没有输入字段，点击右上角「添加参数」或先在「工作流 ID」处点「智能获取」</div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2 text-left w-8"></th>
                      <th className="px-2 py-2 text-left font-medium">显示名称</th>
                      <th className="px-2 py-2 text-left font-medium">参数名</th>
                      <th className="px-2 py-2 text-left font-medium">类型</th>
                      <th className="px-2 py-2 text-left font-medium">默认值</th>
                      <th className="px-2 py-2 text-left font-medium">样式</th>
                      <th className="px-2 py-2 text-center font-medium">必填</th>
                      <th className="px-2 py-2 text-left font-medium">提示</th>
                      <th className="px-2 py-2 text-center font-medium">启用</th>
                      <th className="px-2 py-2 text-center font-medium">高级</th>
                      <th className="px-2 py-2 text-center font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.formFields.map((f, i) => (
                      <FieldEditor key={i} f={f} onChange={v => updateFormField(i, v)} onRemove={() => removeFormField(i)}
                        onAdvanced={() => setAdvFieldIdx(i)}
                        isDragOver={formDrag.over === i && formDrag.from !== i}
                        dragHandlers={{
                          onDragStart: (e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(i));
                            setFormDrag({ from: i, over: i });
                          },
                          onDragOver: (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (formDrag.over !== i) setFormDrag(d => ({ ...d, over: i }));
                          },
                          onDrop: (e) => {
                            e.preventDefault();
                            const from = Number(e.dataTransfer.getData('text/plain'));
                            setFormDrag({ from: -1, over: -1 });
                            moveFormField(from, i);
                          },
                          onDragEnd: () => setFormDrag({ from: -1, over: -1 }),
                        }} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 输出字段配置 */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Settings2 size={16} className="text-blue-600" /> 输出字段配置 <span className="text-xs text-slate-400 font-normal">{form.outputFields.length}</span></h2>
              <div className="flex items-center gap-2">
                <select value={form.outputFields.length} onChange={e => {
                  const n = Number(e.target.value);
                  if (n < form.outputFields.length) set({ outputFields: form.outputFields.slice(0, n) });
                  else {
                    const add = Array.from({ length: n - form.outputFields.length }, (_, k) => ({
                      key: `out_${form.outputFields.length + k + 1}`,
                      name: `输出${form.outputFields.length + k + 1}`,
                      type: 'string',
                      tag: '',
                      show: true,
                      enabled: true,
                    }));
                    set({ outputFields: [...form.outputFields, ...add] });
                  }
                }} className={`${inputCls} w-32 text-xs`}>
                  {[0, 1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>保存类型 {n} 条</option>)}
                </select>
                <button onClick={addOutputField} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"><Plus size={14} /> 添加参数</button>
              </div>
            </div>
            {form.outputFields.length === 0 ? (
              <div className="text-center text-sm text-slate-400 py-6 border border-dashed border-slate-200 rounded-xl">智能获取后会自动填充</div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium w-8"></th>
                      <th className="px-2 py-2 text-left font-medium">显示名称</th>
                      <th className="px-2 py-2 text-left font-medium">参数名</th>
                      <th className="px-2 py-2 text-left font-medium">类型</th>
                      <th className="px-2 py-2 text-left font-medium">标记</th>
                      <th className="px-2 py-2 text-left font-medium">显示字段</th>
                      <th className="px-2 py-2 text-center font-medium">启用</th>
                      <th className="px-2 py-2 text-center font-medium w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.outputFields.map((f, i) => (
                      <tr key={i}
                        className={`border-b border-slate-100 hover:bg-slate-50/50 ${outDrag.over === i && outDrag.from !== i ? 'bg-blue-50' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (outDrag.over !== i) setOutDrag(d => ({ ...d, over: i })); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = Number(e.dataTransfer.getData('text/plain'));
                          setOutDrag({ from: -1, over: -1 });
                          moveOutputField(from, i);
                        }}
                        onDragEnd={() => setOutDrag({ from: -1, over: -1 })}
                      >
                        <td
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(i));
                            setOutDrag({ from: i, over: i });
                          }}
                          className="px-2 py-2 align-top w-8 cursor-grab active:cursor-grabbing"
                        ><GripVertical size={14} className="text-slate-300" /></td>
                        <td className="px-2 py-2 align-top"><input value={f.name || ''} onChange={e => updateOutputField(i, { name: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs" /></td>
                        <td className="px-2 py-2 align-top"><input value={f.key || ''} onChange={e => updateOutputField(i, { key: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono" /></td>
                        <td className="px-2 py-2 align-top">
                          <select value={f.type || 'string'} onChange={e => updateOutputField(i, { type: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs">
                            {COZE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <select value={f.tag || ''} onChange={e => updateOutputField(i, { tag: e.target.value })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs">
                            {OUTPUT_TAG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <select value={f.show === false ? 'hidden' : 'visible'} onChange={e => updateOutputField(i, { show: e.target.value === 'visible' })} className="w-full px-2 py-1 border border-slate-200 rounded text-xs">
                            <option value="visible">显示</option>
                            <option value="hidden">隐藏</option>
                          </select>
                        </td>
                        <td className="px-2 py-2 align-top text-center"><Toggle checked={f.enabled !== false} onChange={v => updateOutputField(i, { enabled: v })} /></td>
                        <td className="px-2 py-2 align-top text-center"><button type="button" onClick={() => removeOutputField(i)} className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* 右：调试与运行 */}
        <DebugPanel form={form} setForm={setField} authProviders={authProviders} resultKind={form.resultKind} setResultKind={setResultKind} />
      </div>

      {/* 弹窗：选择工作流 */}
      <WorkflowListPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        auth={form.authProviderId ? authProviders.find(p => p.id === form.authProviderId) : null}
        onPick={onPickWorkflow}
      />

      {/* 弹窗：字段高级配置 */}
      {advFieldIdx >= 0 && (
        <AdvancedFieldEditor
          open
          onClose={() => setAdvFieldIdx(-1)}
          value={{ key: form.formFields[advFieldIdx]?.key, label: form.formFields[advFieldIdx]?.label, ...form.formFields[advFieldIdx]?.advanced }}
          onChange={(v) => updateFormField(advFieldIdx, { ...form.formFields[advFieldIdx], advanced: v })}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm shadow-lg">{toast}</div>
      )}
    </div>
  );
}
