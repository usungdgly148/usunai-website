import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Send, Paperclip, Image as ImageIcon, Square, Bot, Sparkles, ChevronRight, ChevronDown, Copy, RefreshCw, PlusSquare, Zap } from 'lucide-react';
import { useStore, getUserPlanStatus } from '../store.jsx';
import { chatWithAgent } from '../cozeApi.js';
import { tryUploadToBlob } from '../blobUpload.js';
import { HistoryPanel, InfoCard, Drawer, SubHeader, RequireLoginModal, Toast, getSuggestions } from '../innerUI.jsx';
import { fetchEstimate, estimateTokens, BILLING } from '../billing.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractResultMedia, classifyAsset, ASSET_TYPE_NAMES, SOURCE_TYPE_NAMES } from '../assetUtils.js';
import { copyText } from '../clipboard.js';

function AutoResizeTextarea({ value, onChange, placeholder, className, onKeyDown }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    const minHeight = 88; // ~3 lines
    ref.current.style.height = Math.max(minHeight, ref.current.scrollHeight) + 'px';
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      className={className}
      style={{ height: '88px' }}
    />
  );
}

// 开场白区 Markdown 组件：支持标题/粗体/表格/列表/引用/代码，风格贴合欢迎区
const welcomeMarkdownComponents = {
  h1: ({ children }) => <h1 className="text-xl font-bold text-slate-900 mb-3 pb-2 border-b border-slate-200/70">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold text-slate-900 mb-2.5 mt-4">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-bold text-slate-900 mb-2 mt-3">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-bold text-slate-800 mb-1.5 mt-2.5">{children}</h4>,
  p: ({ children }) => <p className="text-slate-600 leading-relaxed mb-2.5">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
  hr: () => <hr className="my-3 border-slate-200/70" />,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2.5 text-slate-600">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2.5 text-slate-600">{children}</ol>,
  li: ({ children }) => <li className="mb-1 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-4 py-1 my-2.5 italic text-slate-500 bg-slate-100/50 rounded-r-lg">{children}</blockquote>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">{children}</a>,
  table: ({ children }) => <div className="overflow-x-auto mb-3"><table className="w-full border-collapse text-sm">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-slate-100/70">{children}</thead>,
  th: ({ children }) => <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-900">{children}</th>,
  td: ({ children }) => <td className="border border-slate-200 px-3 py-2 text-slate-700">{children}</td>,
  code: ({ className, children, ...props }) => <code className={className} {...props}>{children}</code>,
  pre: ({ children }) => <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 text-[13px] font-mono overflow-x-auto mb-3">{children}</pre>,
};

