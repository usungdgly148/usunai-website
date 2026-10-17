import { useEffect, useMemo, useState } from 'react';
import { Wand2, Download, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { useStore } from '../store.jsx';
import { adminFetch } from '../authFetch.js';
import { AdminPageHeader, Card, PrimaryButton } from '../adminUI.jsx';

// 与 server/gemini-image.mjs 的 IMAGE_ASPECT_RATIOS 保持一致（那边是唯一实现）。
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
// 实测该令牌（usun-img 分组）可用的 3 个模型，走同一个 :generateContent 端点。
// ⚠️ 换令牌/换分组后可用模型会变；报错会明确提示「模型不存在」，届时改这里。
const MODELS = ['gemini-nano-banana-2.1', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';

export default function AdminImageGen() {
  const { authProviders, refreshAllAdminLists } = useStore();
  useEffect(() => { refreshAllAdminLists?.(); }, [refreshAllAdminLists]);

  const relays = useMemo(
    () => (authProviders || []).filter((p) => p.type === 'relay' && p.status !== 'disabled' && p.status !== 'inactive'),
    [authProviders],
  );

  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState(MODELS[0]);
  const [aspect, setAspect] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // 凭证列表是异步到货的，默认选中第一条（通常是生图专用的那条）
  useEffect(() => {
    if (!providerId && relays.length) setProviderId(relays[0].id);
  }, [relays, providerId]);

  // 单张实测 20~23 秒，没有进度可拿，只能显示已等待秒数让用户知道没卡死
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

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
        body: JSON.stringify({ authProviderId: providerId, model, aspectRatio: aspect, prompt: text }),
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

  return (
    <div>
      <AdminPageHeader
        title="AI 生图"
        subtitle="调用 Gemini 原生图片模型。此页为后台测试用，不扣用户算力。"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">生图凭证</label>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className={inputCls}>
              <option value="">请选择授权凭证</option>
              {relays.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.baseUrl}）</option>)}
            </select>
            {!relays.length && (
              <p className="text-xs text-amber-600 mt-1">还没有中转站凭证，请先到「授权中心」新增一条。</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">模型</label>
              <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
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
              rows={7}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={2000}
              className={`${inputCls} resize-y`}
              placeholder="例如：一张产品海报，暖色木桌，柔和窗光，浅景深"
            />
            <p className="text-xs text-slate-400 mt-1">{prompt.length}/2000</p>
          </div>

          <PrimaryButton onClick={generate} disabled={busy} className="w-full justify-center">
            {busy ? `生成中… 已等待 ${elapsed}s` : '开始生成'}
          </PrimaryButton>

          {error && (
            <p className="text-sm text-rose-600 flex items-start gap-1.5">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <p className="text-xs text-slate-400">
            实测单张约 20~23 秒。上游返回的是临时 CDN 链接，服务端会自动转存到本站图床再回给这里，所以这里拿到的地址不会失效。
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
              <p className="text-sm">正在生成，通常 20 秒左右…</p>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <img src={result.url} alt={result.prompt || '生成结果'} className="w-full rounded-xl border border-slate-200" />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>{result.model}</span>
                <span>{result.mimeType}</span>
                <span>{Math.round((Number(result.size) || 0) / 1024)} KB</span>
                {result.aspectRatio && <span>{result.aspectRatio}</span>}
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
