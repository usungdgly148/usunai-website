import { useEffect, useMemo, useState } from 'react';
import { Wand2, Download, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { useStore } from '../store.jsx';
import { adminFetch } from '../authFetch.js';
import { fetchRelayModels } from '../cozeApi.js';
import { AdminPageHeader, Card, PrimaryButton } from '../adminUI.jsx';
import RefImagePicker, { toApiImages } from '../RefImagePicker.jsx';

// 后台配的是「默认比例」——全站一个值、与具体模型无关，所以这里用**并集**（10 个）。
// ⚠️ 各模型实际能用的比例不在这里，由服务端 aspectRatiosForModel() 决定并下发到 models[].aspectRatios；
//    这里多列出来的比例，对 gpt-image 系模型会在生成时被服务端明确拒绝，不会静默降级。
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2', '21:9', '1:4', '4:1'];
const RESOLUTIONS = ['1K', '2K', '4K'];
// 与服务端 server/gemini-image.mjs 的 IMAGE_MODEL_CANDIDATES 保持一致（那边是唯一实现）。
// gemini-2.5-flash-image 已按主人要求移除（该模型上游无渠道，不再展示）。
const MODEL_FALLBACKS = ['gemini-nano-banana-2.1', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';
const priceCls = 'w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:border-blue-500';

export default function AdminImageGen() {
  const { authProviders, refreshAllConfig } = useStore();
  // 2026-10-21：本页只用 authProviders（属配置类），原来调 refreshAllAdminLists 是拉 5.9MB 记录列表，纯浪费。
  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig]);

  const relays = useMemo(
    () => (authProviders || []).filter((p) => p.type === 'relay' && p.status !== 'disabled' && p.status !== 'inactive'),
    [authProviders],
  );

  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState(MODEL_FALLBACKS[0]);
  const [resolution, setResolution] = useState('1K');
  const [aspect, setAspect] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  // 模型 → 是否支持参考图（服务端下发；gpt-image-* 为 false）
  const [caps, setCaps] = useState({});

  // 配置草稿（模型 × 清晰度 → 点数）。真实计费完全以此为准，代码里没有任何写死价格。
  const [draft, setDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);
  // 图片处理授权清单：和「授权中心」、用户页配置共用服务端 resolveImageProvider()，
  // 每条授权自带实时探测到的 imageModels / available / error。前端不认任何写死的授权 id。
  const [providerState, setProviderState] = useState(null);

  const loadProviders = async () => {
    try {
      const res = await adminFetch('/api/admin/image-gen/providers', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { setProviderState(data); return data; }
    } catch { /* 授权探测失败不应挡住配置页正常编辑 */ }
    return null;
  };

  // 凭证列表是异步到货的：优先回显「实际生效」的那条，其次「后台已指定」的那条，
  // 最后才落到第一条。旧写法固定 relays[0]（常是对话专用凭证、没有图片模型）会让前后台不一致。
  useEffect(() => {
    if (providerId || !relays.length) return;
    const effective = providerState?.effectiveProviderId;
    const hit = relays.find((p) => p.id === effective)
      || relays.find((p) => p.id === providerState?.configuredProviderId);
    setProviderId((hit || relays[0]).id);
  }, [relays, providerId, providerState]);

  // 换授权立刻联动：重新拉一次各授权的实时可用图片模型，不需要手动点「拉取」。
  useEffect(() => { loadProviders(); }, [providerId]);

  // 单张实测 20~23 秒（4K 约 47 秒），没有进度可拿，只能显示已等待秒数让用户知道没卡死
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const toDraft = (settings) => ({
    providerId: settings.providerId || '',
    models: (settings.models || []).map((item) => ({
      id: item.id,
      label: item.label || '',
      enabled: item.enabled !== false,
      prices: { ...(item.prices || {}) },
    })),
    defaultModel: settings.defaultModel || '',
    defaultResolution: settings.defaultResolution || '1K',
    fallbackPoints: settings.fallbackPoints || 30,
    aspectRatio: settings.aspectRatio || '1:1',
  });

  // 哪些模型吃参考图：由服务端 withRefSupport() 下发（gpt-image-* 走 OpenAI 创建接口，没有参考图入口）
  const toCaps = (settings) => {
    const map = {};
    (settings.models || []).forEach((item) => { map[item.id] = item.supportsRefs !== false; });
    return map;
  };

  const loadSettings = async () => {
    try {
      const res = await adminFetch('/api/admin/image-gen/settings');
      const data = await res.json().catch(() => ({}));
      if (!data.ok || !data.settings) {
        setSettingsMsg({ ok: false, msg: data.error || '读取生图配置失败' });
        return;
      }
      setDraft(toDraft(data.settings));
      setCaps(toCaps(data.settings));
      // 下拉框必须回显「已保存的凭证」，否则页面默认选中第一条（可能是对话专用凭证）：
      // 既会误导测试，也会在保存时把凭证改错。
      if (data.settings.providerId) setProviderId(data.settings.providerId);
      if (data.settings.defaultModel) setModel(data.settings.defaultModel);
      if (data.settings.defaultResolution) setResolution(data.settings.defaultResolution);
    } catch (e) {
      setSettingsMsg({ ok: false, msg: '读取生图配置失败：' + String(e.message || e) });
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const selectedProviderInfo = (providerState?.providers || []).find((item) => item.id === providerId) || null;
  const availableIds = selectedProviderInfo?.imageModels || [];
  // 用户页真正生效的授权（原授权失效时服务端会自动切换）；定价表的可用性标记按它算。
  const effectiveProviderInfo = (providerState?.providers || []).find((item) => item.id === providerState?.effectiveProviderId) || null;
  const effectiveIds = effectiveProviderInfo?.imageModels || [];
  const relayName = (id) => relays.find((p) => p.id === id)?.name || id;

  // 试生成的模型下拉 = 当前授权下的真实图片模型 ∪ 已配置模型；两者都空才用内置兜底。
  const modelOptions = useMemo(() => {
    const ids = new Set();
    (draft?.models || []).forEach((item) => ids.add(item.id));
    availableIds.forEach((id) => ids.add(id));
    if (!ids.size) MODEL_FALLBACKS.forEach((id) => ids.add(id));
    return [...ids];
  }, [draft, selectedProviderInfo]);

  // 只拉「图片模型」：中转站 /v1/models 会混返聊天模型，不过滤会把对话模型塞进定价表。
  const pullModels = async () => {
    const target = providerId || draft?.providerId;
    if (!target) { setSettingsMsg({ ok: false, msg: '请先选择图片处理授权' }); return; }
    setPulling(true);
    const r = await fetchRelayModels(target, { capability: 'image' });
    setPulling(false);
    if (!r || r.ok === false) {
      setSettingsMsg({ ok: false, msg: '拉取失败：' + ((r && r.error) || '未知错误') });
      return;
    }
    const ids = Array.isArray(r.models) ? r.models : [];
    setDraft((prev) => {
      const base = prev || { models: [], defaultModel: '', defaultResolution: '1K', fallbackPoints: 30, aspectRatio: '1:1' };
      const existing = new Set((base.models || []).map((item) => item.id));
      const added = ids.filter((id) => !existing.has(id)).map((id) => ({ id, label: '', enabled: false, prices: {} }));
      return { ...base, models: [...(base.models || []), ...added] };
    });
    await loadProviders();
    setSettingsMsg({ ok: true, msg: `已从「${relayName(target)}」取到 ${ids.length} 个图片模型；新增的默认「不上架」，填价并勾选后才会出现在用户页。` });
  };

  const patchModel = (index, patch) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, models: prev.models.map((item, i) => (i === index ? { ...item, ...patch } : item)) };
    });
  };

  const setModelPrice = (index, resolutionKey, raw) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((item, i) => {
          if (i !== index) return item;
          const prices = { ...item.prices };
          if (raw === '') delete prices[resolutionKey];
          else {
            const value = Number(raw);
            if (Number.isFinite(value) && value > 0) prices[resolutionKey] = Math.round(value);
          }
          return { ...item, prices };
        }),
      };
    });
  };

  const saveSettings = async () => {
    if (!draft || savingSettings) return;
    setSavingSettings(true);
    setSettingsMsg({ ok: true, msg: '正在保存…' });
    try {
      const res = await adminFetch('/api/admin/image-gen/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 凭证以页面上"授权凭证"下拉为准：它既是测试用的凭证，也是用户生成时真正使用的凭证。
          // （旧写法 draft.providerId 优先 ⇒ 下拉框改了也永远保存不进去，等于切不了凭证）
          providerId: providerId || draft.providerId,
          models: draft.models.map((item) => ({ id: item.id, label: item.label, enabled: !!item.enabled, prices: item.prices })),
          defaultModel: draft.defaultModel,
          defaultResolution: draft.defaultResolution,
          fallbackPoints: Number(draft.fallbackPoints) || 0,
          aspectRatio: draft.aspectRatio,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `保存失败（HTTP ${res.status}）`);
      setDraft(toDraft(data.settings));
      setCaps(toCaps(data.settings));
      if (data.settings.providerId) setProviderId(data.settings.providerId);
      const state = await loadProviders();
      const effectiveName = (state?.providers || []).find((p) => p.id === state?.effectiveProviderId)?.name;
      setSettingsMsg({
        ok: true,
        msg: state?.fallback || state?.reason
          ? `已保存。当前实际生效授权「${effectiveName || '无'}」：${state?.reason || '按有效配置下发'}；用户页只展示该授权下可用且已上架的模型。`
          : `已保存，用户页刷新即生效（无需发版）；当前图片处理授权「${effectiveName || providerId}」。`,
      });
    } catch (e) {
      setSettingsMsg({ ok: false, msg: String(e.message || e) });
    } finally {
      setSavingSettings(false);
    }
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text) { setError('请先填写画面描述'); return; }
    if (!providerId) { setError('请先选择生图凭证'); return; }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await adminFetch('/api/admin/image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authProviderId: providerId, model, resolution, aspectRatio: aspect, prompt: text, images: toApiImages(refs) }),
      });
      // adminFetch 对非 2xx 不抛错，必须自己解析出服务端文案，否则前端只剩一句「生成失败」
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok || !data.ok) throw new Error(data.error || `生成失败（HTTP ${res.status}）`);
      setResult(data);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const activeCount = (draft?.models || []).filter((item) => item.enabled && Object.keys(item.prices || {}).length > 0).length;

  return (
    <div>
      <AdminPageHeader
        title="AI全能设计"
        subtitle="图片处理授权与模型由后台动态指定，支持文生图、参考图（图生图）与 1K/2K/4K 清晰度。此页测试不扣用户算力。"
      />

      {providerState && (
        <div className={`mb-6 rounded-xl px-4 py-3 text-sm ${providerState.reason || !providerState.effectiveProviderId ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'}`}>
          <span className="font-medium">当前生效的图片处理授权：</span>
          {providerState.effectiveProviderId
            ? <>「{effectiveProviderInfo?.name || providerState.effectiveProviderId}」，其下 {effectiveIds.length} 个可用图片模型。用户页只展示这条授权下真实可用且已上架的模型；也可到「授权中心」点「设为图片授权」切换。</>
            : <>暂无可用授权，请到「授权中心」新增或启用一条包含图片模型的中转站授权。</>}
          {providerState.reason && <div className="mt-1">{providerState.reason}</div>}
        </div>
      )}

      {/* ===== 模型与定价：用户生成时按这里的「模型 × 清晰度」扣点，改完即生效 ===== */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-medium text-slate-700">模型与定价</div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              按「模型 × 清晰度」分别设点数，用户生成时按此扣费；价格不存在代码里，保存后立即生效、不用发版。<br />
              价格留空 = 该清晰度不开放；未填任何价格的模型不会上架（用户页看不到）。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={pullModels}
              disabled={pulling}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {pulling ? '拉取中…' : '拉取当前授权的图片模型'}
            </button>
            <PrimaryButton onClick={saveSettings} disabled={savingSettings || !draft}>
              {savingSettings ? '保存中…' : '保存配置'}
            </PrimaryButton>
          </div>
        </div>

        {!draft && <p className="text-sm text-slate-400">正在读取配置…</p>}

        {draft && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="text-left font-medium px-2 py-1 w-16">上架</th>
                    <th className="text-left font-medium px-2 py-1">模型</th>
                    <th className="text-left font-medium px-2 py-1 w-48">用户看到的名称</th>
                    {RESOLUTIONS.map((item) => (
                      <th key={item} className="text-center font-medium px-2 py-1 w-24">{item} 点数</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.models.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-3 text-slate-400">还没有模型。点右上角「拉取当前授权的图片模型」。</td></tr>
                  )}
                  {draft.models.map((item, index) => {
                    const priced = Object.keys(item.prices || {}).length > 0;
                    // 可用性按「实际生效授权」判断：授权换过 / 模型被上游下架都会被标出来。
                    // 只提示不强制禁用 —— 服务端 config 会自动过滤，单条失效不会让整页不可用。
                    const liveState = !providerState || !effectiveProviderInfo?.available
                      ? 'unknown'
                      : (effectiveIds.includes(item.id) ? 'ok' : 'missing');
                    return (
                      <tr key={item.id} className="bg-slate-50/60">
                        <td className="px-2 py-1.5 align-middle">
                          <input
                            type="checkbox"
                            checked={!!item.enabled}
                            disabled={!priced}
                            title={priced ? '勾选后用户页可选' : '先填至少一个价格才能上架'}
                            onChange={(e) => patchModel(index, { enabled: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <span className="font-mono text-xs text-slate-600">{item.id}</span>
                          {!priced && <span className="ml-1.5 text-[11px] text-amber-600">未定价</span>}
                          {liveState === 'missing' && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">当前授权下不可用</span>}
                          {liveState === 'ok' && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">可用</span>}
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <input
                            value={item.label}
                            onChange={(e) => patchModel(index, { label: e.target.value })}
                            placeholder={item.id}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                          />
                        </td>
                        {RESOLUTIONS.map((key) => (
                          <td key={key} className="px-2 py-1.5 align-middle text-center">
                            <input
                              type="number"
                              min="1"
                              value={item.prices?.[key] ?? ''}
                              onChange={(e) => setModelPrice(index, key, e.target.value)}
                              placeholder="—"
                              className={priceCls}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">默认模型</label>
                <select
                  value={draft.defaultModel}
                  onChange={(e) => setDraft((prev) => ({ ...prev, defaultModel: e.target.value }))}
                  className={inputCls}
                >
                  {draft.models.map((item) => <option key={item.id} value={item.id}>{item.label || item.id}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">默认清晰度</label>
                <select
                  value={draft.defaultResolution}
                  onChange={(e) => setDraft((prev) => ({ ...prev, defaultResolution: e.target.value }))}
                  className={inputCls}
                >
                  {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">兜底点数（缺价时）</label>
                <input
                  type="number"
                  min="1"
                  value={draft.fallbackPoints}
                  onChange={(e) => setDraft((prev) => ({ ...prev, fallbackPoints: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">默认画面比例</label>
                <select
                  value={draft.aspectRatio}
                  onChange={(e) => setDraft((prev) => ({ ...prev, aspectRatio: e.target.value }))}
                  className={inputCls}
                >
                  {ASPECTS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-2">
              已上架且定价：{activeCount} 个模型。用户页最终可见的是「当前生效授权下真实可用」的那部分，由服务端实时过滤；某条授权或模型失效会自动切换或隐藏，不影响页面其他功能。
            </p>
          </>
        )}

        {settingsMsg && (
          <p className={`mt-2 text-xs ${settingsMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{settingsMsg.msg}</p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">图片处理授权</label>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputCls}>
              <option value="">请选择图片处理授权</option>
              {relays.map((p) => {
                const info = (providerState?.providers || []).find((item) => item.id === p.id);
                const count = info?.imageModels?.length || 0;
                return <option key={p.id} value={p.id}>{p.name}{info ? `（图片模型 ${count} 个${info.available ? '' : '·不可用'}）` : '（未探测）'}</option>;
              })}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              保存后即为「AI全能设计」的图片处理授权；也可在「授权中心」直接点「设为图片授权」。若这条授权失效，服务端会自动切到其他可用授权，用户页不会因此不可用。
            </p>
            {/* 选择后自动联动：展示这条授权下实时探测到的可用图片模型 */}
            <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">该授权下可用图片模型</span>
                <button type="button" onClick={loadProviders} className="text-[11px] text-brand-700 hover:underline">重新探测</button>
              </div>
              {selectedProviderInfo?.available
                ? <div className="mt-1.5 flex flex-wrap gap-1.5">{availableIds.map((id) => <span key={id} className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">{id}</span>)}</div>
                : <div className="mt-1 text-xs text-amber-700">{selectedProviderInfo?.error || '正在探测该授权的图片模型，或该授权暂不可用'}</div>}
            </div>
            {!relays.length && (
              <p className="text-xs text-amber-600 mt-1">还没有中转站凭证，请先到「授权中心」新增一条。</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">模型</label>
              <select value={model} onChange={(e) => { setModel(e.target.value); if (caps[e.target.value] === false) setRefs([]); }} className={inputCls}>
                {modelOptions.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">清晰度</label>
              <select value={resolution} onChange={(e) => setResolution(e.target.value)} className={inputCls}>
                {RESOLUTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">宽高比</label>
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={inputCls}>
                {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">画面描述</label>
            <textarea
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={2000}
              className={`${inputCls} resize-y`}
              placeholder="例如：一张产品海报，暖色木桌，柔和窗光，浅景深"
            />
            <p className="text-xs text-slate-400 mt-1">{prompt.length}/2000</p>
          </div>

          {/* 参考图只对 Gemini 原生通道有效；gpt-image-* 走 OpenAI 创建接口，没有参考图入口 */}
          {caps[model] !== false && <RefImagePicker value={refs} onChange={setRefs} disabled={busy} />}
          {caps[model] === false && (
            <p className="text-xs text-slate-400">当前模型（{model}）不支持参考图，参考图入口已隐藏。</p>
          )}

          <PrimaryButton onClick={generate} disabled={busy} className="w-full justify-center">
            {busy ? `生成中… 已等待 ${elapsed}s` : '开始生成'}
          </PrimaryButton>

          {error && (
            <p className="text-sm text-rose-600 flex items-start gap-1.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <p className="text-xs text-slate-400 leading-relaxed">
            实测耗时：文生图 20~30 秒；2K 约 37 秒（2048px）；4K 约 47 秒（4096px、约 18MB）；带 3 张参考图约 42 秒。<br />
            上游返回临时 CDN 链接，服务端会自动转存本站图床，所以这里拿到的地址不会失效。<br />
            带参考图时输出尺寸会受参考图比例影响（实测 3 张时出 1792×592），宽高比不再是唯一决定因素。
          </p>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-medium text-slate-700 mb-3">生成结果</div>

          {!result && !busy && (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-slate-300">
              <ImageIcon size={40} />
              <p className="text-sm">填写描述后点「开始生成」</p>
            </div>
          )}

          {busy && (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-slate-400">
              <Wand2 size={36} className="animate-pulse" />
              <p className="text-sm">正在生成，通常 20~30 秒（4K 约 47 秒）…</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <img src={result.url} alt={result.prompt || '生成结果'} className="w-full rounded-xl border border-slate-200" />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>{result.model}</span>
                {result.resolution && <span>{result.resolution}</span>}
                <span>{result.aspectRatio}</span>
                <span>{result.mimeType}</span>
                {result.refImageCount > 0 && <span>参考图 {result.refImageCount} 张</span>}
                <span>{Math.round((Number(result.size) || 0) / 1024)} KB</span>
              </div>
              <a
                href={result.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Download size={16} /> 下载图片
              </a>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