function Welcome({ agent, onPick }) {
  const suggestions = getSuggestions(agent);
  return (
    <div className="animate-fade-up pt-2">
      <div className="md-render text-sm text-slate-600 leading-relaxed mb-5">
        <Markdown remarkPlugins={[remarkGfm]} components={welcomeMarkdownComponents}>
          {agent.opening || agent.instructions || '你好，我是你的智能助手。'}
        </Markdown>
      </div>

      {suggestions.length > 0 && (
        <>
          <div className="text-xs text-slate-400 mb-2.5">试试这样问 · 点击直接生成</div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onPick(s)}
                className="group inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-[13px] hover:border-blue-200 hover:text-blue-600 hover:shadow-soft transition"
              >
                <span>{s}</span>
                <ChevronRight size={14} className="text-slate-400 group-hover:text-blue-500 transition" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function UserBubble({ content, images, files }) {
  const [expanded, setExpanded] = useState(false);
  const [needsClamp, setNeedsClamp] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const maxHeight = lineHeight * 10;
    setNeedsClamp(el.scrollHeight > maxHeight + 2);
  }, [content]);

  return (
    <div className="animate-msg flex gap-3 mb-5 flex-row-reverse">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-slate-200 text-slate-600">我</div>
      <div className="max-w-[82%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-soft">
        {images?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-white/30" />
              </a>
            ))}
          </div>
        )}
        {files?.length > 0 && (
          <div className="flex flex-col gap-1 mb-2">
            {files.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline text-blue-100 hover:text-white">
                <Paperclip size={12} className="shrink-0" /> {f.name}
              </a>
            ))}
          </div>
        )}
        <div
          ref={contentRef}
          className="whitespace-pre-wrap overflow-hidden"
          style={!expanded ? { display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical' } : undefined}
        >
          {content}
        </div>
        {needsClamp && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-blue-100 hover:text-white transition"
          >
            {expanded ? '收起' : '展开'} <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}

const assistantMarkdownComponents = {
  h1: ({ children }) => <h1 className="text-2xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-200/70">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold text-slate-900 mb-3 mt-5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-bold text-slate-900 mb-2 mt-4">{children}</h3>,
  p: ({ children }) => <p className="text-slate-700 leading-relaxed mb-3">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
  hr: () => <hr className="my-4 border-slate-200/70" />,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="mb-1 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-4 py-1 my-3 italic text-slate-600 bg-slate-100/50 rounded-r-lg">{children}</blockquote>,
  table: ({ children }) => <table className="w-full border-collapse mb-4 text-sm">{children}</table>,
  thead: ({ children }) => <thead className="bg-slate-100/70">{children}</thead>,
  th: ({ children }) => <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-900">{children}</th>,
  td: ({ children }) => <td className="border border-slate-200 px-3 py-2 text-slate-700">{children}</td>,
  code: ({ className, children, ...props }) => <code className={className} {...props}>{children}</code>,
  pre: ({ children }) => <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 text-sm font-mono overflow-x-auto mb-3">{children}</pre>,
};

function AssistantBubble({ content, agent, onCopy, onRegenerate, onAsset, usage }) {
  return (
    <div className="animate-msg flex gap-3 mb-5">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${agent.iconColor} text-white shadow-soft`}>
        <Bot size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="md-render rounded-2xl px-5 py-4 text-[15px] leading-relaxed bg-transparent border border-slate-200/40 text-slate-800">
          <Markdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>{content}</Markdown>
        </div>
        <div className="flex items-center gap-1 mt-2 ml-1">
          <button onClick={onCopy} title="复制内容" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition">
            <Copy size={16} />
          </button>
          <button onClick={onRegenerate} title="重新生成" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => onAsset(content)} title="加入资产库" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition">
            <PlusSquare size={16} />
          </button>
          {usage && (
            <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <Zap size={12} className="text-amber-500" />
              <span>⚡️ {usage.totalTokens} token</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, agent, onCopy, onRegenerate, onAsset }) {
  if (m.role === 'user') return <UserBubble content={m.content} images={m.images} files={m.files} />;
  return <AssistantBubble content={m.content} agent={agent} onCopy={onCopy} onRegenerate={onRegenerate} onAsset={onAsset} usage={m.usage} />;
}

function Thinking({ agent }) {
  return (
    <div className="animate-msg flex gap-3 mb-5">
      <div className={`w-9 h-9 rounded-full ${agent.iconColor} text-white flex items-center justify-center shadow-soft`}>
        <Bot size={16} />
      </div>
      <div className="bg-white border border-slate-100 shadow-soft rounded-2xl px-4 py-3.5 flex items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-1">AI 正在思考</span>
        <span className="dot w-1.5 h-1.5 rounded-full bg-slate-400" style={{ animationDelay: '0s' }} />
        <span className="dot w-1.5 h-1.5 rounded-full bg-slate-400" style={{ animationDelay: '.2s' }} />
        <span className="dot w-1.5 h-1.5 rounded-full bg-slate-400" style={{ animationDelay: '.4s' }} />
      </div>
    </div>
  );
}

function Composer({ input, setInput, onSubmit, streaming, attachments, setAttachments }) {
  const imgRef = useRef(null);
  const fileRef = useRef(null);

  const handleFiles = async (fileList, isImage) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const results = await Promise.all(files.map(async (f) => {
      const isImg = isImage || f.type.startsWith('image/');
      let url = await tryUploadToBlob(f);
      if (!url) {
        // 本地/未配置 Blob 时降级为 base64 内联，保证功能可用
        url = await new Promise((res) => {
          const r = new FileReader();
          r.onload = (e) => res(e.target.result);
          r.onerror = () => res('');
          r.readAsDataURL(f);
        });
      }
      if (!url) return null;
      return { name: f.name, url, kind: isImg ? 'image' : 'file', size: f.size };
    }));
    const valid = results.filter(Boolean);
    if (valid.length) setAttachments((prev) => [...prev, ...valid]);
  };

  return (
    <div className="px-4 lg:px-6 py-4 bg-[#f0f4f9]/85 backdrop-blur-md border-t border-slate-200/60 shrink-0">
      <div className="max-w-5xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((a, i) => (
              <div key={i} className="group relative">
                {a.kind === 'image' ? (
                  <img src={a.url} alt={a.name} className="h-14 w-14 object-cover rounded-lg border border-slate-200" />
                ) : (
                  <div className="h-14 max-w-[160px] px-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 truncate" title={a.name}>
                    <Paperclip size={12} className="shrink-0" /> {a.name}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-700 text-white text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  title="移除"
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 bg-white rounded-2xl border border-slate-200 shadow-soft px-3 py-2.5 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-50 transition">
          <button type="button" onClick={() => fileRef.current?.click()} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition shrink-0" title="上传附件">
            <Paperclip size={18} />
          </button>
          <button type="button" onClick={() => imgRef.current?.click()} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition shrink-0" title="上传图片">
            <ImageIcon size={18} />
          </button>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files, true); e.target.value = ''; }} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { handleFiles(e.target.files, false); e.target.value = ''; }} />
          <AutoResizeTextarea
            value={input}
            onChange={setInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="描述你的需求，或直接点上面的示例…"
            className="flex-1 bg-transparent outline-none text-[15px] px-1 py-1.5 resize-none min-h-[88px] max-h-[220px] overflow-y-auto leading-6 placeholder:text-slate-400"
          />
          <button
            onClick={onSubmit}
            disabled={(!input.trim() && attachments.length === 0) || streaming}
            className="p-2.5 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-soft disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-pop hover:-translate-y-0.5 active:translate-y-0 transition shrink-0"
            title={streaming ? '生成中…' : '发送'}
          >
            {streaming ? <Square size={15} fill="white" /> : <Send size={15} />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Sparkles size={12} className="text-blue-400" /> AI 生成内容仅供参考，请自行核对
          </span>
          <span className="flex items-center gap-1 hidden sm:flex">
            按 <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-sans text-[10px]">Enter</kbd> 发送 ·{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-sans text-[10px]">Shift+Enter</kbd> 换行
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const { user, points, consume, addHistory, history, agents, addAsset, addTask, openRechargeModal, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig]);
  const agent = useMemo(() => agents.find((a) => a.id === id) || null, [id, agents]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState('');
  const [showLogin, setShowLogin] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [attachments, setAttachments] = useState([]);
  const scrollRef = useRef(null);
  const toastTimer = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, result, streaming]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // 2026-07-31：安全修复——未登录时 (`!user`) 必须返回空，绝不能放过别人的历史。
  // 原写法 `(!user || h.userId === user.id)` 等价于"未登录显示全部"，是隐私漏洞。
  const agentHistory = user ? history.filter((h) => h.agentId === agent?.id && h.userId === user.id) : [];

    const startNewChat = () => {
    setMessages([]);
    setResult('');
    setActiveHistoryId(null);
    setInput('');
  };

  const copyToClipboard = async (text) => {
    const ok = await copyText(text);
    showToast(ok ? '已复制到剪贴板' : '复制失败');
  };

  const regenerate = (assistantIndex) => {
    // 找到对应用户输入：向上追溯到最近一条 user 消息
    const prevMessages = messages.slice(0, assistantIndex);
    for (let i = prevMessages.length - 1; i >= 0; i--) {
      if (prevMessages[i].role === 'user') {
        // submit 使用显式快照，避免 setMessages 的异步更新仍被旧闭包读到，
        // 从而把旧 assistant / 后续消息重复写进新的 transcript。
        const baseMessages = prevMessages.slice(0, i);
        setMessages(baseMessages);
        submit(prevMessages[i].content, baseMessages);
        return;
      }
    }
  };

  const addToAsset = (content) => {
    if (!user) { setShowLogin(true); return; }
    const { text, images, videos, audios } = extractResultMedia({ text: content, kind: 'text' });
    const type = classifyAsset({ text, images, videos, audios, sourceName: agent.name });
    addAsset({
      sourceType: 'agent',
      sourceId: agent.id,
      sourceName: agent.name,
      type,
      name: `${agent.name} · ${ASSET_TYPE_NAMES[type]}`,
      content: text,
      images,
      videos,
      audios,
    });
    showToast(`已加入「${ASSET_TYPE_NAMES[type]}」资产库`);
  };

  const loadHistory = (h) => {
    const storedMessages = (Array.isArray(h.messages) ? h.messages : [])
      .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content, ...(m.usage ? { usage: m.usage } : {}) }));
    // 新记录恢复完整多轮 transcript；旧记录没有 messages 时继续兼容原先的一问一答结构。
    setMessages(storedMessages.length ? storedMessages : [
      { role: 'user', content: h.userPrompt || h.title || '' },
      { role: 'assistant', content: h.content || '' },
    ]);
    setResult('');
    setActiveHistoryId(h.id);
    setHistoryOpen(false);
  };

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  const submit = async (override, conversationOverride = null) => {
    const text = (override ?? input).trim();
    const atts = attachments;
    if ((!text && atts.length === 0) || streaming) return;
    if (!user) { setShowLogin(true); return; }
    // 套餐有效期拦截：已绑定套餐且已到期 → 完全阻断并弹充值窗（剩余算力保留，需续费才能继续）
    const plan = getUserPlanStatus(user);
    if (plan.expired) { openRechargeModal(plan.validTo); return; }

    // 用本次提交前的消息快照计算消耗，并在成功后把“旧 transcript + 本轮问答”
    // 整体写回同一条历史记录。重新生成时由调用方显式传入裁剪后的快照，
    // 不依赖 setMessages 后尚未提交的异步 state。
    const conversationSource = Array.isArray(conversationOverride) ? conversationOverride : messages;
    const conversationBefore = conversationSource
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role,
        content: String(m.content ?? ''),
        ...(m.usage ? { usage: m.usage } : {}),
      }));
    const system = [agent.instructions, agent.opening].filter(Boolean).join('\n');
    const historyMsgs = conversationBefore.map(m => ({ role: m.role, content: m.content }));
    // 拆开 inputTokens，让前端能展示"系统提示词 X / 历史 Y / 用户 Z"的明细
    // —— 之前只是合计 504 token，主人误以为系统提示词没算进去（实际它占了 460+ token）
    const systemTokens = system ? estimateTokens(system) + BILLING.messageOverhead : 0;
    const historyTokens = historyMsgs.reduce((s, m) => s + (m.content ? estimateTokens(m.content) + BILLING.messageOverhead : 0), 0);
    const userTokens = estimateTokens(text) + BILLING.messageOverhead;
    let prePoints = 1;
    try {
      const pre = await fetchEstimate({ system, history: historyMsgs, message: text, answer: '', priceRate: agent.priceRate });
      prePoints = pre.points;
    } catch { /* 兜底 1 点 */ }
    if (points < prePoints) { alert('算力不足，请前往个人中心充值'); return; }

    // 智能体连接配置由前端从本地读取并随请求携带，经 EdgeOne 函数转发扣子。
    // 本地校验平台与项目/ Bot 标识是否填好。
    const missing = [];
    if (!agent.platform) missing.push('平台');
    if (agent.platform === 'coze-new' && !agent.projectId) missing.push('Project ID');
    if (agent.platform === 'coze-old' && !agent.botId) missing.push('Bot ID');
    if (missing.length) {
      setMessages((prev) => [...prev, { role: 'user', content: text }]);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '⚠️ 该智能体尚未配置扣子调用参数：请进入后台「项目管理 → 编辑」，选择平台并填写 ' + missing.join('、') + '，然后点「保存」。',
      }]);
      return;
    }

    // 组装附件引用：图片以 markdown 内联、文件以链接形式追加到发给智能体的文本里
    const attImages = atts.filter(a => a.kind === 'image').map(a => a.url);
    const attFiles = atts.filter(a => a.kind === 'file').map(a => ({ name: a.name, url: a.url }));
    let messageText = text;
    if (atts.length) {
      const refs = atts.map(a => a.kind === 'image' ? `![图片](${a.url})` : `[附件](${a.url})`).join('\n');
      messageText = (text ? text + '\n' : '') + refs;
    }

    setInput('');
    setAttachments([]);
    // 流式阶段：先 push 用户消息 + assistant 占位（空 content），
    // 后端每推一个 onDelta 就把它累积到 acc，下方的打字机按固定节奏推 displayed,
    // 把 messages 数组最后一条 assistant 的 content 渲染为 acc.substring(0, displayed)。
    // 这样无论后端 SSE 是 chunk-by-chunk 流还是一次性到，主人看到的效果都一样：逐字出现。
    setMessages((prev) => [...prev, { role: 'user', content: text, images: attImages, files: attFiles }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setResult('');
    startTimeRef.current = Date.now();
    let acc = '';
    let displayed = 0;
    let typewriterRef = null;
    const TW_MS = 25;   // 打字机节奏：每 25ms 一拍
    const TW_STEP = 3;  // 每拍推进 3 字
    const tickTypewriter = () => {
      if (displayed >= acc.length) {
        // 已追上后端推送，停下；acc 再增长时会重新被启动
        if (typewriterRef) { clearInterval(typewriterRef); typewriterRef = null; }
        return;
      }
      // 自适应追赶：落后越多每拍推进越多（最多 12 字），既保留逐字打字感，
      // 又避免后端已结束、前端还在慢吞吞追字（之前固定 3 字/拍会让长回答再拖 2~3 秒）。
      const behind = acc.length - displayed;
      const step = Math.max(TW_STEP, Math.min(12, Math.ceil(behind / 8)));
      displayed = Math.min(displayed + step, acc.length);
      setMessages((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = { ...next[next.length - 1], content: acc.substring(0, displayed) };
        return next;
      });
      setResult(acc.substring(0, displayed)); // 兼容旧的 result bubble 渲染
    };
    const startTypewriter = () => {
      if (typewriterRef) return;
      typewriterRef = setInterval(tickTypewriter, TW_MS);
    };
    const sessionId = activeHistoryId || `session-${Date.now()}`;
    const controller = new AbortController();
    // 本次会话的稳定 ID（首轮 = 新建；追问 = 复用 activeHistoryId）。
    // 同时也是写入历史记录时的 id（addHistory({ id: sessionId })），保证历史项 id 与
    // 后端 KV 映射键完全一致 → 追问时按 sessionId 能命中已有 conversation_id，扣子续传上下文。
    const historyItemId = sessionId;
    try {
      await chatWithAgent({
        agentId: agent.id,
        message: messageText,
        sessionId,
        cfg: {
          platform: agent.platform,
          baseUrl: agent.baseUrl,
          apiKey: agent.apiKey,
          projectId: agent.projectId,
          botId: agent.botId,
          authType: agent.authType,
          userId: agent.userId,
        },
        onDelta: (delta) => {
          acc += delta;
          // 触发打字机（有节奏地推 displayed 追上 acc）
          startTypewriter();
        },
        signal: controller.signal,
      });
      // 流式完成：确保 displayed 追上 acc，停下打字机，把最后一条 message 标为完整 + usage
      if (typewriterRef) { clearInterval(typewriterRef); typewriterRef = null; }
      const est = await fetchEstimate({ system, history: historyMsgs, message: text, answer: acc, priceRate: agent.priceRate });
      const finalContent = acc || '(智能体未返回内容，请检查该智能体的扣子配置是否正确，以及项目是否已在扣子后台发布为 API 服务)';
      displayed = finalContent.length;
      // 把 system / history / user 拆分写进 usage，底部展示用
      const usageWithBreakdown = { ...est, systemTokens, historyTokens, userTokens };
      setMessages((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = { ...next[next.length - 1], content: finalContent, usage: usageWithBreakdown };
        return next;
      });
      consume(est.points, `使用智能体：${agent.name}`, {
        inputTokens: est.inputTokens,
        outputTokens: est.outputTokens,
        totalTokens: est.totalTokens,
        bufferedTokens: est.bufferedTokens,
        priceRate: agent.priceRate,
        bufferCoef: est.bufferCoef,
      });
      const duration = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;
      // 一次会话只写一条历史：首轮创建，追问按相同 sessionId 原位更新。
      // 历史项保存完整 transcript，点击左侧记录时可恢复中间会话区的全部问答。
      const existingHistory = history.find(h => String(h.id) === String(historyItemId));
      const firstPrompt = conversationBefore.find(m => m.role === 'user' && m.content.trim())?.content
        || existingHistory?.userPrompt
        || text;
      const now = new Date().toISOString();
      const conversationMessages = [
        ...conversationBefore,
        { role: 'user', content: text },
        { role: 'assistant', content: finalContent, usage: est },
      ];
      const historyItem = {
        id: historyItemId,
        sessionId: historyItemId,
        agentId: agent.id,
        agentName: agent.name,
        title: existingHistory?.title || firstPrompt.slice(0, 20),
        userPrompt: existingHistory?.userPrompt || firstPrompt,
        content: finalContent,
        messages: conversationMessages,
        roundCount: conversationMessages.filter(m => m.role === 'user').length,
        cost: (Number(existingHistory?.cost) || 0) + est.points,
        tokens: (Number(existingHistory?.tokens) || 0) + est.totalTokens,
        createdAt: existingHistory?.createdAt || now,
        updatedAt: now,
      };
      addHistory(historyItem);
      setActiveHistoryId(historyItemId);
      addTask({
        sourceType: 'agent',
        sourceId: agent.id,
        sourceName: agent.name,
        name: agent.name,
        content: acc,
        inputs: { prompt: text },
        cost: est.points,
        tokens: est.totalTokens,
        duration,
        result: { text: acc, kind: 'text' },
      });
      showToast('已生成 · 可继续追问');
    } catch (e) {
      // 流式失败：替换占位 assistant 为错误提示，避免与占位重复
      const errContent = '❌ 调用扣子失败：' + (e.message || e) + '\n请确认智能体的扣子配置（Base URL / API Token / Project ID）正确，且该项目已在扣子后台发布为 API 服务。';
      setMessages((prev) => {
        if (!prev.length) return prev;
        const next = prev.slice();
        next[next.length - 1] = { ...next[next.length - 1], content: errContent, role: 'assistant' };
        return next;
      });
      setResult(errContent);
    } finally {
      if (typewriterRef) { clearInterval(typewriterRef); typewriterRef = null; }
      setStreaming(false);
      setResult('');
    }
  };

  if (!agent) return <div className="p-10 text-center text-slate-500">智能体不存在</div>;

  const clearBtn = (
    <button
      onClick={startNewChat}
      className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0"
    >
      清空对话
    </button>
  );

  return (
    <div className="h-[calc(100vh-64px)] flex bg-[#f0f4f9] overflow-hidden">
      {/* Left: history (desktop) */}
      <aside className="hidden md:flex w-72 lg:w-80 bg-white/55 backdrop-blur border-r border-slate-200/50 flex-col shrink-0 rounded-t-2xl">
        <HistoryPanel
          label="新对话"
          items={agentHistory}
          activeId={activeHistoryId}
          onSelect={loadHistory}
          onNew={startNewChat}
          emptyHint="还没有对话记录，点击「新对话」开始第一次创作吧～"
        />
      </aside>

      {/* Center */}
      <div className="flex-1 flex flex-col min-w-0">
        <SubHeader
          entity={agent}
          type="agent"
          onToggleHistory={() => setHistoryOpen(true)}
          onToggleInfo={() => setInfoOpen(true)}
          right={clearBtn}
        />

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 lg:px-6 py-6">
          <div className="max-w-5xl mx-auto">
            {messages.length === 0 && !streaming && (
              <Welcome agent={agent} onPick={(s) => submit(s)} />
            )}

            {messages.map((m, i) => (
              <Bubble
                key={i}
                m={m}
                agent={agent}
                onCopy={() => copyToClipboard(m.content)}
                onRegenerate={() => regenerate(i)}
                onAsset={addToAsset}
              />
            ))}

            {streaming && !result && <Thinking agent={agent} />}
            {streaming && result && (
              <Bubble
                m={{ role: 'assistant', content: result }}
                agent={agent}
                onCopy={() => copyToClipboard(result)}
                onRegenerate={() => regenerate(messages.length)}
                onAsset={addToAsset}
              />
            )}
          </div>
        </div>

        <Composer input={input} setInput={setInput} onSubmit={() => submit()} streaming={streaming} attachments={attachments} setAttachments={setAttachments} />
      </div>

      {/* Right: info card (desktop) */}
      <aside className="hidden xl:flex w-72 bg-white/55 backdrop-blur border-l border-slate-200/50 flex-col shrink-0 rounded-t-2xl">
        <InfoCard entity={agent} type="agent" />
      </aside>

      {/* Mobile drawers */}
      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} side="left" title="对话历史">
        <HistoryPanel
          label="新对话"
          items={agentHistory}
          activeId={activeHistoryId}
          onSelect={loadHistory}
          onNew={startNewChat}
          emptyHint="还没有对话记录，点击「新对话」开始第一次创作吧～"
        />
      </Drawer>
      <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} side="right" title="智能体名片">
        <InfoCard entity={agent} type="agent" />
      </Drawer>

      {toast && <Toast msg={toast} />}
      {showLogin && <RequireLoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
