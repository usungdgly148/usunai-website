import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wand2, Download, Image as ImageIcon, AlertCircle, Coins, Loader2 } from 'lucide-react';
import { useStore } from '../store.jsx';
import { apiFetch } from '../authFetch.js';

// 宽高比与服务端 server/gemini-image.mjs 的 IMAGE_ASPECT_RATIOS 保持一致。
const ASPECTS = [
  { value: '1:1', label: '方形', hint: '1:1' },
  { value: '16:9', label: '横版', hint: '16:9' },
  { value: '9:16', label: '竖版', hint: '9:16' },
  { value: '4:3', label: '横版', hint: '4:3' },
  { value: '3:4', label: '竖版', hint: '3:4' },
];
// 仅用于展示「本次大约消耗多少」，真实扣点以服务端 imageGenSettings 为准。
const PRICE_HINT = 20;

export default function ImageGen() {
  const { user, openRechargeModal, refreshCurrentUserCompute } = useStore();
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // 单张实测 20~23 秒，没有进度可拿，显示已等待秒数避免用户以为卡死
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const points = typeof user?.points === 'number' ? user.points : null;

  const generate = async () => {
    const text = prompt.trim();
    if (!text) { setError('请先描述你想要的画面'); return; }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await apiFetch('/api/image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, aspectRatio: aspect, requestId: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }),
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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wand2 size={22} className="text-brand-600" /> AI 生图
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          描述你想要的画面，约 20 秒出图。每次生成消耗约 {PRICE_HINT} 点算力，生成失败会自动退回。
        </p>
      </div>

      {!user && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          请先 <Link to="/profile" className="font-medium underline">登录</Link> 后再使用。
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-700">画面描述</label>
          {points !== null && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Coins size={13} /> 当前余额 {points} 点
            </span>
          )}
        </div>
        <textarea
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-brand-600 resize-y"
          placeholder="例如：一张产品海报，暖色木桌，柔和窗光，浅景深"
        />
        <div className="text-right text-xs text-slate-400 mt-1">{prompt.length}/2000</div>

        <div className="mt-3">
          <div className="text-sm font-medium text-slate-700 mb-2">画面比例</div>
          <div className="flex flex-wrap gap-2">
            {ASPECTS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setAspect(item.value)}
                className={`px-3.5 py-2 rounded-xl border text-sm transition ${aspect === item.value ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {item.label} <span className="text-xs text-slate-400">{item.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={busy || !user}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
        >
          {busy ? <><Loader2 size={16} className="animate-spin" /> 生成中… 已等待 {elapsed}s</> : <><Wand2 size={16} /> 开始生成</>}
        </button>

        {error && (
          <p className="mt-3 text-sm text-rose-600 flex items-start gap-1.5">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
        <div className="text-sm font-medium text-slate-700 mb-3">生成结果</div>

        {!result && !busy && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-300">
            <ImageIcon size={40} />
            <p className="text-sm">描述画面后点「开始生成」</p>
          </div>
        )}

        {busy && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
            <Wand2 size={36} className="animate-pulse" />
            <p className="text-sm">正在生成，通常 20 秒左右…</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <img src={result.url} alt={result.prompt || '生成结果'} className="w-full rounded-xl border border-slate-200" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>{result.aspectRatio || aspect}</span>
                <span>{Math.round((Number(result.size) || 0) / 1024)} KB</span>
                {typeof result.chargedPoints === 'number' && <span>消耗 {result.chargedPoints} 点</span>}
                {typeof result.points === 'number' && <span>余额 {result.points} 点</span>}
              </div>
              <a
                href={result.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Download size={16} /> 下载图片
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
