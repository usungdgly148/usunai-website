import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowUp, Check, ChevronDown, Crop, Download, FolderPlus,
  ImagePlus, Loader2, Monitor, Sparkles, Wand2, X, ZoomIn,
} from 'lucide-react';
import { useStore } from '../store.jsx';
import { apiFetch } from '../authFetch.js';
import RefImagePicker, { MAX_REF_IMAGES, toApiImages } from '../RefImagePicker.jsx';
import InspirationPlaza from '../InspirationPlaza.jsx';
import { useInspirationCategories } from '../useInspirationCategories.js';

// 比例**文案**表。可用哪些比例由服务端按模型下发（`models[].aspectRatios`），
// 前端不再自己维护一份「有哪些比例」的清单 —— 那是历史上三份副本不同步的根源。
// 新增比例只需在这里补一行中文；没写到的会用比值兜底，不会崩。
const ASPECT_LABELS = {
  '1:1': { label: '方形', hint: '1:1' },
  '16:9': { label: '横版', hint: '16:9' },
  '9:16': { label: '竖版', hint: '9:16' },
  '4:3': { label: '横版', hint: '4:3' },
  '3:4': { label: '竖版', hint: '3:4' },
  '2:3': { label: '竖版', hint: '2:3' },
  '3:2': { label: '横版', hint: '3:2' },
  '21:9': { label: '超宽', hint: '21:9' },
  '1:4': { label: '超长竖', hint: '1:4' },
  '4:1': { label: '超长横', hint: '4:1' },
};
const aspectLabel = (value) => ASPECT_LABELS[value] || { label: '自定义', hint: value };

// 输入框高度自适应：内容多高就多高，但**不低于 4 行、最多 8 行**（超过就内部滚动）。
// 下限 4 行是主人 2026-10-28 定的：空输入时留一块能一眼看出"这里可以写很多"的空白，
// 只有 1 行会显得这张卡太扁、也太像普通搜索框。
// 为什么用 JS 量而不是 CSS：`field-sizing: content` 只有 Chrome 123+ 支持，
// 而这是主打页面，不能赌浏览器。行高与上下 padding 都从 computedStyle 现算，
// 改字号/内边距时这里不用跟着改数字。
const MIN_PROMPT_ROWS = 4;
const MAX_PROMPT_ROWS = 8;
// 可选模型 / 分辨率 / 点数 / 比例全部由服务端下发（后台改 KV 即生效），前端不硬编码任何点数。

/**
 * 底部工具条上的胶囊按钮。有 children 时是下拉菜单，没有就是普通按钮。
 * 抽出来的原因：工具条上有 4 个长得一样的胶囊，各写一遍会出现「间距/圆角/字号」不一致。
 */
