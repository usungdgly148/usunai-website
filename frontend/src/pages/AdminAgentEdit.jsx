import { useStore } from '../store.jsx';
import { testAgentConfig, saveAgentConfig, getAgentConfig, revealAgentToken, getCozeBotDetail } from '../cozeApi.js';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowLeft, Save, Eye, EyeOff, Plus, X, Trash2, KeyRound, MessageSquareText, Sparkles, Tag as TagIcon, Hash, ArrowUpDown, ListChecks } from 'lucide-react';
import { Card, AdminIconPicker, TutorialSettings, renderIcon, PrimaryButton, SecondaryButton } from '../adminUI.jsx';
import CozeBotPicker, { MOCK_PROVIDER_ID } from '../components/CozeBotPicker.jsx';
import { listKnowledgeBases } from '../knowledgeApi.js';

const COLOR_OPTIONS = ['bg-blue-600', 'bg-rose-600', 'bg-emerald-600', 'bg-amber-600', 'bg-violet-600', 'bg-slate-700', 'bg-cyan-600', 'bg-teal-600'];

const blankForm = {
  name: '', desc: '', category: 'copy', icon: 'FileText', iconColor: 'bg-blue-600',
  avatar: '', tags: [], published: false, vip: false, sortOrder: 999,
  tutorialImage: '', tutorialUrl: '', tutorialTitle: '新手使用教程',
  platform: 'coze-new', apiKey: '', baseUrl: '', projectId: '', botId: '', authProviderId: '',
  model: 'deepseek-v4-flash', thinkingEnabled: false, reasoningEffort: 'medium',
  instructions: '', contextMaxTokens: 32000, maxTokens: 8192,
  ragEnabled: false, knowledgeBaseIds: [], ragTopK: 5, ragThreshold: 0.3,
  opening: '', suggestedQuestions: [],
  priceType: 'token', priceRate: 6,
  gradientFrom: '#DBEAFE', gradientTo: '#FFFFFF', gradientAngle: 30,
};

const GRADIENT_PRESETS = {
  'bg-blue-600': { gradientFrom: '#DBEAFE', gradientTo: '#FFFFFF' },
  'bg-rose-600': { gradientFrom: '#FFE4E6', gradientTo: '#FFFFFF' },
  'bg-green-600': { gradientFrom: '#DCFCE7', gradientTo: '#FFFFFF' },
  'bg-emerald-600': { gradientFrom: '#D1FAE5', gradientTo: '#FFFFFF' },
  'bg-amber-600': { gradientFrom: '#FEF3C7', gradientTo: '#FFFFFF' },
  'bg-violet-600': { gradientFrom: '#EDE9FE', gradientTo: '#FFFFFF' },
  'bg-slate-700': { gradientFrom: '#F1F5F9', gradientTo: '#FFFFFF' },
  'bg-cyan-600': { gradientFrom: '#CFFAFE', gradientTo: '#FFFFFF' },
  'bg-teal-600': { gradientFrom: '#CCFBF1', gradientTo: '#FFFFFF' },
};
function gradientDefaults(iconColor) { return GRADIENT_PRESETS[iconColor] || { gradientFrom: '#F8FAFC', gradientTo: '#FFFFFF' }; }

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

// API Token 后端状态指示（避免 store 里的 '***' 占位与后端真实状态不一致导致误判）
function TokenStatusLine({ status, serverHasToken, isNew }) {
  if (status === 'loading') return <p className="text-xs text-slate-400 mt-1">⏳ 正在从后端读取 Token 状态…</p>;
  if (status === 'error') return <p className="text-xs text-rose-500 mt-1">⚠️ 后端读取失败，请确认后端服务已启动（npm run server）</p>;
  if (status === 'editing') return <p className="text-xs text-amber-600 mt-1">✏️ 已修改新 Token，点「保存」同步到后端</p>;
  if (status === 'saved' || serverHasToken) return <p className="text-xs text-emerald-600 mt-1">✓ 后端已保存真实 Token（输入框显示为明文，可直接查看/修改，点「保存」同步）</p>;
  if (isNew) return <p className="text-xs text-slate-400 mt-1">📝 新建项目，请填写 Token 并点「保存」</p>;
  return <p className="text-xs text-rose-500 mt-1">✗ 后端未保存 Token。请填写后点「保存」同步到后端</p>;
}

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';