function Pill({ icon: Icon, label, hint, onClick, active = false, disabled = false, menu = null }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const base = `ig-chip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${active
    ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`;

  if (!menu) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={base}>
        {Icon && <Icon size={14} className="shrink-0" />}
        <span className="max-w-[8rem] truncate">{label}</span>
      </button>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        className={base}
      >
        {Icon && <Icon size={14} className="shrink-0" />}
        <span className="max-w-[8rem] truncate">{label}</span>
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 min-w-[12.5rem] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {menu({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

/** 下拉里的一行。 */
function MenuItem({ selected, title, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition ${selected
        ? 'bg-brand-50 font-medium text-brand-700'
        : 'text-slate-600 hover:bg-slate-50'}`}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {hint && <span className="shrink-0 text-[11px] text-slate-400">{hint}</span>}
      {selected && <Check size={13} className="shrink-0" />}
    </button>
  );
}

export default function ImageGen() {
  const { user, openRechargeModal, refreshCurrentUserCompute, addAsset } = useStore();
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [refs, setRefs] = useState([]);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  // 顶层比例列表：只在服务端没给 models[].aspectRatios 时兜底（老服务端 / 字段缺失）
  const [fallbackRatios, setFallbackRatios] = useState([]);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // 「加入资产库」的按钮状态：idle 未加入 / added 已加入（防重复点）
  const [assetState, setAssetState] = useState('idle');
  // 参考图区默认收起：参考图是"可选"，常驻展开会让输入区变高、把工具条挤下去
  const [refsOpen, setRefsOpen] = useState(false);
  // 结果图预览（灯箱）：只在生成成功后才可能为 true
  const [previewOpen, setPreviewOpen] = useState(false);
  const thumbRef = useRef(null);

  // 灵感广场相关
  const [plazaToken, setPlazaToken] = useState(0);   // 发布成功后 +1，让瀑布流重新拉第一页
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishCategory, setPublishCategory] = useState('poster');
  const [publishState, setPublishState] = useState('idle'); // idle | saving | done
  const promptRef = useRef(null);
  const resultRef = useRef(null);
  // 分类清单以服务端为准（后台「灵感广场」可增删改序），与广场 chips 共用同一次请求
  const { publishable, labelOf } = useInspirationCategories();

  // 模型/分辨率/点数都由服务端下发，避免前端硬编码与服务端脱节（后台改 KV 后刷新即生效）
  useEffect(() => {
    let alive = true;
    apiFetch('/api/image-gen/config')
      .then((res) => res.json())
      .then((data) => {
        if (!alive || !data || !data.ok) return;
        const list = Array.isArray(data.models) ? data.models : [];
        setModels(list);
        const topRatios = Array.isArray(data.aspectRatios) ? data.aspectRatios : [];
        setFallbackRatios(topRatios);
        const pickedModel = list.find((item) => item.id === data.defaultModel) || list[0];
        if (pickedModel) {
          setModel(pickedModel.id);
          const wanted = (pickedModel.resolutions || []).find((item) => item.value === data.defaultResolution);
          setResolution((wanted || (pickedModel.resolutions || [])[0] || {}).value || '');
          // 初始比例也要落在该模型支持范围内：后台配的默认比例可能是另一个模型才有的值
          const ratios = (Array.isArray(pickedModel.aspectRatios) && pickedModel.aspectRatios.length)
            ? pickedModel.aspectRatios
            : topRatios;
          if (ratios.length) setAspect((prev) => (ratios.includes(prev) ? prev : ratios[0]));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // 当前模型的可用档位（每个档位自带点数，直接标在按钮上）
  const currentModel = models.find((item) => item.id === model) || models[0] || null;
  const resolutions = (currentModel && currentModel.resolutions) || [];
  // 参考图能力由服务端下发（两套通道都支持，只是上传/转发方式不同）
  const refsSupported = !currentModel || currentModel.supportsRefs !== false;

  // 当前模型实际可用的比例：优先 models[].aspectRatios，其次顶层字段，最后用文案表的键兜底。
  // 三者顺序不能反 —— 顶层是「默认模型」的列表，拿它渲染 gpt-image 会多出它不支持的比例。
  const ratioValues = (currentModel && Array.isArray(currentModel.aspectRatios) && currentModel.aspectRatios.length)
    ? currentModel.aspectRatios
    : (fallbackRatios.length ? fallbackRatios : Object.keys(ASPECT_LABELS));
  const aspects = ratioValues.map((value) => ({ value, ...aspectLabel(value) }));

  // 换模型时，若当前分辨率/比例不被支持就自动落到该模型的第一项
  const pickModel = (nextModelId) => {
    const entry = models.find((item) => item.id === nextModelId);
    setModel(nextModelId);
    const options = (entry && entry.resolutions) || [];
    if (!options.some((item) => item.value === resolution)) {
      setResolution((options[0] || {}).value || '');
    }
    // 比例同理：gpt-image 系只有 5 个，从 21:9 切过去必须收敛，
    // 否则用户以为还是 21:9，服务端却回落到方图（点了生成才发现）
    const nextRatios = (entry && Array.isArray(entry.aspectRatios)) ? entry.aspectRatios : [];
    if (nextRatios.length && !nextRatios.includes(aspect)) {
      setAspect(nextRatios[0]);
    }
    // 新模型不吃参考图就把已选的图清掉，避免「传了图却没生效」还照样扣点
    if (entry && entry.supportsRefs === false) { setRefs([]); setRefsOpen(false); }
  };

  // 单张实测 20~23 秒，没有进度可拿，显示已等待秒数避免用户以为卡死
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // 输入框高度跟随内容，下限 4 行、封顶 8 行（MIN/MAX_PROMPT_ROWS）。
  //
  // 三个细节，都是踩过才知道的：
  //  1. 必须先把 height 置 auto 再读 scrollHeight —— 否则读到的是上一次的固定高度，只涨不落。
  //  2. 行高/padding 从 computedStyle 取，不写死 28px：以后改 leading-7 不用回来改代码。
  //  3. 窗口尺寸变化会改变换行数，必须重算，否则横竖屏切换后高度会错。
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return undefined;
    const sync = () => {
      const style = window.getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || 28;
      const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const minHeight = lineHeight * MIN_PROMPT_ROWS + paddingY;
      const maxHeight = lineHeight * MAX_PROMPT_ROWS + paddingY;
      el.style.height = 'auto';
      const contentHeight = el.scrollHeight || minHeight;
      el.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
      // 只有真的超过 8 行才允许内部滚动；否则鼠标滚到输入框会「卡住」页面滚动
      el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [prompt]);

  // 后台把当前选中的分类删了/停用了 → 落到第一个可选分类，避免发布时后端回落得莫名其妙
  useEffect(() => {
    if (!publishable.length) return;
    if (!publishable.some((item) => item.id === publishCategory)) setPublishCategory(publishable[0].id);
  }, [publishable, publishCategory]);

  // 大图预览：锁滚动 + Esc 关闭 + 关闭后把焦点还给缩略图。
  //
  // ⚠️ 锁滚动必须**补偿滚动条宽度**，否则桌面端一锁，`overflow:hidden` 让滚动条消失、
  //    整页内容右移 15px —— 这就是用户能感觉到的"布局跳动"。
  // ⚠️ 焦点用 `preventScroll: true` 还回去，否则浏览器会为了露出缩略图再滚一次。
  useEffect(() => {
    if (!previewOpen) return undefined;
    const { body } = document;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    const onKey = (event) => { if (event.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      const thumb = thumbRef.current;
      if (thumb && typeof thumb.focus === 'function') thumb.focus({ preventScroll: true });
    };
  }, [previewOpen]);

  const currentResolution = resolutions.find((item) => item.value === resolution) || null;
  const aspectText = (() => {
    const item = aspects.find((one) => one.value === aspect);
    return item ? `${item.hint} ${item.label}` : aspect;
  })();
  const canSubmit = Boolean(prompt.trim()) && !busy && Boolean(user);

  const generate = async () => {
    const text = prompt.trim();
    if (!text) { setError('请先描述你想要的画面'); promptRef.current?.focus(); return; }
    setBusy(true);
    setError('');
    setResult(null);
    setPreviewOpen(false);   // 重新生成时先收起大图，否则灯箱里会挂着上一张
    setAssetState('idle');
    setPublishOpen(false);
    setPublishState('idle');
    try {
      const res = await apiFetch('/api/image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          aspectRatio: aspect,
          model,
          resolution,
          images: toApiImages(refs),
          requestId: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch { data = {}; }

      // 401：登录态失效，apiFetch 已清 token，交给上层跳登录（这里只给一句人话）
      if (res.status === 401) { setError('登录已失效，请重新登录后再试'); return; }

      // 402 / POINTS_INSUFFICIENT：服务端连上游都没调，直接引导充值
      if (res.status === 402 || data.code === 'POINTS_INSUFFICIENT') {
        setError('算力不足，本次未生成，也没有扣除任何算力。');
        openRechargeModal?.();
        return;
      }

      if (!res.ok || !data.ok) throw new Error(data.error || `生成失败（HTTP ${res.status}）`);
      setResult(data);
      // 扣点后立刻刷新余额，避免页面还显示旧数字
      refreshCurrentUserCompute?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 加入资产库：写入「图片」库（type='image'），与对话/工作流的资产同构（见 store.addAsset）。
  const addToAssets = () => {
    if (!result || assetState !== 'idle') return;
    const text = String(result.prompt || prompt || '').trim();
    const shortName = text ? (text.length > 24 ? `${text.slice(0, 24)}…` : text) : 'AI全能设计 · 图片';
    try {
      addAsset({
        sourceType: 'imageGen',
        sourceId: String(result.model || model || ''),
        sourceName: 'AI全能设计',
        type: 'image',
        name: shortName,
        // 提示词一并存下来，方便在资产库里复制复用
        content: text,
        images: [result.url],
        videos: [],
        audios: [],
      });
      setAssetState('added');
    } catch (e) {
      setAssetState('idle');
      setError(`加入资产库失败：${String(e.message || e)}`);
    }
  };

  const openPublish = () => {
    setPublishState('idle');
    setPublishOpen(true);
  };

  const publishToPlaza = async () => {
    if (!result || publishState === 'saving') return;
    setPublishState('saving');
    try {
      const res = await apiFetch('/api/inspiration/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: result.url,
          prompt: String(result.prompt || prompt || '').trim(),
          category: publishCategory,
          model: result.model || model,
          aspectRatio: result.aspectRatio || aspect,
          resolution: result.resolution || resolution,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('登录已失效，请重新登录后再发布');
      if (!res.ok || !data.ok) throw new Error(data.error || '发布失败，请稍后重试');
      setPublishState('done');
      setPlazaToken((value) => value + 1);
      // 让用户看到"发成功了"，再收起来（直接关掉会像没反应）
      setTimeout(() => setPublishOpen(false), 800);
    } catch (e) {
      setPublishState('idle');
      setError(String(e.message || e));
    }
  };

  // 「做同款」：把提示词回填到顶部输入框
  const applyPrompt = (text) => {
    setPrompt(String(text || '').slice(0, 2000));
    promptRef.current?.focus();
  };

  // 出图后把结果卡滚进视野：图高 + 输入卡已经把操作按钮推到折叠线以下，
  // 不滚一下用户会以为"生成完就没了"，还得自己找按钮。
  useEffect(() => {
    if (!result || !resultRef.current) return;
    resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [result]);

  return (
    <div className="mx-auto w-full max-w-6xl px-1">
      {/* ===== 标题 ===== */}
      <div className="pb-6 pt-4 text-center sm:pt-8">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[38px]">
          你的设计 <span className="text-brand-600">Agent</span>，开始创作
        </h1>
      </div>

      {!user && (
        <div className="mx-auto mb-4 max-w-5xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          请先 <Link to="/profile" className="font-medium underline">登录</Link> 后再使用。
        </div>
      )}

      {/* ===== 输入卡 ===== */}
      <div className="ig-card mx-auto max-w-5xl rounded-[26px] border border-slate-200 bg-white">
        <textarea
          ref={promptRef}
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          onKeyDown={(e) => {
            // Ctrl/Cmd + Enter 直接生成：这页的输入框很长，手不用离开键盘
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit) generate();
          }}
          placeholder="输入灵感、需求或你想完成的创作任务"
          className="w-full resize-none rounded-t-[26px] bg-transparent px-5 pb-1 pt-5 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400"
        />
        <div className="flex items-center justify-between px-5 pb-2 text-[11px] text-slate-300">
          <span>{prompt.length > 0 ? `${prompt.length}/2000` : ''}</span>
          <span className="hidden sm:inline">Ctrl / ⌘ + Enter 生成</span>
        </div>

        {/* 参考图展开区 */}
        {refsOpen && refsSupported && (
          <div className="mx-4 mb-2 rounded-2xl bg-slate-50/90 p-3">
            <RefImagePicker value={refs} onChange={setRefs} disabled={busy} showHint={false} />
          </div>
        )}

        {/* 工具条：左侧参数胶囊、右侧生成按钮，**永远同一行**。
            旧写法是 flex-wrap + ml-auto：胶囊把整行占满时按钮会被折到下一行，
            看起来像"生成按钮在参数下面"。现在右栏 shrink-0 单独成列，
            窄屏只会让左边胶囊自己换行，按钮不会再掉下去。 */}
        <div className="flex items-end gap-3 px-4 pb-4 pt-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Pill
              icon={Sparkles}
              label={currentModel ? (currentModel.label || currentModel.id) : '模型'}
              disabled={busy || models.length <= 1}
              menu={models.length > 1 ? ({ close }) => models.map((item) => (
                <MenuItem
                  key={item.id}
                  selected={item.id === model}
                  title={item.label || item.id}
                  hint={(item.resolutions || []).length ? `${(item.resolutions || []).length} 档` : ''}
                  onClick={() => { pickModel(item.id); close(); }}
                />
              )) : null}
            />
            <Pill
              icon={Monitor}
              label={currentResolution ? `${currentResolution.value} · ${currentResolution.points} 点` : (resolution || '清晰度')}
              disabled={busy || resolutions.length <= 1}
              menu={resolutions.length > 1 ? ({ close }) => resolutions.map((item) => (
                <MenuItem
                  key={item.value}
                  selected={item.value === resolution}
                  title={item.value}
                  hint={`${item.points} 点`}
                  onClick={() => { setResolution(item.value); close(); }}
                />
              )) : null}
            />
            <Pill
              icon={Crop}
              label={aspectText}
              disabled={busy || aspects.length <= 1}
              menu={aspects.length > 1 ? ({ close }) => aspects.map((item) => (
                <MenuItem
                  key={item.value}
                  selected={item.value === aspect}
                  title={`${item.hint} ${item.label}`}
                  onClick={() => { setAspect(item.value); close(); }}
                />
              )) : null}
            />
            <Pill
              icon={ImagePlus}
              label={refs.length ? `参考图 ${refs.length}/${MAX_REF_IMAGES}` : '参考图'}
              active={refsOpen || refs.length > 0}
              disabled={busy || !refsSupported}
              onClick={() => setRefsOpen((value) => !value)}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {busy && <span className="text-[11px] text-slate-400">已等待 {elapsed}s</span>}
            <button
              type="button"
              onClick={generate}
              disabled={!canSubmit}
              title={user ? (prompt.trim() ? '开始生成' : '请先描述画面') : '请先登录'}
              className={`ig-cta flex h-10 w-10 items-center justify-center rounded-full transition ${canSubmit
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'bg-slate-100 text-slate-400'}`}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mx-auto mt-3 flex max-w-5xl items-start gap-1.5 text-sm text-rose-600">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* ===== 结果 ===== */}
      {(busy || result) && (
        <div ref={resultRef} className="ig-card mx-auto mt-6 max-w-5xl rounded-2xl border border-slate-200 bg-white p-4">
          {busy && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
              <Wand2 size={32} className="animate-pulse" />
              <p className="text-sm">
                {refs.length ? `正在生成，带 ${refs.length} 张参考图通常需要 30~45 秒…` : '正在生成，通常 20 秒左右…'}
              </p>
            </div>
          )}

          {!busy && result && (
            <div className="space-y-3">
              {/* 缩略图即预览入口：桌面悬停浮出「查看大图」，移动端右上角常驻放大镜（触屏没有 hover）。
                  用 <button> 而不是给 <img> 挂 onClick —— 键盘 Tab 可聚焦、回读屏有语义。
                  ⚠️ 不挂 transform 动效：任何缩放都会让图片重采样、看着变软。 */}
              <button
                type="button"
                ref={thumbRef}
                onClick={() => setPreviewOpen(true)}
                aria-label="查看大图"
                title="查看大图"
                className="group relative mx-auto block max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <img
                  src={result.url}
                  alt={result.prompt || '生成结果'}
                  decoding="async"
                  draggable={false}
                  className="ig-result-img mx-auto block max-h-[60vh] w-auto max-w-full"
                />
                {/* 桌面：悬停变暗 + 居中胶囊提示 */}
                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-slate-900/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 sm:flex">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-medium text-slate-900 shadow-sm">
                    <ZoomIn size={14} /> 查看大图
                  </span>
                </span>
                {/* 移动端：常驻角标（否则手机上根本没有入口提示） */}
                <span className="pointer-events-none absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/55 text-white backdrop-blur sm:hidden">
                  <ZoomIn size={15} />
                </span>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>{result.resolution || resolution}</span>
                  <span>{result.aspectRatio || aspect}</span>
                  {result.refImageCount > 0 && <span>参考图 {result.refImageCount}/{MAX_REF_IMAGES}</span>}
                  <span>{Math.round((Number(result.size) || 0) / 1024)} KB</span>
                  {typeof result.chargedPoints === 'number' && <span>消耗 {result.chargedPoints} 点</span>}
                  {typeof result.points === 'number' && <span>余额 {result.points} 点</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openPublish}
                    className="ig-cta inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    <Sparkles size={15} /> 加入灵感广场
                  </button>
                  <button
                    type="button"
                    onClick={addToAssets}
                    disabled={assetState !== 'idle'}
                    className={`ig-cta inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-default ${assetState === 'added'
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                  >
                    {assetState === 'added' ? <><Check size={15} /> 已加入资产库</> : <><FolderPlus size={15} /> 加入资产库</>}
                  </button>
                  <a
                    href={result.url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ig-cta inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={15} /> 下载
                  </a>
                </div>
              </div>
              {assetState === 'added' && (
                <p className="flex items-center gap-1 text-xs text-emerald-600">
                  <Check size={14} /> 已加入「图片」资产库，可在
                  <Link to="/assets" className="underline hover:text-emerald-700">我的资产</Link>
                  的「图片」标签下查看。
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== 发现灵感 ===== */}
      <InspirationPlaza onUsePrompt={applyPrompt} refreshToken={plazaToken} />

      {/* ===== 发布到灵感广场 ===== */}
      {publishOpen && result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onMouseDown={() => { if (publishState !== 'saving') setPublishOpen(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-base font-bold text-slate-900">加入灵感广场</h3>
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                disabled={publishState === 'saving'}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <img
              src={result.url}
              alt="待发布作品"
              className="mt-3 max-h-52 w-full rounded-xl border border-slate-200 object-cover"
            />
            <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-slate-500">
              {String(result.prompt || prompt || '').trim()}
            </p>

            <div className="mt-3">
              <div className="mb-1.5 text-xs font-medium text-slate-600">选择分类</div>
              <div className="flex flex-wrap gap-1.5">
                {publishable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPublishCategory(item.id)}
                    disabled={publishState === 'saving'}
                    className={`ig-chip rounded-full border px-2.5 py-1 text-[12px] transition ${publishCategory === item.id
                      ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                disabled={publishState === 'saving'}
                className="ig-cta flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={publishToPlaza}
                disabled={publishState !== 'idle'}
                className={`ig-cta flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-80 ${publishState === 'done'
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-brand-600 text-white hover:bg-brand-700'}`}
              >
                {publishState === 'saving' && <><Loader2 size={15} className="animate-spin" /> 发布中…</>}
                {publishState === 'done' && <><Check size={15} /> 已发布</>}
                {publishState === 'idle' && <><Sparkles size={15} /> 发布到{labelOf(publishCategory)}</>}
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">发布后其他人可在灵感广场「做同款」复用你的提示词</p>
          </div>
        </div>
      )}

      {/* ===== 大图预览（灯箱）=====
          用 fixed 覆盖层显示**同一张原图**（不生成缩略图、不做二次压缩），
          尺寸只受视口约束（max 92vw / 86vh），小图保持原生像素、不放大 ⇒ 清晰度与原图一致。
          关闭方式三种：右上角 ×、点空白处、按 Esc；点图片本身不关闭（防误触）。 */}
      {previewOpen && result && (
        <div
          className="ig-lightbox fixed inset-0 z-[70] flex flex-col items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="查看大图"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}
        >
          <button
            type="button"
            onClick={() => setPreviewOpen(false)}
            aria-label="关闭预览"
            title="关闭预览（Esc）"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={20} />
          </button>
          <img
            src={result.url}
            alt={result.prompt || '生成结果'}
            draggable={false}
            className="ig-lightbox-img rounded-lg shadow-2xl"
            style={{ maxWidth: '92vw', maxHeight: '86vh', width: 'auto', height: 'auto' }}
          />
          <p className="mt-3 text-center text-[11px] text-white/55">
            {[result.resolution, result.aspectRatio, result.model].filter(Boolean).join(' · ')}
            <span className="mx-2 text-white/25">|</span>
            {/* 触屏没有 Esc，文案不能统一写「按 Esc」—— 手机上那句话等于没提示 */}
            <span className="sm:hidden">点空白处或右上角 × 关闭</span>
            <span className="hidden sm:inline">点击空白处或按 Esc 关闭</span>
          </p>
        </div>
      )}
    </div>
  );
}