// 16 个黑圆点（U+25CF）作为密码占位：浏览器 password 渲染时每字符变一个 •，主人看到 16 个点
// ⚠️ 必须在 useState 之前声明——TDZ 陷阱：const 不 hoist，下方 useState 初始化函数里就要用它
const TOKEN_MASK = '●●●●●●●●●●●●●●●●';

export default function AdminAgentEdit({ isNew: isNewProp }) {
  const { id } = useParams();
  const isNew = isNewProp || id === 'new';
  const navigate = useNavigate();
  const { agents, sortedCategories, updateAgent, addAgent, authProviders, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const existing = !isNew ? agents.find(a => a.id === id) : null;

  const [form, setForm] = useState(() => {
    if (existing) {
      const defaults = gradientDefaults(existing.iconColor || 'bg-blue-600');
      // 输入框不预填占位（避免主人误以为是真实 Token 内容）——一律空，让主人重新填或保持黑点占位
      const initApiKey = (existing.apiKey === '***' || existing.apiKey === TOKEN_MASK || !existing.apiKey) ? '' : existing.apiKey;
      return { ...blankForm, ...defaults, ...existing, apiKey: initApiKey, authProviderId: existing.authProviderId || '' };
    }
    const firstValid = sortedCategories.find(c => c.id !== 'all' && c.published !== false);
    return { ...blankForm, category: firstValid?.id || '' };
  });
  // 标记：服务端是否已持有 Token（编辑页打开时从后端拉真实状态覆盖 store 的脱敏占位推断）
  const [serverHasToken, setServerHasToken] = useState(false);
  const [tokenStatus, setTokenStatus] = useState('loading'); // 'loading' | 'saved' | 'missing' | 'error'
  const [showToken, setShowToken] = useState(false); // 默认密码暗文（按主人要求，避免一打开就看到明文）
  // 眼睛点开时从后端一次性拉真明文，存到这个 state；关闭眼睛时清空（不持久化）
  const [revealToken, setRevealToken] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState(null); // {ok, msg}
  const [pickerOpen, setPickerOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    listKnowledgeBases().then(data => setKnowledgeBases(data.items || [])).catch(() => setKnowledgeBases([]));
  }, []);

  // 列表选择对话框：选中智能体后同步名称/简介/头像，并拉取详情回填开场白与建议问题
  const onPickBot = async (bot) => {
    setPickerOpen(false);
    if (!bot) return;
    if (bot.bot_id) set({ botId: bot.bot_id });
    if (bot.bot_name && !form.name) set({ name: bot.bot_name });
    if (bot.description && !form.desc) set({ desc: bot.description });
    if (bot.icon_url && !form.avatar) set({ avatar: bot.icon_url });
    setFetching(true);
    setFetchMsg(null);
    try {
      const useMock = form.authProviderId === MOCK_PROVIDER_ID;
      const r = await getCozeBotDetail({ authProviderId: form.authProviderId, botId: bot.bot_id, mock: useMock });
      if (r.ok && r.bot) {
        const b = r.bot;
        if (b.bot_name && !form.name) set({ name: b.bot_name });
        if (b.description && !form.desc) set({ desc: b.description });
        if (b.icon_url && !form.avatar) set({ avatar: b.icon_url });
        if (b.opening_dialog) set({ opening: b.opening_dialog });
        if (Array.isArray(b.suggested_questions) && b.suggested_questions.length) {
          set({ suggestedQuestions: b.suggested_questions.slice(0, 5) });
        }
        setFetchMsg({ ok: true, msg: '已导入智能体信息（名称 / 简介 / 头像 / 开场白 / 建议问题）' });
      } else {
        setFetchMsg({ ok: true, msg: '已填入 Bot ID，但拉取详情失败：' + (r.error || '未知错误') });
      }
    } catch (e) {
      setFetchMsg({ ok: false, msg: '拉取详情异常：' + (e.message || e) });
    } finally {
      setFetching(false);
    }
  };

  // 智能获取：按当前 Bot ID + 授权凭证拉取详情并回填
  const smartFetch = async () => {
    if (!form.botId.trim()) { setFetchMsg({ ok: false, msg: '请先填写或选择 Bot ID' }); return; }
    if (!form.authProviderId) { setFetchMsg({ ok: false, msg: '请先选择授权凭证（或选「演示授权」）' }); return; }
    setFetching(true);
    setFetchMsg(null);
    try {
      const useMock = form.authProviderId === MOCK_PROVIDER_ID;
      const r = await getCozeBotDetail({ authProviderId: form.authProviderId, botId: form.botId.trim(), mock: useMock });
      if (r.ok && r.bot) {
        const b = r.bot;
        if (b.bot_name && !form.name) set({ name: b.bot_name });
        if (b.description && !form.desc) set({ desc: b.description });
        if (b.icon_url && !form.avatar) set({ avatar: b.icon_url });
        if (b.opening_dialog) set({ opening: b.opening_dialog });
        if (Array.isArray(b.suggested_questions) && b.suggested_questions.length) set({ suggestedQuestions: b.suggested_questions.slice(0, 5) });
        setFetchMsg({ ok: true, msg: '智能获取成功：已同步开场白与建议问题' });
      } else {
        setFetchMsg({ ok: false, msg: '智能获取失败：' + (r.error || '未知错误') });
      }
    } catch (e) {
      setFetchMsg({ ok: false, msg: '请求异常：' + (e.message || e) });
    } finally {
      setFetching(false);
    }
  };

  // 进入编辑页时拉后端真实 Token 状态（避免 store 里的占位误判）
  useEffect(() => {
    if (isNew) {
      setServerHasToken(false);
      setTokenStatus('missing');
      return;
    }
    let cancelled = false;
    getAgentConfig(id).then((r) => {
      if (cancelled) return;
      if (r?.ok !== false) {
        const { apiKey: ignoredApiKey, ...safeConfig } = r || {};
        setForm(prev => ({
          ...prev,
          ...safeConfig,
          knowledgeBaseIds: Array.isArray(r?.knowledgeBaseIds) ? r.knowledgeBaseIds : prev.knowledgeBaseIds,
        }));
      }
      if (r && r.hasToken) {
        setServerHasToken(true);
        setTokenStatus('saved');
      } else {
        setServerHasToken(false);
        setTokenStatus('missing');
      }
    }).catch(() => {
      if (cancelled) return;
      setTokenStatus('error');
    });
    return () => { cancelled = true; };
  }, [id, isNew]);

  const platformOptions = [
    { key: 'coze-new', label: 'Coze 新版', desc: 'Project ID + API Token' },
    { key: 'coze-old', label: 'Coze 旧版', desc: 'Bot ID + 授权凭证' },
    { key: 'deepseek-native', label: 'DeepSeek 原生模型', desc: '服务器凭证 + 真正流式输出' },
  ];

  const onSelectPlatform = (key) => {
    const patch = { platform: key };
    if (key === 'coze-old' && !form.baseUrl.trim()) patch.baseUrl = 'https://api.coze.cn';
    set(patch);
    setFetchMsg(null);
  };

  // 脱敏占位：'***' 表示服务端已有 Token，不回写；否则本地只存占位，真实 Token 落在后端
  const maskOf = (raw) => (raw === '***' ? '***' : (raw && raw.trim() ? '***' : (serverHasToken ? '***' : '')));

  // 眼睛按钮：关 → 后端拉真明文 + 切到 text 只读模式；开 → 清空明文 + 切回 password 占位
  const toggleReveal = async () => {
    if (showToken) {
      setShowToken(false);
      setRevealToken(null);
      return;
    }
    // 关 → 拉真明文
    if (revealToken !== null) {
      setShowToken(true);
      return;
    }
    if (isNew || !id) {
      // 新建 / 无 id → 用 form.apiKey（可能为空或主人已输入的新值）
      setRevealToken(form.apiKey || '');
      setShowToken(true);
      return;
    }
    setRevealing(true);
    try {
      const r = await revealAgentToken(id);
      if (r && typeof r.apiKey === 'string') {
        setRevealToken(r.apiKey);
        setShowToken(true);
      } else {
        window.alert('拉取 Token 失败：' + (r?.error || '未知错误'));
      }
    } catch (e) {
      window.alert('拉取 Token 异常：' + (e.message || e));
    } finally {
      setRevealing(false);
    }
  };

  // 测试连接 / 检测项目：编辑已有 agent 时优先用后端已存的 Token（避免每次测试都重输）
  const testConn = async () => {
    if (form.platform === 'coze-old') {
      if (!form.authProviderId) { setFetchMsg({ ok: false, msg: '请先选择授权凭证（或选「演示授权」）' }); return; }
      if (form.authProviderId === MOCK_PROVIDER_ID) {
        setFetchMsg({ ok: true, msg: '演示模式连接成功（使用本地演示数据，未真实请求扣子）' });
        return;
      }
      setFetching(true);
      setFetchMsg(null);
      try {
        const r = await testAgentConfig({ platform: 'coze-old', authProviderId: form.authProviderId });
        if (r.ok) setFetchMsg({ ok: true, msg: r.msg || '授权凭证有效，连接成功' });
        else setFetchMsg({ ok: false, msg: '连接失败：' + (r.error || r.status || '未知错误') });
      } catch (e) {
        setFetchMsg({ ok: false, msg: '请求异常：' + (e.message || e) });
      } finally {
        setFetching(false);
      }
      return;
    }
    if (form.platform === 'coze-new') {
      if (!form.baseUrl.trim()) { setFetchMsg({ ok: false, msg: '请填写 Base URL' }); return; }
      if (!/^https?:\/\//i.test(form.baseUrl)) { setFetchMsg({ ok: false, msg: 'Base URL 需以 http:// 或 https:// 开头' }); return; }
      if (!form.projectId.trim()) { setFetchMsg({ ok: false, msg: '请填写扣子 Project ID' }); return; }
    }
    if (!form.apiKey.trim()) {
      setFetchMsg({ ok: false, msg: form.platform === 'coze-new' ? '请填写 API Token' : '请填写 PAT 个人访问令牌' });
      return;
    }
    setFetching(true);
    setFetchMsg(null);
    try {
      const r = await testAgentConfig({
        platform: form.platform,
        baseUrl: form.baseUrl.trim(),
        // coze-new 直接传明文 apiKey；空则后端用 KV 里已有的真实 token
        apiKey: form.apiKey || '',
        projectId: form.projectId.trim(),
        botId: form.botId.trim(),
        agentId: isNew ? '' : id, // 已有 agent → 后端可从 KV 拿 token；新建 → 必须传明文
      });
      if (r.ok) {
        if (form.platform === 'coze-new') {
          set({ opening: r.answer || form.opening });
          const len = (r.answer || '').length;
          setFetchMsg({ ok: true, msg: len > 0 ? `项目连接成功，开场白已自动回填（${len} 字）` : '项目连接成功，但智能体未返回介绍内容（可能开场白未配置）' });
        } else {
          setFetchMsg({ ok: true, msg: '连接成功，PAT 有效' });
        }
      } else {
        setFetchMsg({ ok: false, msg: '连接失败：' + (r.error || r.status || '未知错误') });
      }
    } catch (e) {
      setFetchMsg({ ok: false, msg: '请求异常：' + (e.message || e) });
    } finally {
      setFetching(false);
    }
  };

  // 保存到本地 store（用 TOKEN_MASK 占位，浏览器不落明文）+ 同步配置到后端（后端持有真实 Token）
  // addAgent / updateAgent 已改为 async + persistKey（显式写回服务端，替代旧 debounce 全表 PUT），
  // 因此这里必须 await，否则拿到的会是 Promise 而非真实 id。
  const persist = async () => {
    if (!form.name.trim()) { window.alert('请先填写名称'); return null; }
    if (form.platform === 'deepseek-native' && !form.authProviderId) { window.alert('请先选择 DeepSeek 授权凭证'); return null; }
    // 明文保存：本地 store（localStorage）也存真实 apiKey，不再用 TOKEN_MASK 占位
    const storeForm = { ...form, apiKey: form.apiKey || '' };
    if (isNew) { const nid = await addAgent(storeForm); return nid; }
    const ok = await updateAgent(id, storeForm);
    return ok ? id : null;
  };
  const pushToBackend = async (aid) => {
    const cfg = {
      platform: form.platform,
      baseUrl: form.baseUrl.trim(),
      // coze-new：直接传真实 apiKey（明文保存）；coze-old 的令牌在授权中心，不在此传
      apiKey: form.platform === 'coze-new' ? (form.apiKey || '') : '',
      projectId: form.projectId.trim(),
      botId: form.botId.trim(),
      authProviderId: form.authProviderId || '',
      authType: form.platform === 'oauth' ? 'oauth' : 'apikey',
      model: form.model,
      thinkingEnabled: Boolean(form.thinkingEnabled),
      reasoningEffort: form.reasoningEffort || 'medium',
      instructions: form.instructions || '',
      contextMaxTokens: Number(form.contextMaxTokens) || 32000,
      maxTokens: Number(form.maxTokens) || 8192,
      ragEnabled: Boolean(form.ragEnabled),
      knowledgeBaseIds: Array.isArray(form.knowledgeBaseIds) ? form.knowledgeBaseIds : [],
      ragTopK: Number(form.ragTopK) || 5,
      ragThreshold: Number(form.ragThreshold) || 0.3,
    };
    try {
      const r = await saveAgentConfig(aid, cfg);
      if (r?.hasToken) {
        setServerHasToken(true);
        setTokenStatus('saved');
        // 保存成功后：本地 store 留脱敏占位（浏览器不落明文），输入框渲染为密码黑点（不让主人看到空白）
        set({ apiKey: TOKEN_MASK });
      } else {
        setServerHasToken(false);
        setTokenStatus('missing');
      }
      return r;
    } catch (e) {
      window.alert('已保存到本地，但同步到后端失败：' + (e.message || e) + '。请确认后端服务已启动（npm run server）。');
      return null;
    }
  };
  const onSave = async () => { const aid = await persist(); if (aid != null) await pushToBackend(aid); if (aid != null) navigate('/admin/agents'); };
  const onPreview = async () => { const aid = await persist(); if (aid) { await pushToBackend(aid); window.open(`/chat/${aid}`, '_blank'); } };

  const addTag = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      set({ tags: [...form.tags, e.target.value.trim()] });
      e.target.value = '';
    }
  };
  const addQuestion = () => {
    if (form.suggestedQuestions.length >= 5) return;
    set({ suggestedQuestions: [...form.suggestedQuestions, ''] });
  };
  const setQuestion = (i, v) => set({ suggestedQuestions: form.suggestedQuestions.map((q, idx) => idx === i ? v : q) });
  const removeQuestion = (i) => set({ suggestedQuestions: form.suggestedQuestions.filter((_, idx) => idx !== i) });

  const catName = (cid) => sortedCategories.find(c => c.id === cid)?.name || '未分类';
  const validCategoryIds = new Set(sortedCategories.filter(c => c.id !== 'all').map(c => c.id));
  const categoryInvalid = form.category && !validCategoryIds.has(form.category);

  return (
    <div className="space-y-5">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/admin/agents')} className="w-9 h-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 truncate">{isNew ? '新建智能体' : form.name || '编辑智能体'}</h1>
            <p className="text-xs text-slate-400">平台：{form.platform === 'coze-new' ? 'Coze 新版' : 'Coze 旧版'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={onPreview} className="gap-1.5"><Eye size={15} /> 预览前台</SecondaryButton>
          <PrimaryButton onClick={onSave} className="gap-1.5"><Save size={15} /> 保存</PrimaryButton>
        </div>
      </div>

      {/* 三栏 */}
      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr_320px] gap-5 items-start">
        {/* 左：基础信息 */}
        <Card className="p-5 space-y-5">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Sparkles size={16} className="text-blue-600" /> 基础信息</h2>
          <Field label="头像 / 图标">
            <AdminIconPicker icon={form.icon} avatar={form.avatar} onIconChange={v => set({ icon: v })} onAvatarChange={v => set({ avatar: v })} color={form.iconColor} />
          </Field>
          <Field label="名称" hint="前台展示的项目名称">
            <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="如：获客成交型文案" className={inputCls} />
          </Field>
          <Field label="所属分类">
            <select value={form.category} onChange={e => set({ category: e.target.value })} className={inputCls}>
              <option value="" disabled>请选择分类</option>
              {categoryInvalid && <option value={form.category} disabled>{form.category}（未匹配，请选择有效分类）</option>}
              {sortedCategories.filter(c => c.id !== 'all').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="简介" hint="一句话描述，用于前台卡片">
            <textarea value={form.desc} onChange={e => set({ desc: e.target.value })} rows={3} placeholder="这个智能体能帮用户解决什么？" className={`${inputCls} resize-none`} />
          </Field>
          <Field label="标签" hint="回车添加，如：获客 / 文案 / 朋友圈">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs">
                  {t} <button onClick={() => set({ tags: form.tags.filter(x => x !== t) })}><X size={12} /></button>
                </span>
              ))}
            </div>
            <input onKeyDown={addTag} placeholder="输入标签后回车" className={inputCls} />
          </Field>
          <TutorialSettings
            image={form.tutorialImage}
            url={form.tutorialUrl}
            title={form.tutorialTitle}
            onChange={set}
          />
          <Field label="图标颜色">
            <div className="flex gap-2 flex-wrap">
              {COLOR_OPTIONS.map(c => (
                <button type="button" key={c} onClick={() => set({ iconColor: c })}
                  className={`w-7 h-7 rounded-full ${c} ${form.iconColor === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`} />
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="卡片渐变起始色" hint="建议与图标颜色同色系">
              <div className="flex items-center gap-2">
                <input type="color" value={form.gradientFrom} onChange={e => set({ gradientFrom: e.target.value })} className="w-10 h-9 p-0 border border-slate-200 rounded-lg cursor-pointer" />
                <input value={form.gradientFrom} onChange={e => set({ gradientFrom: e.target.value })} className={inputCls} />
              </div>
            </Field>
            <Field label="卡片渐变结束色" hint="通常为白色或更浅色">
              <div className="flex items-center gap-2">
                <input type="color" value={form.gradientTo} onChange={e => set({ gradientTo: e.target.value })} className="w-10 h-9 p-0 border border-slate-200 rounded-lg cursor-pointer" />
                <input value={form.gradientTo} onChange={e => set({ gradientTo: e.target.value })} className={inputCls} />
              </div>
            </Field>
          </div>
          <Field label="卡片渐变角度" hint="0–360°，决定渐变倾斜方向，默认 30°">
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="360" value={form.gradientAngle} onChange={e => set({ gradientAngle: Number(e.target.value) })} className="flex-1 accent-blue-600" />
              <div className="flex items-center gap-1">
                <input type="number" min="0" max="360" value={form.gradientAngle} onChange={e => set({ gradientAngle: Math.max(0, Math.min(360, Number(e.target.value) || 0)) })} className={`${inputCls} w-16 text-center`} />
                <span className="text-slate-400 text-xs">°</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[0, 30, 45, 90, 135, 180].map(a => (
                <button type="button" key={a} onClick={() => set({ gradientAngle: a })}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition ${Number(form.gradientAngle) === a ? 'border-blue-500 bg-blue-50 text-blue-600 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{a}°</button>
              ))}
            </div>
          </Field>
          <div>
            <div className="text-xs text-slate-400 mb-1.5">渐变预览</div>
            <div className="h-12 rounded-lg border border-slate-200" style={{ background: `linear-gradient(${Number(form.gradientAngle) || 30}deg, ${form.gradientFrom}, ${form.gradientTo})` }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="排序权重">
              <input type="number" value={form.sortOrder} onChange={e => set({ sortOrder: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="算力定价(点/千token)">
              <input type="number" value={form.priceRate} onChange={e => set({ priceRate: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          <label className="flex items-center justify-between pt-1">
            <span className="text-sm font-medium text-slate-700">立即上架</span>
            <button type="button" onClick={() => set({ published: !form.published })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.published ? 'bg-blue-600' : 'bg-slate-200'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.published ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between pt-1">
            <span className="text-sm font-medium text-slate-700">VIP 专享</span>
            <button type="button" onClick={() => set({ vip: !form.vip })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${form.vip ? 'bg-amber-500' : 'bg-slate-200'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.vip ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
        </Card>

        {/* 中：Coze 参数 */}
        <div className="space-y-5">
          <Card className="p-5 space-y-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2"><KeyRound size={16} className="text-blue-600" /> 智能体平台与连接</h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">智能体平台</label>
              <div className="flex flex-wrap gap-2">
                {platformOptions.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onSelectPlatform(p.key)}
                    className={`flex-1 min-w-[140px] text-left px-4 py-3 rounded-xl border text-sm transition ${form.platform === p.key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="text-[11px] opacity-70 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {form.platform === 'coze-new' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  新版扣子编程项目只有 Project ID，没有 Bot ID。调用前需先在扣子后台将项目「部署为 API 服务」，获得 API 域名和 API Token。
                </p>
                <Field label="Base URL" hint="扣子项目部署后的 API 域名，如 https://xxxx.coze.site">
                  <input value={form.baseUrl} onChange={e => set({ baseUrl: e.target.value })} placeholder="https://xxxx.coze.site" className={inputCls} />
                </Field>
                <Field label="API Token" hint="扣子部署页面「管理 API Token」中创建的 Token；输入框直接显示真实 Token 字符串，点「保存」后明文保存到后端与浏览器本地（仅本后台可见）">
                  <div className="relative">
                    <input
                      type="text"
                      value={form.apiKey || ''}
                      onChange={e => {
                        set({ apiKey: e.target.value });
                        setTokenStatus('editing');
                      }}
                      placeholder="部署 API Token（如 pat_xxxxxxxx）"
                      className={`${inputCls} font-mono text-xs`}
                    />
                  </div>
                  <TokenStatusLine status={tokenStatus} serverHasToken={serverHasToken} isNew={isNew} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                  <Field label="Project ID" hint="code.coze.cn/p/xxxx 中的数字">
                    <input value={form.projectId} onChange={e => set({ projectId: e.target.value })} placeholder="7645663971659350051" className={inputCls} />
                  </Field>
                  <button
                    type="button"
                    onClick={testConn}
                    disabled={fetching}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition shrink-0 mb-[2px]"
                  >
                    {fetching ? '测试中…' : '测试连接'}
                  </button>
                </div>
              </div>
            )}

            {form.platform === 'coze-old' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  旧版 Coze Bot API，使用 Bot ID + 授权中心凭证调用 /v3/chat。PAT / OAuth 令牌统一在后台「授权中心」配置，这里只选择已开通的授权，页面不暴露明文令牌。
                </p>
                <Field label="选择授权凭证" hint="在后台「授权中心」已开通的 Coze 授权，其 PAT 用于拉取空间与智能体列表">
                  <select
                    value={form.authProviderId}
                    onChange={e => {
                      const pid = e.target.value;
                      const patch = { authProviderId: pid };
                      const prov = authProviders.find(p => p.id === pid);
                      if (prov && prov.baseUrl) patch.baseUrl = prov.baseUrl; // 同步授权中心的 Base URL，供运行时调用
                      set(patch);
                      setFetchMsg(null);
                    }}
                    className={inputCls}
                  >
                    <option value="">请选择授权凭证</option>
                    {authProviders.filter(p => p.status !== 'disabled').map(p => (
                      <option key={p.id} value={p.id}>{p.name}（{p.type === 'oauth' ? 'OAuth' : 'PAT'}）</option>
                    ))}
                    <option value={MOCK_PROVIDER_ID}>（演示授权 · 无需真实账号）</option>
                  </select>
                  {authProviders.length === 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">授权中心暂无授权，可先到后台「授权中心」新增；或选择上方「演示授权」离线体验。</p>
                  )}
                </Field>
                <Field label="Bot ID" hint="旧版 Coze 智能体的 Bot ID；可点「列表选择」从授权账号空间里挑选，或手动填写">
                  <div className="flex gap-2">
                    <input value={form.botId} onChange={e => set({ botId: e.target.value })} placeholder="748xxxxxxxx" className={inputCls} />
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm whitespace-nowrap hover:bg-slate-50 flex items-center gap-1.5"
                    >
                      <ListChecks size={15} /> 列表选择
                    </button>
                  </div>
                </Field>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={smartFetch}
                    disabled={fetching}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-40 transition"
                  >
                    {fetching ? '获取中…' : '智能获取'}
                  </button>
                  <button
                    type="button"
                    onClick={testConn}
                    disabled={fetching}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition"
                  >
                    {fetching ? '测试中…' : '测试连接'}
                  </button>
                </div>
              </div>
            )}

            {form.platform === 'deepseek-native' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  API Key 由授权中心加密保存在服务器。浏览器只保存凭证 ID；对话强制使用服务器 SSE 流式输出。
                </p>
                <Field label="DeepSeek 授权凭证">
                  <select value={form.authProviderId} onChange={e => set({ authProviderId: e.target.value })} className={inputCls}>
                    <option value="">请选择授权凭证</option>
                    {authProviders.filter(p => p.type === 'deepseek' && p.status !== 'disabled').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="模型">
                  <select value={form.model} onChange={e => set({ model: e.target.value })} className={inputCls}>
                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                </Field>
                <p className="text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                  纯文字对话使用所选模型；用户上传图片时，服务端会自动切换到 DeepSeek 官方视觉模型 deepseek-v4-flash-vision-exp。
                </p>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-700">展示思考过程</span>
                  <input type="checkbox" checked={form.thinkingEnabled} onChange={e => set({ thinkingEnabled: e.target.checked })} />
                </label>
                {form.thinkingEnabled && <Field label="思考强度"><select value={form.reasoningEffort} onChange={e => set({ reasoningEffort: e.target.value })} className={inputCls}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field>}
                <Field label="System Prompt" hint="只用于约束智能体行为；用户输入仍由前端对话框提供。">
                  <textarea rows={8} value={form.instructions} onChange={e => set({ instructions: e.target.value })} className={`${inputCls} resize-y`} placeholder="请输入系统提示词" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="上下文上限"><input type="number" min="1024" value={form.contextMaxTokens} onChange={e => set({ contextMaxTokens: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="单次输出上限"><input type="number" min="256" value={form.maxTokens} onChange={e => set({ maxTokens: Number(e.target.value) })} className={inputCls} /></Field>
                </div>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-700">启用 RAG 知识库</span>
                  <input type="checkbox" checked={form.ragEnabled} onChange={e => set({ ragEnabled: e.target.checked })} />
                </label>
                {form.ragEnabled && <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div className="text-sm font-medium text-slate-700">绑定知识库（可多选）</div>
                  {knowledgeBases.filter(kb => kb.status !== 'inactive').map(kb => <label key={kb.id} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.knowledgeBaseIds.includes(kb.id)} onChange={e => set({ knowledgeBaseIds: e.target.checked ? [...form.knowledgeBaseIds, kb.id] : form.knowledgeBaseIds.filter(id => id !== kb.id) })} />{kb.name}<span className="text-xs text-slate-400">{kb.readyDocumentCount || 0} 个文档</span></label>)}
                  {!knowledgeBases.length && <div className="text-xs text-amber-600">请先到“知识库”页面创建并上传文档。</div>}
                  <div className="grid grid-cols-2 gap-3"><Field label="召回条数"><input type="number" min="1" max="20" value={form.ragTopK} onChange={e => set({ ragTopK: Number(e.target.value) })} className={inputCls} /></Field><Field label="相似度阈值"><input type="number" min="0" max="1" step="0.05" value={form.ragThreshold} onChange={e => set({ ragThreshold: Number(e.target.value) })} className={inputCls} /></Field></div>
                </div>}
              </div>
            )}

            <CozeBotPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              authProviderId={form.authProviderId}
              onPick={onPickBot}
            />

            {fetchMsg && (
              <div className={`text-xs px-3 py-2 rounded-lg ${fetchMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {fetchMsg.msg}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2"><MessageSquareText size={16} className="text-blue-600" /> 对话配置</h2>
            <Field label="开场白（Opening）" hint="用户进入聊天页看到的引导文字">
              <textarea value={form.opening} onChange={e => set({ opening: e.target.value })} rows={5} placeholder="请输入开场引导语..." className={`${inputCls} resize-none`} />
            </Field>
            <Field label={`建议问题（最多 5 个，对应开场小字按钮）`}>
              <div className="space-y-2">
                {form.suggestedQuestions.map((q, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={q} onChange={e => setQuestion(i, e.target.value)} placeholder={`建议问题 ${i + 1}`} className={inputCls} />
                    <button onClick={() => removeQuestion(i)} className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 shrink-0"><Trash2 size={15} /></button>
                  </div>
                ))}
                {form.suggestedQuestions.length < 5 && (
                  <button onClick={addQuestion} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"><Plus size={14} /> 添加问题</button>
                )}
              </div>
            </Field>
          </Card>
        </div>

        {/* 右：实时预览 */}
        <Card className="p-5 space-y-4 xl:sticky xl:top-24">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2"><Eye size={16} className="text-blue-600" /> 前台预览</h2>
          <div className="rounded-xl bg-slate-50 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl ${form.iconColor} text-white flex items-center justify-center overflow-hidden shadow-sm`}>
                {form.avatar ? <img src={form.avatar} alt="" className="w-full h-full object-cover" /> : renderIcon(form.icon, 22)}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-900 truncate">{form.name || '未命名智能体'}</div>
                <div className="text-xs text-slate-400">{catName(form.category)}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500 line-clamp-2">{form.desc || '暂无简介'}</p>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {form.tags.map(t => <span key={t} className="px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-500 text-[10px]">{t}</span>)}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1.5">开场白效果</div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 whitespace-pre-wrap max-h-40 overflow-auto">
              {form.opening || '（未设置开场白）'}
            </div>
          </div>
          {form.suggestedQuestions.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1.5">建议问题按钮</div>
              <div className="flex flex-wrap gap-1.5">
                {form.suggestedQuestions.filter(Boolean).map((q, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[11px]">{q}</span>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-slate-400 flex items-center gap-1">
            <ArrowUpDown size={12} /> 上架后将在「{catName(form.category)}」分类下展示
          </div>
        </Card>
      </div>
    </div>
  );
}
