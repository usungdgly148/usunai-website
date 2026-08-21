import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { MOCK_AGENTS, MOCK_WORKFLOWS, MOCK_CATEGORIES, MOCK_CATEGORY_GROUPS, MOCK_ORDERS, MOCK_COMPUTES, MOCK_ADMIN_USERS, MOCK_COMPUTE_PACKAGES, MOCK_ADMIN_ACCOUNTS, MOCK_OPERATION_LOGS, MOCK_BANNERS, MOCK_RECOMMENDED, MOCK_ASSETS } from './mock.js';
import { tryWriteSingleKey, tryDeleteSingleKey } from './singleKeySync.js';
import { apiFetch, adminFetch, getToken, setToken, clearToken, getAdminToken, setAdminToken, clearAdminToken } from './authFetch.js';

// ===== 算力套餐有效期 =====
const DAY_MS = 86400000;
// 日期/Date → YYYY-MM-DD（仅日期，忽略时分秒与时区误差）
export function formatPlanDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
// 用户绑定「最近一次套餐」的有效期：
//   planValidDays === 0 表示永久有效；否则按 planValidFrom + planValidDays 天计算到期。
// 返回值：hasPlan(是否有套餐约束) / expired(是否已过期) / validTo(到期日 Date) / remainingDays(剩余天数)
export function getUserPlanStatus(u) {
  // 没有 planValidFrom 视为未绑定套餐；planValidDays 可以是 0（永久），不能用 !planValidDays 拦截
  if (!u || !u.planValidFrom) {
    return { hasPlan: false, expired: false, validTo: null, remainingDays: null, permanent: false };
  }
  const from = new Date(u.planValidFrom).getTime();
  if (Number.isNaN(from)) return { hasPlan: false, expired: false, validTo: null, remainingDays: null, permanent: false };
  if (u.planValidDays === 0) {
    return { hasPlan: true, expired: false, validTo: null, remainingDays: Infinity, permanent: true };
  }
  const to = from + u.planValidDays * DAY_MS;
  const now = Date.now();
  return { hasPlan: true, expired: now > to, validTo: new Date(to), remainingDays: Math.max(0, Math.ceil((to - now) / DAY_MS)), permanent: false };
}

// 首页卖点卡片默认占位图：柔和 pastel 底色 + 中心白色圆盘 + 图标
const featureImage = (bg, accent, elements) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='520' height='320' viewBox='0 0 520 320'>
    <rect width='520' height='320' fill='${bg}' rx='28'/>
    <circle cx='260' cy='160' r='100' fill='white' opacity='0.35'/>
    <circle cx='260' cy='160' r='72' fill='white' opacity='0.95'/>
    ${elements}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};
const FEATURE_IMAGE = {
  ai: featureImage('#E0F2FE', '#3B82F6', `<path d='M260 130 L267 160 L297 165 L267 170 L260 200 L253 170 L223 165 L253 160 Z' fill='#3B82F6'/>`),
  target: featureImage('#DCFCE7', '#22C55E', `<circle cx='260' cy='160' r='32' fill='none' stroke='#22C55E' stroke-width='8'/><circle cx='260' cy='160' r='12' fill='#22C55E'/>`),
  value: featureImage('#FEF3C7', '#F59E0B', `<circle cx='260' cy='160' r='32' fill='#F59E0B'/><path d='M250 175 L260 150 L270 175' fill='none' stroke='white' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/>`),
  update: featureImage('#F3E8FF', '#9333EA', `<path d='M260 125 A35 35 0 1 1 235 185' fill='none' stroke='#9333EA' stroke-width='8' stroke-linecap='round'/><path d='M228 180 L238 190 L248 180' fill='none' stroke='#9333EA' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'/>`),
};

// 首页落地内容默认配置
const LANDING_DEFAULT = {
  heroTag: '为什么选择友尚AI',
  heroTitle: '专为实体老板打造的获客工具',
  heroSubtitle: '不懂文案、不会剪辑、没有团队——这些都不是问题。友尚AI让你用最少的时间，拿到最好的获客结果。',
  features: [
    { icon: 'Zap', title: '一键生成', desc: '输入行业和产品，30秒生成专业文案，不用再对着空白页发呆。', image: FEATURE_IMAGE.ai, label: 'AI 工具', linkText: '了解更多 →', linkHref: '/agents' },
    { icon: 'BarChart3', title: '行业垂直', desc: '不是通用AI，是针对15+实体行业深度优化的垂直模型，说行话、懂行规。', image: FEATURE_IMAGE.target, label: '行业方案', linkText: '了解更多 →', linkHref: '/agents' },
    { icon: 'Coins', title: '性价比高', desc: '一个会员=19个智能体，比雇一个文案便宜90%，效果还更好。', image: FEATURE_IMAGE.value, label: '成本优势', linkText: '了解更多 →', linkHref: '/agents' },
    { icon: 'RefreshCw', title: '持续更新', desc: '紧跟平台算法变化，每月更新模板和策略，你的获客能力持续升级。', image: FEATURE_IMAGE.update, label: '持续迭代', linkText: '了解更多 →', linkHref: '/agents' },
  ],
  cta: {
    title: '准备好让 AI 帮你获客了吗？',
    subtitle: '今天注册，立即解锁 20 次免费智能体调用，10 分钟生成你的第一条爆款内容。',
    primaryText: '免费开始使用',
    primaryLink: '/agents',
    secondaryText: '预约产品演示',
  },
  // 信任数据条（社会证明）：「主标题 + 副标题 + 数字」三段式结构（2026-08-03 改版）
  statsTitle: 'AI智能创作引擎',
  statsSubtitle: '内置多场景文案、图片、视频智能体和工作流，快速完成内容生产和创意生成',
  stats: [
    { value: '40+', label: '智能体' },
    { value: '6000+', label: '用户' },
    { value: '20w+', label: '使用次数' },
  ],
  // 客户成功案例：以「品牌 / 成效 / 描述 / 标签」四元组呈现真实获客结果
  cases: [
    { brand: '佛山瓷砖批发 · 李总', metric: '到店咨询 +300%', desc: '用小红书图文智能体批量产出种草笔记，3 个月沉淀 2000+ 精准线索，门店到店量翻了 3 倍。', tag: '瓷砖 / 建材' },
    { brand: '成都定制家居 · 王姐', metric: '抖音涨粉 1.2w', desc: '短视频口播智能体直接生成读稿文案，老板人设 IP 30 天起号成功，第一条视频即破万播放。', tag: '定制家具' },
    { brand: '武汉卫浴 · 陈经理', metric: '内容效率 ×10', desc: 'AI 工作流一键提取竞品爆款并改写，团队内容产出效率提升 10 倍，获客成本下降 60%。', tag: '卫浴' },
  ],
  // 信任背书：资质 / 服务保障图标条，强化转化前的信任
  badges: [
    { icon: 'ShieldCheck', text: '50+ 品牌在用' },
    { icon: 'Users', text: '3000+ 客户信赖' },
    { icon: 'ThumbsUp', text: '抖音 + 小红书 双平台' },
    { icon: 'Headphones', text: '7×12 专属客服' },
    { icon: 'Lock', text: '数据安全保障' },
  ],
  // 客户口碑：真实用户评价，放在 CTA 之前临门一脚
  testimonials: [
    { quote: '以前请个文案一个月要大几千，现在一个会员顶 19 个智能体，内容天天不断更。', author: '李总', role: '佛山瓷砖批发 · 门店老板' },
    { quote: '老板不懂拍视频，用口播智能体直接读稿，3 天就出了第一条爆款。', author: '王姐', role: '成都定制家居 · 创始人' },
    { quote: '工作流一键提取爆款文案，团队效率直接翻了好几倍，再也不用熬夜憋稿。', author: '陈经理', role: '武汉卫浴 · 运营负责人' },
  ],
  footer: {
    tagline: '让每一家实体企业都能用得起、用得好 AI 获客工具。',
    columns: [
      { title: '产品', links: [{ label: 'AI 智能体', href: '/agents' }, { label: 'AI 工作流', href: '/workflows' }, { label: '数据看板', href: '/compute-records' }, { label: '定价方案', href: '#' }] },
      { title: '资源', links: [{ label: '帮助中心', href: '#' }, { label: '使用教程', href: '#' }, { label: '行业案例', href: '#' }, { label: '博客更新', href: '#' }] },
      { title: '公司', links: [{ label: '关于我们', href: '#' }, { label: '加入我们', href: '#' }, { label: '联系我们', href: '#' }, { label: '商务合作', href: '#' }] },
    ],
    copyright: '© 2025 友尚 AI 企业实体获客平台. All rights reserved.',
    legalLinks: [{ label: '隐私政策', href: '#' }, { label: '服务条款', href: '#' }, { label: '粤ICP备2025460328号-3', href: 'https://beian.miit.gov.cn/' }],
  },
};

// 前台悬浮客服默认配置
const CUSTOMER_SERVICE_DEFAULT = {
  enabled: true,
  qr: '',
  lines: ['微信扫码联系客服', '工作日 9:00-18:00 在线', '为您解答产品与使用问题'],
};

// 智能体字段归一化：补全 Coze 新版配置、展示、定价、排序等缺失字段
const normalizeAgent = (a, i = 0) => ({
  platform: 'coze-new',
  apiKey: '',
  baseUrl: '',
  projectId: '',
  botId: '',
  suggestedQuestions: [],
  model: 'doubao-pro-32k',
  temperature: 0.7,
  maxTokens: 2048,
  avatar: '',
  tags: [],
  tutorialImage: '',
  tutorialUrl: '',
  tutorialTitle: '新手使用教程',
  published: true,
  sortOrder: (i + 1) * 10,
  views: 0,
  uses: 0,
  works: 0,
  rating: 5.0,
  cardGradient: 'bg-gradient-to-b from-slate-300 to-slate-100',
  cardBg: 'bg-gradient-to-br from-slate-50/60 to-white',
  ...a,
  id: a.id,
  kind: 'agent',
});

const normalizeWorkflow = (w, i = 0) => ({
  platform: 'coze-old',
  apiKey: '',
  baseUrl: '',
  projectId: '',
  botId: '',
  // 旧版扣子工作流
  authProviderId: '',            // 关联到 AI 授权管理里的 PAT 凭证
  workspaceId: '',               // 扣子工作流所属空间
  workflowId: '',                // 工作流 ID / Key
  workflowName: '',              // 智能获取时由扣子返回
  formFields: [],                // 输入字段（兼容旧结构：{ key, label, type, required, default, options, style, advanced, hint }）
  outputFields: [],              // 输出字段（从扣子导入：{ key, name, type, show, ... }）
  resultKind: 'text',            // 'text' | 'image' | 'video' | 'mixed'  影响前台结果区渲染
  avatar: '',
  tags: [],
  tutorialImage: '',
  tutorialUrl: '',
  tutorialTitle: '新手使用教程',
  published: true,
  sortOrder: (i + 1) * 10,
  views: 0,
  uses: 0,
  works: 0,
  rating: 5.0,
  cardGradient: 'bg-gradient-to-b from-slate-300 to-slate-100',
  cardBg: 'bg-gradient-to-br from-slate-50/60 to-white',
  ...w,
  id: w.id,
  kind: 'workflow',
});

// 轻量密码哈希（仅用于原型本地校验，非安全存储）
const hashPassword = (p) => {
  let h = 0;
  for (let i = 0; i < p.length; i++) { h = (h << 5) - h + p.charCodeAt(i); h |= 0; }
  return 'p' + h;
};

const StoreContext = createContext(null);

const historyRecordKey = (item) => String(item?.id ?? '');
const validHistoryMessages = (item) => (Array.isArray(item?.messages) ? item.messages : [])
  .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string');

// 历史记录按服务端使用的稳定会话 ID 聚合。数组按最新在前保存；修复前同一个会话
// 每追问一次就插入一条同 ID 快照，这里会把这些旧快照合并为一条完整多轮会话。
// userId 仍保存在记录中用于前端筛选，但不参与键值，和 hist_<id> 服务端键保持一致。
const collapseHistoryById = (items) => {
  const groups = new Map();
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item || item.id == null) continue;
    const key = historyRecordKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return Array.from(groups.values()).map((records) => {
    if (records.length === 1) return records[0];

    const timestamp = (item) => Date.parse(item?.updatedAt || item?.createdAt || '') || 0;
    const chronological = records.slice().sort((a, b) => timestamp(a) - timestamp(b));
    const earliest = chronological[0];
    const latest = chronological[chronological.length - 1];
    const richest = records.reduce((best, item) => (
      validHistoryMessages(item).length > validHistoryMessages(best).length ? item : best
    ), records[0]);
    const richMessages = validHistoryMessages(richest);
    const reconstructedMessages = chronological.flatMap((item) => {
      const pair = [];
      const prompt = item.userPrompt || item.title;
      if (typeof prompt === 'string' && prompt) pair.push({ role: 'user', content: prompt });
      if (typeof item.content === 'string' && item.content) pair.push({ role: 'assistant', content: item.content });
      return pair;
    });
    const messages = richMessages.length ? richMessages : reconstructedMessages;
    const merged = {
      ...latest,
      title: earliest.title || latest.title,
      userPrompt: earliest.userPrompt || latest.userPrompt,
      createdAt: earliest.createdAt || latest.createdAt,
      updatedAt: latest.updatedAt || latest.createdAt,
      messages,
      roundCount: messages.filter(m => m.role === 'user').length,
    };
    if (!richMessages.length) {
      merged.cost = records.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
      merged.tokens = records.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0);
    }
    return merged;
  });
};

// 服务端仍是历史唯一真值；但若当前浏览器里留有修复前的同 ID 多条快照，优先用
// 本地已合并出的更完整 transcript 丰富同一条服务端记录，不恢复服务端已删除的本地记录。
const mergeHydratedHistory = (serverItems, localItems) => {
  const serverHistory = collapseHistoryById(serverItems);
  const localHistory = collapseHistoryById(localItems);
  const localByKey = new Map(localHistory.map(item => [historyRecordKey(item), item]));
  const serverKeys = new Set(serverHistory.map(historyRecordKey));
  const merged = serverHistory.map((serverItem) => {
    const localItem = localByKey.get(historyRecordKey(serverItem));
    if (!localItem) return serverItem;
    return validHistoryMessages(localItem).length > validHistoryMessages(serverItem).length
      ? { ...serverItem, ...localItem, id: serverItem.id, userId: serverItem.userId || localItem.userId }
      : serverItem;
  });
  // list-keys 与刚写入的单条历史存在短暂时序差时，不丢掉本地刚产生的会话；
  // 下一次 addHistory 会继续把完整快照覆盖写回服务端。
  for (const localItem of localHistory) {
    if (!serverKeys.has(historyRecordKey(localItem))) merged.push(localItem);
  }
  return merged.sort((a, b) => {
    const time = (item) => Date.parse(item?.updatedAt || item?.createdAt || '') || 0;
    return time(b) - time(a);
  });
};

export function StoreProvider({ children }) {
  // Auth
  const [user, setUser] = useState(() => {
    try {
      const savedUser = JSON.parse(localStorage.getItem('clone_user')) || null;
      if (savedUser) {
        // 余额以后台用户表（adminUsers）为真值：用后台最新 points 覆盖本地缓存的旧值
        const users = JSON.parse(localStorage.getItem('clone_admin_users')) || [];
        const latest = users.find(u => u.id === savedUser.id);
        if (latest && typeof latest.points === 'number') return { ...savedUser, points: latest.points };
      }
      return savedUser;
    } catch { return null; }
  });
  const [adminUser, setAdminUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_admin')) || null; } catch { return null; }
  });
  // 超级管理员密码（默认 13760887513，持久化到 localStorage）
  // 2026-08-03 商用安全：改密已服务端化（/api/auth/admin-change-password），此处仅保留本地展示用途
  const [adminPassword, setAdminPassword] = useState(() => {
    try { return localStorage.getItem('clone_admin_password') || '13760887513'; } catch { return '13760887513'; }
  });
  // 邮箱注册用户（含密码哈希），持久化到 localStorage
  const [registeredUsers, setRegisteredUsers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_registered_users')) || []; } catch { return []; }
  });

  // Data
  // 智能体/工作流：支持 localStorage 持久化，刷新后仍保留后台新增/编辑的内容
  const [agents, setAgents] = useState(() => {
    const seed = (arr) => arr.map((a, i) => normalizeAgent(a, i));
    try {
      const saved = JSON.parse(localStorage.getItem('clone_agents'));
      if (saved && Array.isArray(saved) && saved.length) return seed(saved);
    } catch { /* ignore */ }
    return seed(MOCK_AGENTS);
  });
  const [workflows, setWorkflows] = useState(() => {
    const seed = (arr) => arr.map((w, i) => normalizeWorkflow(w, i));
    try {
      const saved = JSON.parse(localStorage.getItem('clone_workflows'));
      if (saved && Array.isArray(saved) && saved.length) return seed(saved);
    } catch { /* ignore */ }
    return seed(MOCK_WORKFLOWS);
  });
  // 关键修复（2026-07-30）：React setState updater 是异步的，原 setAgents(prev => { next = ...; return next }) 写法
  // 在 persistAdminKey('agents', next) 调用时 next 还是 undefined，JSON.stringify 序列化为 {"key":"agents"}（undefined 被省略），
  // 服务端 kvPut 把 undefined 绑给 NOT NULL 列 → SqliteError: NOT NULL constraint failed: kv.value → HTTP 500。
  // 改用 ref 跟踪最新 state，配合 setAgents(next) 直接赋值，next 在 persistKey 调用前已确定。
  const agentsRef = useRef(agents);
  useEffect(() => { agentsRef.current = agents; }, [agents]);
  const workflowsRef = useRef(workflows);
  useEffect(() => { workflowsRef.current = workflows; }, [workflows]);
  // 分类：兼容旧 localStorage 数据（可能缺 showInSidebar / showInTags / showInHome / sortOrder / published 字段）
  const [categories, setCategories] = useState(() => {
    const seed = (arr, start = 0) => arr.map((c, i) => ({
      sortOrder: i * 10,
      showInSidebar: true,
      showInTags: true,
      showInHome: false,
      published: true,
      ...c,
      id: c.id,
    }));
    try {
      const saved = JSON.parse(localStorage.getItem('clone_categories'));
      if (saved && Array.isArray(saved) && saved.length) return seed(saved);
    } catch { /* ignore */ }
    return seed(MOCK_CATEGORIES);
  });
  // 大分组（前台左侧导航分组标题）：可在后台自由新建/重命名/删除/排序。
  // 安全网：把分类里出现但注册表缺失的分组名补进注册表，保证下拉与排序始终一致。
  const [categoryGroups, setCategoryGroups] = useState(() => {
    const mergeMissing = (list) => {
      try {
        const cats = JSON.parse(localStorage.getItem('clone_categories'));
        const names = new Set(list.map(g => g.name));
        let max = list.reduce((m, g) => Math.max(m, g.sortOrder || 0), 0);
        (cats || []).forEach(c => {
          if (c.group && !names.has(c.group)) {
            names.add(c.group);
            max += 10;
            list.push({ id: 'cg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: c.group, sortOrder: max });
          }
        });
      } catch { /* ignore */ }
      return list;
    };
    try {
      const saved = JSON.parse(localStorage.getItem('clone_category_groups'));
      if (saved && Array.isArray(saved) && saved.length) return mergeMissing(saved);
    } catch { /* ignore */ }
    return mergeMissing(MOCK_CATEGORY_GROUPS.map((g, i) => ({ ...g, sortOrder: g.sortOrder || (i + 1) * 10 })));
  });
  const [orders, setOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_orders')) || MOCK_ORDERS; } catch { return MOCK_ORDERS; }
  });
  const [computeRecords, setComputeRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_compute_records')) || MOCK_COMPUTES; } catch { return MOCK_COMPUTES; }
  });
  const [adminUsers, setAdminUsers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_admin_users')) || MOCK_ADMIN_USERS; } catch { return MOCK_ADMIN_USERS; }
  });
  const [assets, setAssets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_assets')) || MOCK_ASSETS; } catch { return MOCK_ASSETS; }
  });
  // 2026-08-05 拆表后：assets = 当前登录用户自己的（前台）；allAssets = 全量（仅后台 AdminAssets/AdminUsers 用）
  const [allAssets, setAllAssets] = useState([]);
  const [computePackages, setComputePackages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('clone_compute_packages'));
      // 严格校验：必须是数组且元素是对象；否则降级 mock（防 localStorage 污染）
      if (Array.isArray(saved) && saved.every(x => x && typeof x === 'object')) return saved;
    } catch { /* ignore */ }
    return MOCK_COMPUTE_PACKAGES;
  });
  const [adminAccounts, setAdminAccounts] = useState(MOCK_ADMIN_ACCOUNTS);
  const [operationLogs, setOperationLogs] = useState(MOCK_OPERATION_LOGS);
  // AI 授权管理：后台统一配置的 Coze 授权（PAT / OAuth JWT）
  const [authProviders, setAuthProviders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clone_auth_providers')) || []; } catch { return []; }
  });
  // 推荐配置：首页 Banner 轮播 + 首页推荐位（有序智能体/工作流 id）
  const [banners, setBanners] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('clone_banners')); return Array.isArray(s) && s.length ? s : MOCK_BANNERS; } catch { return MOCK_BANNERS; }
  });
  const [recommended, setRecommended] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('clone_recommended')); return Array.isArray(s) ? s : []; } catch { return []; }
  });
  const [landing, setLanding] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('clone_landing'));
      if (saved && typeof saved === 'object') return { ...LANDING_DEFAULT, ...saved };
    } catch { /* ignore */ }
    return LANDING_DEFAULT;
  });
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 2026-08-03 商用安全：token 会话。登录/注册成功后由服务端签发（7 天过期），
  // 所有敏感接口请求经 apiFetch 自动携带 Authorization。启动时用 /api/auth/me 校验。
  const [token, setTokenState] = useState(() => getToken());
  const saveToken = (t) => { setTokenState(t || ''); setToken(t || ''); };
  // 启动时校验 token 有效性：无效（过期/伪造）则清除登录态，防 localStorage 伪造身份
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/auth/me');
        if (!r.ok) {
          if (!cancelled) { saveToken(''); setUser(null); setAdminUser(null); setPoints(0); }
          return;
        }
        const data = await r.json();
        if (data && data.ok && data.user && !cancelled) {
          // 2026-08-04：服务端 /me 返回的 user 是权威真值，必须完全替换（不与 prev merge）。
          // 即使是同一用户（同 id），也不能 merge prev —— 否则本地脏数据（残余字段）会覆盖服务端真值。
          // 之前 id 不同时返回 `{ ...data.user }` 是对的，但同 id 也应该完全替换。
          setUser({ ...data.user });
          // 2026-08-05：同步余额，避免 token 持久化场景下前端 points 显示 0 导致误报「算力不足」。
          if (typeof data.user.points === 'number') setPoints(data.user.points);
        }
      } catch (e) { /* 网络错误暂不登出，避免抖动 */ }
    })();
    return () => { cancelled = true; };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // 启动时：若本地没有 token，却残留旧版 localStorage 的 user/adminUser，立即清空，
  // 避免「页面显示已登录，实际请求不带 token」的 401 陷阱。
  useEffect(() => {
    if (!getToken() && (user || adminUser)) {
      setUser(null);
      setAdminUser(null);
      setPoints(0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 任意请求收到 401 时统一清状态（apiFetch 会触发 usun:unauthorized 事件）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUnauthorized = () => {
      clearToken();
      clearAdminToken();
      setTokenState('');
      setUser(null);
      setAdminUser(null);
      setPoints(0);
    };
    window.addEventListener('usun:unauthorized', onUnauthorized);
    window.addEventListener('usun:admin-unauthorized', onUnauthorized);
    return () => {
      window.removeEventListener('usun:unauthorized', onUnauthorized);
      window.removeEventListener('usun:admin-unauthorized', onUnauthorized);
    };
  }, []);
  // 前台「算力充值」弹窗：提升到 App 顶层由 store 全局控制（Header/Chat/Workflow 都可触发）
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [rechargeExpiryDate, setRechargeExpiryDate] = useState(null); // 非 null 时弹窗顶部展示「套餐已到期」提示
  const [rechargeHideExpiry, setRechargeHideExpiry] = useState(false); // 新访客入口(底部 CTA)打开弹窗时跳过到期横幅
  // opts: { hideExpiry?: boolean }  — 兼容旧调用 openRechargeModal(expiryDate)、openRechargeModal()（行为零变化）
  const openRechargeModal = (expiryDate = null, opts = null) => {
    setRechargeExpiryDate(expiryDate);
    setRechargeHideExpiry(Boolean(opts && opts.hideExpiry));
    setRechargeModalOpen(true);
  };
  const closeRechargeModal = () => { setRechargeModalOpen(false); setRechargeExpiryDate(null); setRechargeHideExpiry(false); };
  const [logo, setLogo] = useState(() => {
    try { return localStorage.getItem('clone_logo') || null; } catch { return null; }
  });
  // 前台悬浮客服：二维码 + 三行文字（后台可配置）
  const [customerService, setCustomerService] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('clone_customer_service'));
      if (saved && typeof saved === 'object') return { ...CUSTOMER_SERVICE_DEFAULT, ...saved };
    } catch { /* ignore */ }
    return CUSTOMER_SERVICE_DEFAULT;
  });
  // 公告通知：管理员在后台发布、前台用户读取的共享列表（单 key 存完整数组，走配置 KV 持久化）
  const [announcements, setAnnouncements] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('clone_announcements')); return Array.isArray(s) ? s : []; } catch { return []; }
  });
  // 前台「算力充值」弹窗的提示信息（后台算力中心可配置，纯文本多行，随 debounce 整表持久化）
  const [rechargeInfo, setRechargeInfo] = useState(() => {
    try { return localStorage.getItem('clone_recharge_info') || ''; } catch { return ''; }
  });
  const LEGAL_AGREEMENTS_DEFAULT = {
    privacy: { title: '隐私政策', content: '' },
    terms: { title: '服务条款', content: '' },
  };
  const [legalAgreements, setLegalAgreements] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('clone_legal_agreements'));
      if (saved && typeof saved === 'object') {
        return {
          privacy: { ...LEGAL_AGREEMENTS_DEFAULT.privacy, ...(saved.privacy || {}) },
          terms: { ...LEGAL_AGREEMENTS_DEFAULT.terms, ...(saved.terms || {}) },
        };
      }
    } catch { /* ignore */ }
    return LEGAL_AGREEMENTS_DEFAULT;
  });
  // 站点级设置：网站名称 / 标语 / 备案号 / 域名标识（后台「站点设置」可编辑，持久化到服务端 KV）
  const SITE_CONFIG_DEFAULT = {
    name: '友尚 AI',
    slogan: 'AI 智能体平台 · 让获客更简单',
    icp: '粤ICP备2025460328号-3',
    domain: 'my-shop',
  };
  const [siteConfig, setSiteConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('clone_site_config'));
      if (saved && typeof saved === 'object') return { ...SITE_CONFIG_DEFAULT, ...saved };
    } catch { /* ignore */ }
    return SITE_CONFIG_DEFAULT;
  });
  // 合并式更新：先更新本地 state，再 fire-and-forget 写回服务端 KV（失败置 persistError，App 顶层 Toast 提示）
  const updateSiteConfig = (patch) => {
    const next = { ...siteConfig, ...patch };
    setSiteConfig(next);
    persistAdminKey('siteConfig', next);
    return next;
  };

  // 持久化失败提示：admin 显式操作（addAgent / updateAgent / togglePublished / ...）走 persistKey，
  // 失败时设置此 state，App 顶层 Toast 提示用户「同步到服务端失败，请刷新重试」。
  // 设计原则：不再用 debounce 全表 PUT（多设备场景下会被 stale localStorage 静默覆盖服务端数据）。
  const [persistError, setPersistError] = useState(null); // { key, msg, ts }

  // Points / compute
  // 余额真值来自后台用户表（adminUsers）。初始化时若已登录，直接以 adminUsers 中该用户的最新 points 为准；否则回退 clone_points 缓存
  const [points, setPoints] = useState(() => {
    try {
      const savedUser = JSON.parse(localStorage.getItem('clone_user')) || null;
      if (savedUser) {
        const users = JSON.parse(localStorage.getItem('clone_admin_users')) || [];
        const latest = users.find(u => u.id === savedUser.id);
        if (latest && typeof latest.points === 'number') return latest.points;
      }
      return Number(localStorage.getItem('clone_points')) || 0;
    } catch { return 0; }
  });

  useEffect(() => { localStorage.setItem('clone_categories', JSON.stringify(categories)); }, [categories]);
  useEffect(() => { localStorage.setItem('clone_category_groups', JSON.stringify(categoryGroups)); }, [categoryGroups]);
  useEffect(() => { localStorage.setItem('clone_agents', JSON.stringify(agents)); }, [agents]);
  useEffect(() => { localStorage.setItem('clone_workflows', JSON.stringify(workflows)); }, [workflows]);
  useEffect(() => { localStorage.setItem('clone_banners', JSON.stringify(banners)); }, [banners]);
  useEffect(() => { localStorage.setItem('clone_recommended', JSON.stringify(recommended)); }, [recommended]);
  useEffect(() => { localStorage.setItem('clone_landing', JSON.stringify(landing)); }, [landing]);
  useEffect(() => { if (user) localStorage.setItem('clone_user', JSON.stringify(user)); else localStorage.removeItem('clone_user'); }, [user]);
  useEffect(() => { if (adminUser) localStorage.setItem('clone_admin', JSON.stringify(adminUser)); else localStorage.removeItem('clone_admin'); }, [adminUser]);
  useEffect(() => { localStorage.setItem('clone_registered_users', JSON.stringify(registeredUsers)); }, [registeredUsers]);
  useEffect(() => { localStorage.setItem('clone_points', String(points)); }, [points]);
  useEffect(() => { if (logo) localStorage.setItem('clone_logo', logo); else localStorage.removeItem('clone_logo'); }, [logo]);
  // 同步浏览器 tab favicon：用户上传 logo 后，浏览器 tab 上的小图标也跟着换；
  // 上传前/被清空时回退到 index.html 内置的默认 "U" SVG favicon。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    if (logo) link.href = logo;
  }, [logo]);
  useEffect(() => { localStorage.setItem('clone_site_config', JSON.stringify(siteConfig)); }, [siteConfig]);
  useEffect(() => { localStorage.setItem('clone_customer_service', JSON.stringify(customerService)); }, [customerService]);
  useEffect(() => { localStorage.setItem('clone_announcements', JSON.stringify(announcements)); }, [announcements]);
  useEffect(() => { localStorage.setItem('clone_legal_agreements', JSON.stringify(legalAgreements)); }, [legalAgreements]);
  useEffect(() => { localStorage.setItem('clone_orders', JSON.stringify(orders)); }, [orders]);
  useEffect(() => { localStorage.setItem('clone_compute_records', JSON.stringify(computeRecords)); }, [computeRecords]);
  useEffect(() => { localStorage.setItem('clone_assets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('clone_admin_users', JSON.stringify(adminUsers)); }, [adminUsers]);
  // 后台用户表的余额变化（管理员充值/扣减）后，自动同步到前台展示（user.points + 顶层 points），保证前后端一致
  useEffect(() => {
    if (!user) return;
    const latest = adminUsers.find(u => u.id === user.id);
    if (latest && typeof latest.points === 'number' && latest.points !== points) {
      setUser(prev => prev ? { ...prev, points: latest.points } : prev);
      setPoints(latest.points);
    }
  }, [adminUsers]);
  // 后台用户表的非余额字段（avatar / name / wechat / phone）变化后，同步到 user state，
  // 保证 hydrate 后/管理员后台改动后，前台 Profile 与顶栏展示保持一致
  useEffect(() => {
    if (!user || adminUsers.length === 0) return;
    const latest = adminUsers.find(u => u.id === user.id);
    if (!latest) return;
    const patch = {};
    if (latest.avatar != null && latest.avatar !== user.avatar) patch.avatar = latest.avatar;
    if (latest.name && latest.name !== user.name) patch.name = latest.name;
    if (latest.phone && latest.phone !== user.phone) patch.phone = latest.phone;
    if (latest.email && latest.email !== user.email) patch.email = latest.email;
    if (latest.wechatOpenid && !user.wechatOpenid) patch.wechatOpenid = latest.wechatOpenid;
    if (latest.wechat && !user.wechat) patch.wechat = latest.wechat;
    if (latest.wechatAvatar && !user.wechatAvatar) patch.wechatAvatar = latest.wechatAvatar;
    if (latest.provider && !user.provider) patch.provider = latest.provider;
    // 套餐有效期字段（planValidFrom / planValidDays / membership）也必须从后台用户表同步到前台登录态，
    // 否则管理员充套餐 / 改有效期后，头像下拉小字不显示有效期截止日。
    if (latest.planValidFrom !== undefined && latest.planValidFrom !== user.planValidFrom) patch.planValidFrom = latest.planValidFrom;
    if (latest.planValidDays !== undefined && latest.planValidDays !== user.planValidDays) patch.planValidDays = latest.planValidDays;
    if (latest.membership !== undefined) patch.membership = latest.membership;
    if (Object.keys(patch).length > 0) setUser(prev => prev ? { ...prev, ...patch } : prev);
  }, [adminUsers]);
  useEffect(() => { localStorage.setItem('clone_auth_providers', JSON.stringify(authProviders)); }, [authProviders]);

  const [history, setHistory] = useState(() => {
    try { return collapseHistoryById(JSON.parse(localStorage.getItem('clone_history')) || []); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('clone_history', JSON.stringify(history)); }, [history]);

  // ---- 服务端持久化（EdgeOne Pages KV）----
  // 后台/全局配置写入服务端 KV：重新部署、换域名、换设备、多管理员共享同一份数据，永不再丢。
  // 未绑定 KV 时 GET/POST 自动降级为 localStorage（本地开发与未配置环境不受影响）。
  const SERVER_PERSIST = [
    { key: 'agents', set: setAgents },
    { key: 'workflows', set: setWorkflows },
    { key: 'authProviders', set: setAuthProviders },
    { key: 'categories', set: setCategories },
    { key: 'categoryGroups', set: setCategoryGroups },
    // 2026-08-05: assets 已从配置整表移除，改为按用户拆表 assets_<userId>，
    // 走专用 /api/data/assets 端点（loadUserAssets / refreshAllAssets），不再随 get-config 下发。
    { key: 'adminUsers', set: setAdminUsers },
    { key: 'registeredUsers', set: setRegisteredUsers },
    { key: 'orders', set: setOrders },
    { key: 'computeRecords', set: setComputeRecords },
    { key: 'history', set: setHistory },
    { key: 'banners', set: setBanners },
    { key: 'recommended', set: setRecommended },
    { key: 'landing', set: setLanding },
    { key: 'logo', set: setLogo },
    { key: 'adminPassword', set: setAdminPassword },
    { key: 'customerService', set: setCustomerService },
    { key: 'announcements', set: setAnnouncements },
    { key: 'computePackages', set: setComputePackages },
    { key: 'rechargeInfo', set: setRechargeInfo },
    { key: 'siteConfig', set: setSiteConfig },
    { key: 'legalAgreements', set: setLegalAgreements },
  ];

  const hydratedRef = useRef(false); // 水合完成前禁止写回，防止覆盖服务端真实数据

  // B1 + v14：从 GET 返回的 lists（单条 key 名数组）按需拉前 80 条 value 填充列表 state
  // ⚠️ list-keys 返回的 keys 子字段名是 API 命名（users/regs/orders/computes/history），
  //    而本 store 的 stateKey 是 adminUsers/registeredUsers/orders/computeRecords/history。
  //    必须按 API 名（type）取，否则只有恰好同名的 history 能命中，其余 4 个永远空数组。
  const hydrateListsFromSingleKeys = useCallback(async (lists, useAdminToken = false) => {
    const MAP = {
      adminUsers: 'users',
      registeredUsers: 'regs',
      orders: 'orders',
      computeRecords: 'computes',
      history: 'history',
    };
    const PREFIX_RE = /^(user_|reg_|order_|compute_|hist_)/;
    const fetcher = useAdminToken ? adminFetch : apiFetch;
    for (const [stateKey, type] of Object.entries(MAP)) {
      const rawKeys = lists[type] || [];   // 用 API 名（type）不是 stateKey
      if (!Array.isArray(rawKeys) || rawKeys.length === 0) continue;
      const ids = rawKeys
        .map((k) => String(k).replace(PREFIX_RE, ''))
        .filter(Boolean);
      if (ids.length === 0) continue;
      try {
        const items = [];
        // 后端单次最多接收 200 个 id；分批读取全部 key，分页总数不再受旧 80 条上限影响。
        for (let offset = 0; offset < ids.length; offset += 200) {
          const r = await fetcher('/api/data/get-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, ids: ids.slice(offset, offset + 200) }),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const jr = await r.json();
          if (Array.isArray(jr && jr.items)) items.push(...jr.items);
        }
        const p = SERVER_PERSIST.find((x) => x.key === stateKey);
        if (p && (useAdminToken || items.length > 0)) {
          if (stateKey === 'history') p.set(prev => mergeHydratedHistory(items, prev));
          else p.set(items);
        }
      } catch (e) { /* ignore */ }
    }
  }, []);

  // 2026-08-04：admin 子页面（如「用户管理」）mount 时调用，从服务端拉取最新 user_* 列表
  // 解决：SaaS 模式下点侧边栏切换模块应立即看到最新数据，不依赖页面初次加载的 hydrate 快照。
  // 仅刷新 adminUsers（user_<id> 列表），不动其它 state，保证其它正在编辑的表单数据不丢。
  // ⚠️ 用 adminFetch 拿全量用户；普通 apiFetch 受用户权限过滤只返回自己的 user_*。
  const refreshAdminUsersFromServer = useCallback(async () => {
    try {
      const r = await adminFetch('/api/data/list-keys');
      if (!r.ok) return { ok: false };
      const j = await r.json();
      const userKeys = (j && j.keys && j.keys.users) || [];
      if (!Array.isArray(userKeys) || userKeys.length === 0) {
        setAdminUsers([]); return { ok: true };
      }
      const ids = userKeys
        .map((k) => String(k).replace(/^user_/, ''))
        .filter(Boolean);
      if (ids.length === 0) return { ok: true };
      const items = [];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const r2 = await adminFetch('/api/data/get-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'users', ids: ids.slice(offset, offset + 200) }),
        });
        if (!r2.ok) return { ok: false };
        const jr = await r2.json();
        if (Array.isArray(jr && jr.items)) items.push(...jr.items);
      }
      // admin 全量拉取：直接用服务端真值替换，不保留前一个账号的 localOnly 残留。
      setAdminUsers(items);
      return { ok: true, count: items.length };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, []);

  // 2026-08-04：刷新所有列表类数据（adminUsers / registeredUsers / orders / computeRecords / history）
  // admin 子页面 mount 时调用，确保「点侧边栏切换模块」立即看到最新数据。
  // ⚠️ 必须用 adminFetch（clone_admin_token），不能用 apiFetch（clone_token）。
  // 原因：用户可能先用手机用户登录（clone_token=手机token），再切换到 admin 登录。
  // adminLogin 已修复为写到独立 clone_admin_token，所以这里 adminFetch 能拿到正确的 admin token。
  const refreshAllAdminLists = useCallback(async () => {
    try {
      const r = await adminFetch('/api/data/list-keys');
      if (!r.ok) return { ok: false };
      const j = await r.json();
      if (j && j.keys) await hydrateListsFromSingleKeys(j.keys, /* useAdminToken */ true);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, [hydrateListsFromSingleKeys]);

  // 2026-08-04：刷新所有配置类数据（agents / workflows / categories / banners / siteConfig 等）
  // 前台首页、智能体列表 mount 时调用，确保用户看到最新的智能体/工作流/首页内容。
  // ⚠️ 关键：不能把 landing/siteConfig/computePackages/rechargeInfo/logo/customerService 等
  //   本身就是对象/字符串的 config key 当作"object map → array"来 coerce，否则会把 landing 变成
  //   一个元素数组（每个 field 算一个 element），导致 footer.tagline 等读取崩溃白屏。
  const CONFIG_OBJECT_TO_ARRAY_KEYS = new Set([
    'agents', 'workflows', 'authProviders', 'categories', 'categoryGroups',
    'banners', 'recommended', 'announcements', 'computePackages',
  ]);
  const refreshAllConfig = useCallback(async () => {
    try {
      // get-config 是公开接口（不需要 admin 权限），用 apiFetch 让 Home/AgentList 等公开页面也能拉。
      const r = await apiFetch('/api/data/get-config');
      if (!r.ok) return { ok: false };
      const j = await r.json();
      const data = (j && j.data) || {};
      if (Object.keys(data).length === 0) return { ok: false };
      for (const p of SERVER_PERSIST) {
        if (data[p.key] === undefined || data[p.key] === null) continue;
        let v = data[p.key];
        // 列表类已在 refreshAllAdminLists 中处理
        if (['adminUsers', 'registeredUsers', 'orders', 'computeRecords', 'history'].includes(p.key)) continue;
        // 仅对真正的列表类 key 做 object→array 归一化（防止服务端写成了 dict）
        if (CONFIG_OBJECT_TO_ARRAY_KEYS.has(p.key)) {
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const vals = Object.values(v).filter(x => x && typeof x === 'object');
            if (vals.length > 0) v = vals;
          }
        }
        // agents / workflows：按 sortOrder 升序（消费方统一看到一致顺序）
        if ((p.key === 'agents' || p.key === 'workflows') && Array.isArray(v)) {
          v = [...v].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }
        // siteConfig：与默认值合并，缺字段时自动补全（向后兼容）
        if (p.key === 'siteConfig' && v && typeof v === 'object') {
          v = { ...SITE_CONFIG_DEFAULT, ...v };
        }
        p.set(v);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, []);

  // 单 key 写回：admin 显式操作后立即 PUT（替代 debounce 全表 PUT，避免多设备 stale localStorage 静默覆盖服务端数据）
  // 返回 { ok: bool, msg?: string }。失败时设置 persistError，App 顶层 Toast 提示用户，不静默吞错。
  // 2026-08-05 修复：admin 后台 CONFIG 写入必须用 adminFetch（clone_admin_token）。
  // 根因：put-config 服务端 isAdminSession(s) 校验，携带普通用户 token 会 401。
  // 2026-08-05：用户级 CONFIG 写入（如 assets 运行记录）走 apiFetch（用户 token）；
  // 后台管理员 CONFIG 写入（agents/landing/banners/.../announcements）走 adminFetch（admin token）。
  // 8/4 token 拆分后，两者必须严格分离，否则前台用户操作会 401 并被清登录态。
  const persistKey = useCallback(async (key, value) => {
    try {
      const r = await apiFetch('/api/data/put-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || '服务端返回失败');
      return { ok: true };
    } catch (e) {
      console.error('[persist] failed for key=' + key, e);
      const msg = '保存「' + key + '」到服务端失败：' + (e.message || e) + '。请刷新页面后重试。';
      setPersistError({ key, msg, ts: Date.now() });
      return { ok: false, msg };
    }
  }, []);

  const persistAdminKey = useCallback(async (key, value) => {
    try {
      const r = await adminFetch('/api/data/put-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || '服务端返回失败');
      return { ok: true };
    } catch (e) {
      console.error('[persistAdmin] failed for key=' + key, e);
      const msg = '保存「' + key + '」到服务端失败：' + (e.message || e) + '。请刷新页面后重试。';
      setPersistError({ key, msg, ts: Date.now() });
      return { ok: false, msg };
    }
  }, []);

  const saveRechargeInfo = useCallback(async (value) => {
    const next = String(value || '');
    const result = await persistAdminKey('rechargeInfo', next);
    if (result.ok) setRechargeInfo(next);
    return result;
  }, [persistAdminKey]);

  const saveLegalAgreements = useCallback(async (value) => {
    const next = {
      privacy: { ...LEGAL_AGREEMENTS_DEFAULT.privacy, ...((value && value.privacy) || {}) },
      terms: { ...LEGAL_AGREEMENTS_DEFAULT.terms, ...((value && value.terms) || {}) },
    };
    const result = await persistAdminKey('legalAgreements', next);
    if (result.ok) setLegalAgreements(next);
    return result;
  }, [persistAdminKey]);

  // 启动：从服务端拉取最新数据并覆盖（实现重新部署后保留）；server 为空则把当前数据迁移上去
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // v14：拆成两个并发 GET（list-keys + get-config），都走嵌套子目录端点
        const [rList, rCfg] = await Promise.all([
          apiFetch('/api/data/list-keys'),
          apiFetch('/api/data/get-config'),
        ]);
        if (!rList.ok || !rCfg.ok) { hydratedRef.current = true; return; }
        const jList = await rList.json();
        const jCfg = await rCfg.json();
        if (!jList.kv || !jCfg.kv) { hydratedRef.current = true; return; }
        hydratedRef.current = true; // KV 已确认可用，后续写回允许
        const data = (jCfg && jCfg.data) || {};
        if (Object.keys(data).length > 0) {
          // 规范化：服务端 KV 里 history 类按单条 key 存（uuid-key 形式），
          // 但 categories / agents 等大表在一些边界条件下被写成了 object map {id: cfg} 形式。
          // 前端 store 全部要求是数组，所以这里主动 coerce：
          //   - array: 直接用
          //   - object（且 value 是 plain object）: 当作 object map，按值列表化
          //   - 其它: 跳过（不污染 localStorage 干净值）
          const ARRAY_KEYS = new Set([
            'agents', 'workflows', 'authProviders', 'categories', 'categoryGroups',
            'banners', 'recommended', 'orders', 'computeRecords',
            'adminUsers', 'registeredUsers', 'announcements', 'computePackages',
          ]);
          for (const p of SERVER_PERSIST) {
            if (data[p.key] === undefined || data[p.key] === null) continue;
            let v = data[p.key];
            if (ARRAY_KEYS.has(p.key) && !Array.isArray(v)) {
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                const vals = Object.values(v).filter(x => x && typeof x === 'object');
                v = vals;
              } else {
                continue; // 非对象/非数组，跳过避免污染
              }
            }
            // agents / workflows：按 sortOrder 升序，让所有消费方（首页/智能体列表/搜索/管理后台）
            // 都看到统一顺序。后端 KV 数组顺序不一定稳定（取决于写入/编辑历史），
            // 必须按 sortOrder 排，否则拖拽调整只改 sortOrder、不改数组位置，前端仍按旧位置显示。
            if ((p.key === 'agents' || p.key === 'workflows') && Array.isArray(v)) {
              v = [...v].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            }
            // siteConfig：与默认值合并，保证旧数据缺字段时自动补全（向后兼容）
            if (p.key === 'siteConfig' && v && typeof v === 'object') {
              v = { ...SITE_CONFIG_DEFAULT, ...v };
            }
            p.set(v);
          }
        }
        // B1 + v14：列表类从单条 key 聚合拉前 80 条填充，避免整表读超时
        if (jList.keys && !cancelled) {
          await hydrateListsFromSingleKeys(jList.keys);
        }
      } catch (e) {
        hydratedRef.current = true; // 瞬时错误也放开写回，由 POST 自行兜底
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 前台主动从服务端拉取「当前登录用户」的最新记录（余额 + 套餐有效期），
  // 解决管理员后台充值 / 改套餐后，前端头像下拉仍显示旧余额、且不显示有效期截止日的问题。
  // 权威来源：单条 key user_<id>（由 rechargeUserPoints 写入，与后台「算力余额」同源）。
  const refreshCurrentUser = useCallback(async () => {
    if (!user || !user.id) return;
    try {
      const res = await apiFetch('/api/data/get-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'users', ids: [user.id] }),
      });
      if (!res.ok) return;
      const j = await res.json();
      const rec = j && j.items && j.items[0];
      if (!rec) return;
      const nextPoints = typeof rec.points === 'number' ? rec.points : (user.points || 0);
      setUser(prev => {
        if (!prev) return prev;
        const merged = { ...prev };
        if (typeof rec.points === 'number') merged.points = rec.points;
        if (rec.planValidFrom !== undefined) merged.planValidFrom = rec.planValidFrom;
        if (rec.planValidDays !== undefined) merged.planValidDays = rec.planValidDays;
        if (rec.membership !== undefined) merged.membership = rec.membership;
        if (rec.name) merged.name = rec.name;
        if (rec.avatar !== undefined) merged.avatar = rec.avatar;
        if (rec.phone) merged.phone = rec.phone;
        return merged;
      });
      setPoints(nextPoints);
      // 同步到后台用户表 state，保持与既有同步 effect（余额 / 非余额字段）一致
      setAdminUsers(prev => {
        const idx = prev.findIndex(u => u.id === user.id);
        if (idx === -1) return prev;
        const merged = { ...prev[idx] };
        if (typeof rec.points === 'number') merged.points = rec.points;
        if (rec.planValidFrom !== undefined) merged.planValidFrom = rec.planValidFrom;
        if (rec.planValidDays !== undefined) merged.planValidDays = rec.planValidDays;
        if (rec.membership !== undefined) merged.membership = rec.membership;
        return [...prev.slice(0, idx), merged, ...prev.slice(idx + 1)];
      });
    } catch (e) { /* 网络错误忽略，下次 focus / 打开菜单时再拉 */ }
  }, [user]);

  const currentUserId = user?.id;
  const refreshCurrentUserCompute = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const listResponse = await apiFetch('/api/data/list-keys');
      if (!listResponse.ok) return;
      const listJson = await listResponse.json();
      const keys = (listJson && listJson.keys && listJson.keys.computes) || [];
      const ids = keys.map((key) => String(key).replace(/^compute_/, '')).filter(Boolean);
      const items = [];
      for (let offset = 0; offset < ids.length; offset += 200) {
        const response = await apiFetch('/api/data/get-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'computes', ids: ids.slice(offset, offset + 200) }),
        });
        if (!response.ok) return;
        const json = await response.json();
        if (Array.isArray(json && json.items)) items.push(...json.items);
      }
      setComputeRecords(items);
    } catch { /* 下次进入算力记录页或窗口聚焦时再刷新 */ }
  }, [currentUserId]);

  // 用 ref 持有最新 refreshCurrentUser，避免 focus/visibility 监听闭包到过期版本
  const refreshCurrentUserRef = useRef(refreshCurrentUser);
  useEffect(() => { refreshCurrentUserRef.current = refreshCurrentUser; }, [refreshCurrentUser]);
  // 切回标签页 / 窗口重新聚焦时，刷新当前用户余额与有效期（管理员在另一窗口充值后即时同步）
  useEffect(() => {
    let t = null;
    const trigger = () => {
      clearTimeout(t);
      t = setTimeout(() => { const fn = refreshCurrentUserRef.current; if (fn) fn(); }, 600);
    };
    const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') trigger(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', trigger);
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      clearTimeout(t);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', trigger);
        document.removeEventListener('visibilitychange', onVis);
      }
    };
  }, []);

  // v14 移除：migrate-store 触发（端点已删除，单条 key 同步已 work，无需批量迁移）

  // 注意：旧的 debounce 全表 PUT useEffect 已删除（2026-07-29 silent overwrite bug 修复）。
  // 原逻辑：所有 CONFIG 类 state 变化 → 800ms 后 persistAllToServer 整表 PUT。
  // 问题：多设备场景下，stale localStorage 设备的任何 setState 都会把 stale 数据覆盖服务端新数据。
  // 修复：改成 admin 显式操作函数内部 await persistAdminKey(key, value)，按需单 key PUT。
  // localStorage 同步仍由各 useEffect 自动完成（行 408-462），删除 debounce 不影响本地缓存。
  // computePackages 同步落到 localStorage（防 KV 故障/延迟时本地缓存仍可用）
  useEffect(() => { localStorage.setItem('clone_compute_packages', JSON.stringify(computePackages)); }, [computePackages]);
  // rechargeInfo 同步落到 localStorage
  useEffect(() => { try { localStorage.setItem('clone_recharge_info', rechargeInfo); } catch { /* ignore */ } }, [rechargeInfo]);

  const requireLogin = (action) => {
    if (user) return true;
    setPendingAction(action);
    setLoginModalOpen(true);
    return false;
  };

  const deductPoints = (amount, reason, meta) => {
    if (!user) return;
    const amt = Number(amount) || 0;
    if (amt <= 0) return;
    const uid = user.id;
    // 智能体/工作流执行接口已经在服务端扣费并写入唯一流水。
    // 这里仅查询权威余额，禁止浏览器再次乐观扣点或新增重复 compute 记录。
    deductComputeRemote(uid, amt, reason, meta);
  };

  // 异步调后端 /api/compute/deduct，用权威余额校准本地（fire-and-forget，不影响调用方同步语义）
  const deductComputeRemote = (userId, amount, reason, meta) => {
    apiFetch('/api/compute/deduct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount, reason: reason || '', meta: meta || null }),
    })
      .then(r => r.json().catch(() => null))
      .then(data => {
        if (data && data.ok) {
          // 用服务端权威余额覆盖本地（正常场景正确；同用户多标签极限竞态由 refreshCurrentUser 兜底）
          const authoritative = data.points;
          setPoints(authoritative);
          setUser(prev => prev ? { ...prev, points: authoritative } : prev);
          setAdminUsers(prev => prev.map(u => (u.id === userId) ? { ...u, points: authoritative } : u));
          refreshCurrentUserCompute();
        } else if (data && data.reason === 'insufficient') {
          // 余额不足：回滚到服务端真值并提示
          const sv = data.points ?? 0;
          setPoints(sv);
          setUser(prev => prev ? { ...prev, points: sv } : prev);
          setAdminUsers(prev => prev.map(u => (u.id === userId) ? { ...u, points: sv } : u));
          setPersistError({ key: 'compute', msg: `算力不足，请先充值（当前余额 ${sv}）`, ts: Date.now() });
        } else {
          setPersistError({ key: 'compute', msg: '算力扣减同步失败，请刷新页面后重试', ts: Date.now() });
        }
      })
      .catch(() => {
        setPersistError({ key: 'compute', msg: '算力扣减同步失败，请刷新页面后重试', ts: Date.now() });
      });
  };

  const rechargePoints = (amount, userId) => {
    // 充值始终写回后台用户表（adminUsers），保证前后端余额一致（唯一真值）
    const targetId = userId || user?.id;
    const amt = Number(amount) || 0;
    if (!targetId || amt <= 0) return;
    // 乐观更新
    if (user && user.id === targetId) {
      setPoints(p => p + amt);
      setUser(prev => prev ? { ...prev, points: (prev.points || 0) + amt } : prev);
    }
    setAdminUsers(prev => prev.map(u => u.id === targetId ? { ...u, points: (u.points || 0) + amt } : u));
    const record = { id: Date.now() + Math.random(), type: 'recharge', amount: amt, reason: '管理员充值', createdAt: new Date().toISOString(), userId: targetId };
    setComputeRecords(prev => [record, ...prev]);
    tryWriteSingleKey('compute', record);
    // 服务端原子增加（充值；根除并发充值丢失），用权威余额校准
    apiFetch('/api/compute/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetId, amount: amt }),
    })
      .then(r => r.json().catch(() => null))
      .then(data => {
        if (data && data.ok) {
          const authoritative = data.points;
          if (user && user.id === targetId) {
            setPoints(authoritative);
            setUser(prev => prev ? { ...prev, points: authoritative } : prev);
          }
          setAdminUsers(prev => prev.map(u => u.id === targetId ? { ...u, points: authoritative } : u));
          // 若充值的正是当前登录用户，主动回读（同步 name/avatar/有效期等）
          if (user && user.id === targetId && refreshCurrentUserRef.current) refreshCurrentUserRef.current();
        } else {
          setPersistError({ key: 'compute', msg: '充值同步失败，请刷新页面后重试', ts: Date.now() });
        }
      })
      .catch(() => {
        setPersistError({ key: 'compute', msg: '充值同步失败，请刷新页面后重试', ts: Date.now() });
      });
  };

  const addHistory = (item) => {
    if (!user) return;
    const record = { ...item, id: item?.id ?? (Date.now() + Math.random()), userId: user.id };
    // 同一个稳定会话 ID 只保留一条：追问时更新完整会话快照并移到列表顶部，
    // 而不是把同 ID 记录再次插入，避免左侧出现多条同时高亮的“伪历史”。
    setHistory(prev => [record, ...prev.filter(h => historyRecordKey(h) !== historyRecordKey(record))]);
    // 服务端同样按 record.id 写同一个 hist_* KV 键，因此每轮都是覆盖更新。
    tryWriteSingleKey('history', record);
  };

  // 2026-08-03 商用安全：login 增加可选 token 参数（服务端签发），存 localStorage 供 apiFetch 使用
  // 2026-08-04：核心修复——login 不再 setAdminUsers，只设 user state。
  // adminUsers 数组的语义是「后台管理用户表」，必须由 admin 页面 mount 时的 refreshAllAdminLists 维护。
  // 前台 login 函数如果 setAdminUsers(prev => ...)，会让 adminUsers 累积脏数据：
  //   - 同 id 多次 login：name/avatar/points 字段会被反复覆盖成不同值
  //   - 不同 id 切换：旧 id 的脏记录留在数组里
  //   - 邮箱/手机 login 的 u.name 可能和服务端不一致（前端 cache 污染）
  // 修复：完全用服务端返回的 u 作为唯一真值，不与 adminUsers 数组 merge。
  const login = (u, authToken = '') => {
    // 2026-07-28 铁律：phone 用户的初始昵称 = 手机号本身（防御性归一）
    if (u && u.provider === 'phone' && u.phone && /[^\x00-\x7f]/.test(u.name || '')) {
      u = { ...u, name: u.phone };
    }
    // 2026-08-04：直接用服务端返回的 u，不再从 adminUsers 数组里 find（避免读到脏数据）
    setUser(u);
    setPoints(u.points || 0);
    if (authToken) saveToken(authToken);
    setLoginModalOpen(false);
    // 2026-08-05 拆表后：登录成功立即拉取"我"的资产（不阻塞登录）
    if (u && u.id) loadUserAssets(u.id);
    if (pendingAction) {
      const { type, id } = pendingAction;
      setPendingAction(null);
      window.location.href = type === 'chat' ? `/chat/${id}` : `/workflow/${id}`;
    }
  };

  // 邮箱注册（2026-08-03 服务端化：密码 scrypt 哈希在服务端，前端不再持有/生成弱哈希）
  // 返回 { ok, msg? }；成功时自动登录
  const register = async (email, password) => {
    try {
      const r = await apiFetch('/api/auth/email-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!j || !j.ok) return { ok: false, msg: (j && j.msg) || '注册失败' };
      // 同步进后台「用户管理」列表，便于管理员查看
      const newUser = j.user;
      setRegisteredUsers(prev => prev.some(u => u.id === newUser.id) ? prev : [newUser, ...prev]);
      // 2026-08-04：移除 setAdminUsers 污染源。adminUsers 由 admin 页面单独维护。
      setUser({ id: newUser.id, email, name: newUser.name, avatar: '', balance: 0, points: 0, role: 'user', status: 'active' });
      setPoints(0);
      saveToken(j.token || '');
      setLoginModalOpen(false);
      if (newUser && newUser.id) loadUserAssets(newUser.id); // 新用户资产为空，直接拉（返回空数组）
      if (pendingAction) { const { type, id } = pendingAction; setPendingAction(null); window.location.href = type === 'chat' ? `/chat/${id}` : `/workflow/${id}`; }
      return { ok: true };
    } catch {
      return { ok: false, msg: '网络异常，请稍后重试' };
    }
  };

  // 邮箱登录（2026-08-03 服务端校验密码，签发 token；兼容旧 32 位弱哈希自动升级）
  const loginWithEmail = async (email, password) => {
    try {
      const r = await apiFetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!j || !j.ok) return false;
      const u = j.user;
      saveToken(j.token || '');
      setUser({ id: u.id, email: u.email, name: u.name, avatar: u.avatar || '', balance: u.balance ?? 0, points: u.points ?? 0, role: 'user', status: 'active', planValidDays: u.planValidDays || 0, planValidFrom: u.planValidFrom || null });
      setPoints(u.points ?? 0);
      // 2026-08-04：移除 setAdminUsers 污染源。adminUsers 由 admin 页面单独维护（refreshAllAdminLists）。
      setLoginModalOpen(false);
      if (u && u.id) loadUserAssets(u.id); // 2026-08-05 拆表后：登录成功立即拉取我的资产
      if (pendingAction) {
        const { type, id } = pendingAction;
        setPendingAction(null);
        window.location.href = type === 'chat' ? `/chat/${id}` : `/workflow/${id}`;
      }
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    // 2026-08-03 商用安全：登出同时吊销服务端会话
    try { apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null); } catch (e) { /* ignore */ }
    clearToken();
    clearAdminToken(); // 2026-08-04：admin 也登出
    setTokenState('');
    // 2026-08-04：登出时同时清空 adminUsers / registeredUsers，避免下一个账号登入时残留前一个账号的脏数据
    setUser(null); setAdminUser(null); setAdminUsers([]); setRegisteredUsers([]); setPoints(0);
  };

  // 管理员登录（2026-08-03 服务端化：校验服务端 adminPassword，签发 admin 会话 token）
  const adminLogin = async (data) => {
    try {
      const r = await apiFetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: data.password || '' }),
      });
      const j = await r.json();
      if (!j || !j.ok) return { ok: false, msg: (j && j.msg) || '登录失败' };
      // 2026-08-04：admin token 独立存 clone_admin_token，不污染 clone_token。
      // 同时清空 clone_token：之前可能存了手机用户 token，避免 admin 界面误带用户 token。
      setToken('');
      setAdminToken(j.token || '');
      setAdminUser({ id: 'admin', name: '超级管理员', role: 'super', tenant: 'my-shop' });
      return { ok: true };
    } catch {
      return { ok: false, msg: '网络异常，请稍后重试' };
    }
  };

  // 管理员改密（2026-08-03 服务端化）
  const changeAdminPassword = async (oldPwd, newPwd) => {
    try {
      const r = await apiFetch('/api/auth/admin-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const j = await r.json();
      return { ok: !!(j && j.ok), msg: (j && j.msg) || (j && j.ok ? '密码修改成功' : '修改失败') };
    } catch {
      return { ok: false, msg: '网络异常，请稍后重试' };
    }
  };

  const adminLogout = () => {
    try { apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null); } catch (e) { /* ignore */ }
    clearToken();
    setTokenState('');
    setAdminUser(null);
  };

  // 2026-08-04：核心修复——必须先 GET 服务端最新的 reg（含 password），再合并 patch 写回。
  // 旧实现从 store.registeredUsers 数组里 find，但该数组经过 toSafeUser 剥离了 password。
  // 直接把不含 password 的 reg 写回服务端 → 服务端 reg 的 password 被清空 → 用户无法用邮箱密码登录。
  // 修复流程：
  //   1. 异步调 /api/single-key/regs/get?id=<userId> 拿当前服务端真值
  //   2. 合并 patch 字段（patch 覆盖服务端字段）
  //   3. 写回 /api/single-key/regs/put（保留服务端原始 password）
  //   4. 更新 store.registeredUsers 同步前端缓存
  // 注意：手机/微信用户没有 reg record 或 reg 没有 password，跳过服务端同步即可。
  const updateUserProfile = async (patch) => {
    if (!user) return;
    const updated = { ...user, ...patch };
    setUser(updated);
    setAdminUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...patch } : u));
    // 邮箱注册用户：必须 GET 服务端最新 reg（含 password）再合并写回
    if (user.email) {
      try {
        const cur = await apiFetch('/api/single-key/regs/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: user.id }),
        });
        if (cur.ok) {
          const j = await cur.json();
          const remoteReg = (j && j.item) || null;
          if (remoteReg) {
            // 合并：服务端字段（含 password） + 本次 patch（patch 优先）
            const merged = { ...remoteReg, ...patch };
            await apiFetch('/api/single-key/regs/put', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ record: merged }),
            });
            // 同步前端 registeredUsers（含 password，但 password 不会下发到 UI）
            setRegisteredUsers(prev => {
              const idx = prev.findIndex(u => u.id === user.id);
              if (idx === -1) return [...prev, merged];
              const next = prev.slice();
              next[idx] = merged;
              return next;
            });
          }
        }
      } catch (e) { console.error('[updateUserProfile] reg sync failed:', e); }
    } else {
      // 非邮箱用户（手机/微信）：只更新 store 缓存，不写 reg 服务端
      setRegisteredUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...patch } : u));
    }
    // user_<id> 写回（不需要 GET 服务端，因为 user state 已经是权威）
    tryWriteSingleKey('user', { ...updated });
  };

  // 微信扫码登录（2026-08-03 服务端化：按 openid 查/建用户并签发 token，杜绝伪造）
  const loginWithWechat = async (wechatUser) => {
    const { openid, nickname, headimgurl, unionid } = wechatUser || {};
    if (!openid) return false;
    try {
      const r = await apiFetch('/api/auth/wechat-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid, nickname: nickname || '', headimgurl: headimgurl || '', unionid: unionid || '' }),
      });
      const j = await r.json();
      if (!j || !j.ok) return false;
      const u = j.user;
      saveToken(j.token || '');
      setUser({ id: u.id, email: u.email || '', name: u.name || nickname, avatar: u.avatar || headimgurl, points: u.points ?? 0, role: 'user', status: 'active', provider: 'wechat', wechat: u.wechat || nickname, wechatOpenid: u.wechatOpenid || openid, wechatAvatar: u.wechatAvatar || headimgurl });
      setPoints(u.points ?? 0);
      setAdminUsers(prev => prev.some(x => x.id === u.id)
        ? prev.map(x => x.id === u.id ? { ...x, avatar: headimgurl || x.avatar, wechat: nickname, wechatOpenid: openid, provider: 'wechat' } : x)
        : [{ id: u.id, name: u.name || nickname, email: '', phone: '', points: u.points ?? 0, avatar: headimgurl || '', role: 'user', status: 'active', provider: 'wechat', wechat: nickname, wechatOpenid: openid, wechatAvatar: headimgurl, createdAt: u.createdAt || new Date().toISOString().split('T')[0] }, ...prev]);
      setLoginModalOpen(false);
      if (pendingAction) { const { type, id: pid } = pendingAction; setPendingAction(null); window.location.href = type === 'chat' ? `/chat/${pid}` : `/workflow/${pid}`; }
      return true;
    } catch {
      return false;
    }
  };

  // 绑定微信到当前登录账号（若该 openid 已被其它账号占用，先解绑那个账号）
  const bindWechat = (wechatUser) => {
    if (!user) return false;
    const { openid, nickname, headimgurl, unionid } = wechatUser || {};
    if (!openid) return false;
    // 解除其它账号对同一 openid 的绑定
    setRegisteredUsers(prev => prev.map(u => (u.wechatOpenid === openid && u.id !== user.id)
      ? { ...u, wechatOpenid: '', wechat: '', wechatAvatar: '', provider: u.provider === 'wechat' ? '' : u.provider }
      : u));
    setAdminUsers(prev => prev.map(u => (u.wechatOpenid === openid && u.id !== user.id)
      ? { ...u, wechatOpenid: '', wechat: '', wechatAvatar: '', provider: u.provider === 'wechat' ? '' : u.provider }
      : u));
    updateUserProfile({
      provider: user.provider && user.provider !== 'wechat' ? user.provider : 'wechat',
      wechat: nickname, wechatOpenid: openid, wechatAvatar: headimgurl,
      avatar: user.avatar || headimgurl, unionid: unionid || user.unionid || '',
    });
    // 单条 key 同步
    tryWriteSingleKey('user', { ...user, provider: user.provider && user.provider !== 'wechat' ? user.provider : 'wechat', wechat: nickname, wechatOpenid: openid, wechatAvatar: headimgurl, avatar: user.avatar || headimgurl, unionid: unionid || user.unionid || '' });
    return true;
  };

  // 解绑微信（保留原账号与登录方式）
  const unbindWechat = () => {
    if (!user) return false;
    updateUserProfile({
      wechat: '', wechatOpenid: '', wechatAvatar: '',
      provider: user.provider === 'wechat' ? '' : user.provider,
    });
    tryWriteSingleKey('user', { ...user, wechat: '', wechatOpenid: '', wechatAvatar: '', provider: user.provider === 'wechat' ? '' : user.provider });
    return true;
  };

  // 修改密码 / 首次设置密码（2026-08-03 服务端化：scrypt 哈希，不再前端弱哈希）。返回 { ok, msg }
  const changePassword = async ({ oldPassword, newPassword }) => {
    if (!user) return { ok: false, msg: '请先登录' };
    if (!newPassword || newPassword.length < 6) return { ok: false, msg: '新密码至少 6 位' };
    try {
      const r = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPassword || '', newPassword }),
      });
      const j = await r.json();
      return { ok: !!(j && j.ok), msg: (j && j.msg) || (j && j.ok ? '密码修改成功' : '修改失败') };
    } catch {
      return { ok: false, msg: '网络异常，请稍后重试' };
    }
  };

  // 注销账号：真正删除用户在注册表与后台表中的记录并清空会话，释放手机号/邮箱，允许后续重新注册
  const cancelAccount = () => {
    if (!user) return;
    const id = user.id;
    setRegisteredUsers(prev => prev.filter(u => u.id !== id));
    setAdminUsers(prev => prev.filter(u => u.id !== id));
    setUser(null);
    setPoints(0);
    // 单条 key 同步删除（fail-silent）：users/delete 同时清 user_<id> + reg_<id>
    tryDeleteSingleKey('user', id);
  };

  // 忘记密码 — 验证身份（发送短信验证码）
  const forgotPasswordVerify = async (email) => {
    try {
      const r = await apiFetch('/api/auth/forgot-password/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      return { ok: !!(j && j.ok), msg: (j && j.msg) || '发送失败', phone: (j && j.phone) || '' };
    } catch { return { ok: false, msg: '网络异常' }; }
  };
  // 忘记密码 — 验证码核验并设置新密码
  const forgotPasswordReset = async (email, code, newPassword) => {
    try {
      const r = await apiFetch('/api/auth/forgot-password/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const j = await r.json();
      return { ok: !!(j && j.ok), msg: (j && j.msg) || '重置失败' };
    } catch { return { ok: false, msg: '网络异常' }; }
  };
  // 绑定/更换手机号（需登录）
  const bindPhone = async (phone, code) => {
    try {
      const r = await apiFetch('/api/auth/bind-phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const j = await r.json();
      if (j && j.ok) {
        setUser(prev => prev ? { ...prev, phone } : prev);
        setAdminUsers(prev => prev.map(u => u.id === user?.id ? { ...u, phone } : u));
        setRegisteredUsers(prev => prev.map(u => u.id === user?.id ? { ...u, phone } : u));
      }
      return { ok: !!(j && j.ok), msg: (j && j.msg) || '绑定失败' };
    } catch { return { ok: false, msg: '网络异常' }; }
  };
  // 管理员重置任意用户密码
  const adminResetUserPassword = async (userId, newPassword) => {
    try {
      const r = await apiFetch('/api/auth/admin-reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newPassword }),
      });
      const j = await r.json();
      return { ok: !!(j && j.ok), msg: (j && j.msg) || '重置失败' };
    } catch { return { ok: false, msg: '网络异常' }; }
  };

  // ============ 我的资产（2026-08-05 拆表重构）============
  // 旧设计：assets 整表存一条 KV（所有用户的运行记录挤在一起），任何登录用户 PUT 整表即可覆盖全站资产。
  // 新设计：每用户一条 assets_<userId>，服务端 /api/data/assets 强制 userId = session.userId，
  //         用户物理上写不到别人的 key，越权覆盖全表从此不可能。
  // 新增/更新只提交单条记录，避免历史资产越多请求体越大并最终触发 HTTP 500/413。
  const persistMyAsset = useCallback(async (item) => {
    try {
      const r = await apiFetch('/api/data/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || '服务端返回失败');
      return { ok: true };
    } catch (e) {
      console.error('[assets] 保存失败', e);
      const msg = '资产保存到服务端失败：' + (e.message || e) + '。请刷新后重试。';
      setPersistError({ key: 'assets', msg, ts: Date.now() });
      return { ok: false, msg };
    }
  }, []);

  const deleteMyAsset = useCallback(async (assetId) => {
    try {
      const r = await apiFetch('/api/data/assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || '服务端返回失败');
      return { ok: true };
    } catch (e) {
      const msg = '资产删除同步失败：' + (e.message || e) + '。请刷新后重试。';
      setPersistError({ key: 'assets', msg, ts: Date.now() });
      return { ok: false, msg };
    }
  }, []);

  // 前台：拉取"我"的资产（登录成功 / 我的资产页 mount 时调用）
  // 接受可选 explicitUserId：login/register 后 user state 尚未更新，闭包里的 user 可能还是 null，
  // 必须显式传新用户 id 才能立刻拉到他的资产，否则要等下一次 mount/刷新。
  const loadUserAssets = useCallback(async (explicitUserId) => {
    const uid = explicitUserId || (user && user.id);
    if (!uid) { setAssets([]); return []; }
    try {
      const r = await apiFetch('/api/data/assets');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = Array.isArray(j && j.items) ? j.items : [];
      setAssets(items);
      return items;
    } catch (e) {
      console.error('[assets] 拉取我的资产失败', e);
      return [];
    }
  }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 后台：管理员拉全量资产（AdminAssets / AdminUsers 挂载时调用）
  const refreshAllAssets = useCallback(async () => {
    try {
      const r = await adminFetch('/api/data/assets');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = Array.isArray(j && j.items) ? j.items : [];
      setAllAssets(items);
      return items;
    } catch (e) {
      console.error('[assets] 拉取全量资产失败', e);
      return [];
    }
  }, []);

  // 后台：删除某用户的某条资产（admin），或整用户清空（assetId 为空 → 级联删除用）
  const deleteAssetAdmin = useCallback(async (targetUserId, assetId) => {
    try {
      const r = await adminFetch('/api/data/assets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUserId, assetId: assetId || '' }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.msg) || '服务端返回失败');
      if (assetId) {
        setAllAssets(prev => prev.filter(a => !(a && String(a.id) === String(assetId))));
      } else {
        setAllAssets(prev => prev.filter(a => !(a && String(a.userId) === String(targetUserId))));
      }
      return { ok: true };
    } catch (e) {
      console.error('[assets] 删除失败', e);
      return { ok: false, msg: (e && e.message) || '删除失败' };
    }
  }, []);

  const addAsset = (asset) => {
    const id = 'asset' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const record = { status: 'success', ...asset, id, userId: user?.id, createdAt: new Date().toISOString() };
    setAssets(prev => [record, ...prev]);
    persistMyAsset(record);
    return id;
  };
  const updateAsset = (id, patch) => {
    const current = assets.find(a => a.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    setAssets(prev => prev.map(a => a.id === id ? next : a));
    persistMyAsset(next);
  };
  const deleteAsset = (id) => {
    setAssets(prev => prev.filter(a => a.id !== id));
    deleteMyAsset(id);
  };

  const addTask = (task) => {
    if (!user) return null;
    const id = 'task' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const record = { ...task, id, type: 'task', userId: user.id, status: 'success', createdAt: new Date().toISOString() };
    setAssets(prev => [record, ...prev]);
    persistMyAsset(record);
    return id;
  };

  const createOrder = (order) => {
    const id = 'o' + Date.now();
    const newOrder = { ...order, id, createdAt: new Date().toISOString() };
    setOrders(prev => [newOrder, ...prev]);
    tryWriteSingleKey('order', newOrder);
    return id;
  };

  const rechargeUserPoints = async (userId, amount, adminName, pkg) => {
    const requestId = 'adj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const packageInfo = pkg && pkg.id
      ? pkg
      : { id: '__manual__', name: (pkg && pkg.name) || '手动调整点数' };
    try {
      const response = await adminFetch('/api/admin/users/adjust-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount, adminName, packageInfo, requestId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok) {
        throw new Error((result && result.msg) || ('HTTP ' + response.status));
      }
      if (result.user) {
        setAdminUsers(prev => prev.map(item => item.id === userId ? result.user : item));
        if (user && user.id === userId) {
          setUser(prev => prev ? { ...prev, ...result.user } : prev);
          setPoints(result.points);
        }
      }
      if (result.computeRecord) setComputeRecords(prev => [result.computeRecord, ...prev.filter(item => item.id !== result.computeRecord.id)]);
      if (result.order) setOrders(prev => [result.order, ...prev.filter(item => item.id !== result.order.id)]);
      addLog(adminName || '系统', amount > 0 ? '调整算力' : '扣减算力', `${userId} ${amount > 0 ? '+' : ''}${amount} 点`);
      await Promise.all([refreshAdminUsersFromServer(), refreshAllAdminLists()]);
      return { ok: true, ...result };
    } catch (error) {
      const msg = (error && error.message) || '调整失败';
      setPersistError({ key: 'compute', msg: '算力调整失败：' + msg, ts: Date.now() });
      return { ok: false, msg };
    }
  };

  const toggleUserStatus = (userId) => {
    setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, status: u.status === 'active' ? 'banned' : 'active' } : u));
    const updated = adminUsers.find(u => u.id === userId);
    if (updated) tryWriteSingleKey('user', { ...updated, status: updated.status === 'active' ? 'banned' : 'active' });
  };

  // 删除用户：级联删除该用户所有关联数据（算力记录、订单、对话历史、资产库），并释放注册记录
  const deleteUser = (userId, adminName) => {
    if (!userId) return;
    setAdminUsers(prev => prev.filter(u => u.id !== userId));
    setRegisteredUsers(prev => prev.filter(u => u.id !== userId));
    setComputeRecords(prev => prev.filter(r => r.userId !== userId));
    setOrders(prev => prev.filter(o => o.userId !== userId));
    setHistory(prev => prev.filter(h => h.userId !== userId));
    setAllAssets(prev => prev.filter(a => a.userId !== userId));
    // 2026-08-05 拆表后：资产按 assets_<userId> 整把存储，管理员级联删除只需删那一条 key
    deleteAssetAdmin(userId, null);
    // 若被删除的正是当前登录用户，则强制退出
    if (user && user.id === userId) { setUser(null); setPoints(0); }
    addLog(adminName || '系统', '删除用户', `已删除用户 ${userId} 及其全部关联数据（算力记录/订单/对话历史/资产库）`);
    // 单条 key 级联删除（fail-silent）
    tryDeleteSingleKey('user', userId);
    // 算力/订单/历史 都按 userId 索引，需要服务端按 user 批量清；当前端点只支持单条，
    // 所以遍历发送（量大时可能稍慢，但 deleteUser 是低频操作——管理员手动删除）
    const compIds = computeRecords.filter(r => r.userId === userId).map(r => r.id);
    compIds.forEach(id => tryDeleteSingleKey('compute', id));
    const ordIds = orders.filter(o => o.userId === userId).map(o => o.id);
    ordIds.forEach(id => tryDeleteSingleKey('order', id));
    const histIds = history.filter(h => h.userId === userId).map(h => h.id);
    histIds.forEach(id => tryDeleteSingleKey('history', id, { userId }));
  };

  const updateOrderStatus = (orderId, status) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    const updated = orders.find(o => o.id === orderId);
    if (updated) tryWriteSingleKey('order', { ...updated, status });
  };

  // 算力套餐管理（全部改为显式 persistKey 写回，替代旧 debounce 全表 PUT）
  const addComputePackage = (pkg) => {
    const id = Date.now() + '';
    const maxOrder = computePackages.reduce((m, p) => Math.max(m, p.sortOrder || 0), 0);
    const next = [...computePackages, { ...pkg, id, sortOrder: maxOrder + 10, published: true }];
    setComputePackages(next);
    persistAdminKey('computePackages', next); // fire-and-forget，失败经 persistError Toast 提示
    return id;
  };
  const updateComputePackage = (id, patch) => {
    const next = computePackages.map(p => p.id === id ? { ...p, ...patch } : p);
    setComputePackages(next);
    persistAdminKey('computePackages', next);
  };
  const deleteComputePackage = (id) => {
    const next = computePackages.filter(p => p.id !== id);
    setComputePackages(next);
    persistAdminKey('computePackages', next);
  };
  const togglePackagePublished = (id) => {
    const next = computePackages.map(p => p.id === id ? { ...p, published: !p.published } : p);
    setComputePackages(next);
    persistAdminKey('computePackages', next);
  };

  // 管理员账号
  const addAdminAccount = (acc) => {
    const id = Date.now() + '';
    setAdminAccounts(prev => [...prev, { ...acc, id, createdAt: new Date().toISOString(), status: 'active' }]);
    return id;
  };
  const updateAdminAccount = (id, patch) => setAdminAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  const deleteAdminAccount = (id) => setAdminAccounts(prev => prev.filter(a => a.id !== id));
  const toggleAdminAccountStatus = (id) => setAdminAccounts(prev => prev.map(a => a.id === id ? { ...a, status: a.status === 'active' ? 'banned' : 'active' } : a));

  // AI 授权管理 CRUD（显式 persistKey 写回）
  const addAuthProvider = async (p) => {
    const id = 'auth' + Date.now();
    const previous = authProviders;
    const next = [...previous, { ...p, id, status: p.status || 'active', createdAt: new Date().toISOString() }];
    setAuthProviders(next);
    const result = await persistAdminKey('authProviders', next);
    if (!result.ok) { setAuthProviders(previous); return null; }
    return id;
  };
  const updateAuthProvider = async (id, patch) => {
    const previous = authProviders;
    const next = previous.map(a => a.id === id ? { ...a, ...patch } : a);
    setAuthProviders(next);
    const result = await persistAdminKey('authProviders', next);
    if (!result.ok) { setAuthProviders(previous); return false; }
    return true;
  };
  const deleteAuthProvider = async (id) => {
    const previous = authProviders;
    const next = previous.filter(a => a.id !== id);
    setAuthProviders(next);
    const result = await persistAdminKey('authProviders', next);
    if (!result.ok) { setAuthProviders(previous); return false; }
    return true;
  };

  // 操作日志
  const addLog = (adminName, action, target) => {
    setOperationLogs(prev => [{ id: Date.now() + Math.random(), adminName, action, target, createdAt: new Date().toISOString() }, ...prev]);
  };

  // 推荐配置 - Banner 轮播管理（全部显式 persistKey 写回）
  const addBanner = (b) => {
    const id = 'b' + Date.now();
    const maxOrder = banners.reduce((m, x) => Math.max(m, x.sortOrder || 0), 0);
    const next = [...banners, { ...b, id, sortOrder: maxOrder + 10, published: b.published !== false }];
    setBanners(next);
    persistAdminKey('banners', next);
    return id;
  };
  const updateBanner = (id, patch) => {
    const next = banners.map(b => b.id === id ? { ...b, ...patch } : b);
    setBanners(next);
    persistAdminKey('banners', next);
  };
  const deleteBanner = (id) => {
    const next = banners.filter(b => b.id !== id);
    setBanners(next);
    persistAdminKey('banners', next);
  };
  const toggleBanner = (id) => {
    const next = banners.map(b => b.id === id ? { ...b, published: !b.published } : b);
    setBanners(next);
    persistAdminKey('banners', next);
  };
  // Banner 排序：直接交换数组位置并重写 sortOrder（10 的倍数），
  // 这样无论消费方是否按 sortOrder 排序，视觉顺序都正确；也保证刷新后顺序稳定。
  const reorderBanner = (id, dir) => {
    const sorted = [...banners].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idx = sorted.findIndex(x => x.id === id);
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || next < 0 || next >= sorted.length) return;
    [sorted[idx], sorted[next]] = [sorted[next], sorted[idx]];
    const after = sorted.map((x, i) => ({ ...x, sortOrder: (i + 1) * 10 }));
    setBanners(after);
    persistAdminKey('banners', after);
  };

  // 公告通知：后台发布 / 编辑 / 删除（单 key 完整数组，走配置 KV 持久化）
  // 字段：id / version(版本号) / type(更新类型) / title(更新标题) / content(markdown) / publishedAt(发布时间) / createdAt / updatedAt
  const addAnnouncement = (a) => {
    const id = 'ann_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    const next = [{ ...a, id, publishedAt: a.publishedAt || now, createdAt: now, updatedAt: now }, ...announcements];
    setAnnouncements(next);
    persistAdminKey('announcements', next);
    return id;
  };
  const updateAnnouncement = (id, patch) => {
    const next = announcements.map(x => x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x);
    setAnnouncements(next);
    persistAdminKey('announcements', next);
  };
  const deleteAnnouncement = (id) => {
    const next = announcements.filter(x => x.id !== id);
    setAnnouncements(next);
    persistAdminKey('announcements', next);
  };

  // 推荐配置 - 首页推荐位（有序智能体/工作流 id 列表，显式 persistKey 写回）
  const addRecommended = (itemId) => {
    if (recommended.includes(itemId)) return;
    const next = [...recommended, itemId];
    setRecommended(next);
    persistAdminKey('recommended', next);
  };
  const removeRecommended = (itemId) => {
    const next = recommended.filter(x => x !== itemId);
    setRecommended(next);
    persistAdminKey('recommended', next);
  };
  const reorderRecommended = (itemId, dir) => {
    const idx = recommended.indexOf(itemId);
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || next < 0 || next >= recommended.length) return;
    const copy = [...recommended];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    setRecommended(copy);
    persistAdminKey('recommended', copy);
  };

  const togglePublished = async (id, kind) => {
    if (kind === 'agent') {
      const next = agents.map(a => a.id === id ? { ...a, published: !a.published } : a);
      setAgents(next);
      await persistAdminKey('agents', next);
    } else {
      const next = workflows.map(w => w.id === id ? { ...w, published: !w.published } : w);
      setWorkflows(next);
      await persistAdminKey('workflows', next);
    }
  };

  const setPrice = async (id, kind, field, value) => {
    if (kind === 'agent') {
      const next = agents.map(a => a.id === id ? { ...a, [field]: value } : a);
      setAgents(next);
      await persistAdminKey('agents', next);
    } else {
      const next = workflows.map(w => w.id === id ? { ...w, [field]: value } : w);
      setWorkflows(next);
      await persistAdminKey('workflows', next);
    }
  };

  // 智能体 / 工作流的增删改 + 排序（全部改成 async + persistKey，避免 silent overwrite）
  const swapSort = async (key, id, dir) => {
    const list = key === 'agents' ? agents : workflows;
    const sorted = [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idx = sorted.findIndex(x => x.id === id);
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || next < 0 || next >= sorted.length) return;
    const a = sorted[idx], b = sorted[next];
    const after = list.map(x => {
      if (x.id === a.id) return { ...x, sortOrder: b.sortOrder };
      if (x.id === b.id) return { ...x, sortOrder: a.sortOrder };
      return x;
    });
    if (key === 'agents') setAgents(after); else setWorkflows(after);
    await persistAdminKey(key, after);
  };
  const reorderAgent = (id, dir) => swapSort('agents', id, dir);
  const reorderWorkflow = (id, dir) => swapSort('workflows', id, dir);

  // 拖拽批量重排：传入「按新顺序排列的 id 数组」，把数组内 id 按 0..n-1 重写 sortOrder；
  // 不在 orderedIds 里的项保持原 sortOrder 不动（避免误伤其他项）。
  // 适用场景：单类型列表拖拽（智能体 tab / 工作流 tab），主人在「手动排序」模式下拖动行重排。
  const reorderAgentsByIds = async (orderedIds) => {
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    const next = agents.map(a => orderMap.has(a.id) ? { ...a, sortOrder: orderMap.get(a.id) } : a);
    setAgents(next);
    await persistAdminKey('agents', next);
  };
  const reorderWorkflowsByIds = async (orderedIds) => {
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    const next = workflows.map(x => orderMap.has(x.id) ? { ...x, sortOrder: orderMap.get(x.id) } : x);
    setWorkflows(next);
    await persistAdminKey('workflows', next);
  };

  // 智能体/工作流增删改：全部用 setState(prev => ...) updater 模式计算 next（不再依赖闭包里的 agents/workflows），
  // 彻底避免 UsesCell 等子组件的 onCommit 触发更新时，闭包里的 agents 是 stale state 的陷阱——
  // 一旦 stale，setAgents 写入的就是基于旧数据算出的 next（看起来 setState 成功），但 persistKey 写服务的也是旧版 next，
  // 主人编辑的字段没真正落盘，刷新就被服务端权威值覆盖。
  // 同步 await persistKey 拿 { ok }，失败时 setAgents(prev => 原值) 回滚 + 让调用方处理（UsesCell 显示 Toast）。
  const addAgent = async (a) => {
    const id = Date.now() + '';
    const prev = agentsRef.current;
    const next = [...prev, normalizeAgent({ ...a, id }, prev.length)];
    setAgents(next);
    const r = await persistAdminKey('agents', next);
    if (!r.ok) {
      setAgents(prev);
      return null;
    }
    return id;
  };
  const updateAgent = async (id, patch) => {
    const prevSnapshot = agentsRef.current;
    const next = prevSnapshot.map(x => x.id === id ? { ...x, ...patch } : x);
    setAgents(next);
    const r = await persistAdminKey('agents', next);
    if (!r.ok) {
      setAgents(prevSnapshot);
      return false;
    }
    return true;
  };
  const deleteAgent = async (id) => {
    const prevSnapshot = agentsRef.current;
    const next = prevSnapshot.filter(x => x.id !== id);
    setAgents(next);
    const recommendedNext = recommended.filter(x => x !== id);
    setRecommended(recommendedNext);
    const r = await persistAdminKey('agents', next);
    if (!r.ok) {
      setAgents(prevSnapshot);
      return false;
    }
    await persistAdminKey('recommended', recommendedNext);
    return true;
  };

  const addWorkflow = async (w) => {
    const id = Date.now() + '';
    const prev = workflowsRef.current;
    const next = [...prev, normalizeWorkflow({ ...w, id }, prev.length)];
    setWorkflows(next);
    const r = await persistAdminKey('workflows', next);
    if (!r.ok) {
      setWorkflows(prev);
      return null;
    }
    return id;
  };
  const updateWorkflow = async (id, patch) => {
    const prevSnapshot = workflowsRef.current;
    const next = prevSnapshot.map(x => x.id === id ? { ...x, ...patch } : x);
    setWorkflows(next);
    const r = await persistAdminKey('workflows', next);
    if (!r.ok) {
      setWorkflows(prevSnapshot);
      return false;
    }
    return true;
  };
  const deleteWorkflow = async (id) => {
    const prevSnapshot = workflowsRef.current;
    const next = prevSnapshot.filter(x => x.id !== id);
    setWorkflows(next);
    const recommendedNext = recommended.filter(x => x !== id);
    setRecommended(recommendedNext);
    const r = await persistAdminKey('workflows', next);
    if (!r.ok) {
      setWorkflows(prevSnapshot);
      return false;
    }
    await persistAdminKey('recommended', recommendedNext);
    return true;
  };

  // Category management（全部 async + persistKey）
  const addCategory = async (cat) => {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    const next = [...categories, {
      sortOrder: maxOrder + 10,
      showInSidebar: true,
      showInTags: true,
      showInHome: false,
      published: true,
      ...cat,
      id: Date.now() + '',
    }];
    setCategories(next);
    const r = await persistAdminKey('categories', next);
    return r.ok ? next[next.length - 1].id : null;
  };
  const updateCategory = async (id, patch) => {
    const next = categories.map(c => c.id === id ? { ...c, ...patch } : c);
    setCategories(next);
    const r = await persistAdminKey('categories', next);
    return r.ok;
  };
  const deleteCategory = async (id) => {
    const next = categories.filter(c => c.id !== id);
    setCategories(next);
    const r = await persistAdminKey('categories', next);
    return r.ok;
  };
  const reorderCategory = async (id, direction) => {
    const sorted = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idx = sorted.findIndex(c => c.id === id);
    const nextIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || nextIdx < 0 || nextIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[nextIdx];
    const next = categories.map(c => {
      if (c.id === a.id) return { ...c, sortOrder: b.sortOrder };
      if (c.id === b.id) return { ...c, sortOrder: a.sortOrder };
      return c;
    });
    setCategories(next);
    await persistAdminKey('categories', next);
  };

  // 大分组管理：新建 / 重命名（同步分类引用）/ 删除（分类归入无分组）/ 排序
  const addCategoryGroup = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    if (categoryGroups.some(g => g.name === trimmed)) return null; // 重名不创建
    const id = 'cg' + Date.now();
    const maxOrder = categoryGroups.reduce((m, g) => Math.max(m, g.sortOrder || 0), 0);
    const next = [...categoryGroups, { id, name: trimmed, sortOrder: maxOrder + 10 }];
    setCategoryGroups(next);
    persistAdminKey('categoryGroups', next);
    return id;
  };
  const updateCategoryGroup = (id, patch) => {
    const cur = categoryGroups.find(g => g.id === id);
    if (!cur) return false;
    const newName = (patch.name != null ? patch.name : cur.name).trim();
    if (!newName) return false;
    if (categoryGroups.some(g => g.id !== id && g.name === newName)) return false; // 重名不通过
    // 改名时同步到所有引用了该分组名的分类（categories 同样是 config key，需一并持久化）
    let categoriesNext = categories;
    if (newName !== cur.name) {
      categoriesNext = categories.map(c => c.group === cur.name ? { ...c, group: newName } : c);
      setCategories(categoriesNext);
    }
    const groupsNext = categoryGroups.map(g => g.id === id
      ? { ...g, name: newName, sortOrder: patch.sortOrder != null ? patch.sortOrder : g.sortOrder }
      : g);
    setCategoryGroups(groupsNext);
    addLog('系统', '编辑大分组', `大分组「${cur.name}」${newName !== cur.name ? `重命名为「${newName}」` : '已更新'}`);
    persistAdminKey('categoryGroups', groupsNext);
    if (newName !== cur.name) persistAdminKey('categories', categoriesNext);
    return true;
  };
  const deleteCategoryGroup = (id) => {
    const cur = categoryGroups.find(g => g.id === id);
    if (!cur) return false;
    const affected = categories.filter(c => c.group === cur.name && c.id !== 'all').length;
    // 删除分组：其下分类归入「无分组」
    const categoriesNext = categories.map(c => c.group === cur.name ? { ...c, group: '' } : c);
    const groupsNext = categoryGroups.filter(g => g.id !== id);
    setCategories(categoriesNext);
    setCategoryGroups(groupsNext);
    addLog('系统', '删除大分组', `已删除大分组「${cur.name}」，${affected} 个分类归入「无分组」`);
    persistAdminKey('categories', categoriesNext);
    persistAdminKey('categoryGroups', groupsNext);
    return true;
  };
  const reorderCategoryGroup = (id, dir) => {
    const sorted = [...categoryGroups].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const idx = sorted.findIndex(g => g.id === id);
    const next = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || next < 0 || next >= sorted.length) return;
    const a = sorted[idx], b = sorted[next];
    const after = categoryGroups.map(g => {
      if (g.id === a.id) return { ...g, sortOrder: b.sortOrder };
      if (g.id === b.id) return { ...g, sortOrder: a.sortOrder };
      return g;
    });
    setCategoryGroups(after);
    persistAdminKey('categoryGroups', after);
  };

  const publishedItems = () => [
    ...agents.filter(a => a.published).map(a => ({ ...a, kind: 'agent' })),
    ...workflows.filter(w => w.published).map(w => ({ ...w, kind: 'workflow' })),
  ];

  // 落地页 / 客服配置：全部显式 persistKey 写回（landing、customerService 均为 config key）
  const updateLanding = (patch) => { const next = { ...landing, ...patch }; setLanding(next); persistAdminKey('landing', next); };
  const updateLandingFeature = (idx, patch) => {
    const features = [...landing.features];
    features[idx] = { ...features[idx], ...patch };
    const next = { ...landing, features };
    setLanding(next); persistAdminKey('landing', next);
  };
  const addLandingFeature = (feature) => { const next = { ...landing, features: [...landing.features, feature] }; setLanding(next); persistAdminKey('landing', next); };
  const removeLandingFeature = (idx) => { const next = { ...landing, features: landing.features.filter((_, i) => i !== idx) }; setLanding(next); persistAdminKey('landing', next); };
  const updateLandingCta = (patch) => { const next = { ...landing, cta: { ...landing.cta, ...patch } }; setLanding(next); persistAdminKey('landing', next); };
  const updateLandingFooter = (patch) => { const next = { ...landing, footer: { ...landing.footer, ...patch } }; setLanding(next); persistAdminKey('landing', next); };
  const updateLandingFooterColumn = (idx, patch) => {
    const columns = [...landing.footer.columns];
    columns[idx] = { ...columns[idx], ...patch };
    const next = { ...landing, footer: { ...landing.footer, columns } };
    setLanding(next); persistAdminKey('landing', next);
  };
  const addLandingFooterColumn = () => { const next = { ...landing, footer: { ...landing.footer, columns: [...landing.footer.columns, { title: '新栏目', links: [] }] } }; setLanding(next); persistAdminKey('landing', next); };
  const removeLandingFooterColumn = (idx) => { const next = { ...landing, footer: { ...landing.footer, columns: landing.footer.columns.filter((_, i) => i !== idx) } }; setLanding(next); persistAdminKey('landing', next); };
  const updateLandingFooterLink = (colIdx, linkIdx, patch) => {
    const columns = landing.footer.columns.map((col, i) => {
      if (i !== colIdx) return col;
      const links = col.links.map((l, j) => j === linkIdx ? { ...l, ...patch } : l);
      return { ...col, links };
    });
    const next = { ...landing, footer: { ...landing.footer, columns } };
    setLanding(next); persistAdminKey('landing', next);
  };
  const addLandingFooterLink = (colIdx, link) => {
    const columns = landing.footer.columns.map((col, i) => i === colIdx ? { ...col, links: [...col.links, link] } : col);
    const next = { ...landing, footer: { ...landing.footer, columns } };
    setLanding(next); persistAdminKey('landing', next);
  };
  const removeLandingFooterLink = (colIdx, linkIdx) => {
    const columns = landing.footer.columns.map((col, i) => i === colIdx ? { ...col, links: col.links.filter((_, j) => j !== linkIdx) } : col);
    const next = { ...landing, footer: { ...landing.footer, columns } };
    setLanding(next); persistAdminKey('landing', next);
  };
  const updateLandingFooterLegalLink = (idx, patch) => {
    const legalLinks = landing.footer.legalLinks.map((l, i) => i === idx ? { ...l, ...patch } : l);
    const next = { ...landing, footer: { ...landing.footer, legalLinks } };
    setLanding(next); persistAdminKey('landing', next);
  };
  const addLandingFooterLegalLink = (link) => { const next = { ...landing, footer: { ...landing.footer, legalLinks: [...landing.footer.legalLinks, link] } }; setLanding(next); persistAdminKey('landing', next); };
  const removeLandingFooterLegalLink = (idx) => { const next = { ...landing, footer: { ...landing.footer, legalLinks: landing.footer.legalLinks.filter((_, i) => i !== idx) } }; setLanding(next); persistAdminKey('landing', next); };
  const resetLanding = () => { setLanding(LANDING_DEFAULT); persistAdminKey('landing', LANDING_DEFAULT); };
  const updateCustomerService = (patch) => { const next = { ...customerService, ...patch }; setCustomerService(next); persistAdminKey('customerService', next); };

  const value = {
    user, setUser, login, logout, register, loginWithEmail, loginWithWechat, bindWechat, unbindWechat, updateUserProfile, changePassword, cancelAccount, bindPhone, forgotPasswordVerify, forgotPasswordReset, registeredUsers,
    adminUser, adminLogin, adminLogout, adminPassword, changeAdminPassword,
    agents, setAgents, workflows, setWorkflows, categories, setCategories,
    sortedCategories: [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    addCategory, updateCategory, deleteCategory, reorderCategory,
    categoryGroups, setCategoryGroups, addCategoryGroup, updateCategoryGroup, deleteCategoryGroup, reorderCategoryGroup,
    orders, setOrders, computeRecords, setComputeRecords, adminUsers, setAdminUsers,
    assets, setAssets, addAsset, updateAsset, deleteAsset, addTask, createOrder,
    allAssets, loadUserAssets, refreshAllAssets, deleteAssetAdmin,
    computePackages, setComputePackages, adminAccounts, setAdminAccounts, operationLogs, setOperationLogs,
    authProviders, setAuthProviders, addAuthProvider, updateAuthProvider, deleteAuthProvider,
    points, setPoints, balance: points, deductPoints, rechargePoints, consume: deductPoints, addHistory, saveHistory: addHistory, history,
    loginModalOpen, setLoginModalOpen, requireLogin, pendingAction, setPendingAction,
    sidebarOpen, setSidebarOpen,
    togglePublished, setPrice, publishedItems,
    addAgent, updateAgent, deleteAgent, reorderAgent, reorderAgentsByIds,
    addWorkflow, updateWorkflow, deleteWorkflow, reorderWorkflow, reorderWorkflowsByIds,
    rechargeUserPoints, toggleUserStatus, deleteUser, adminResetUserPassword, updateOrderStatus,
    addComputePackage, updateComputePackage, deleteComputePackage, togglePackagePublished,
    addAdminAccount, updateAdminAccount, deleteAdminAccount, toggleAdminAccountStatus, addLog,
    banners, setBanners, recommended, setRecommended,
    addBanner, updateBanner, deleteBanner, toggleBanner, reorderBanner,
    addRecommended, removeRecommended, reorderRecommended,
    logo, setLogo,
    siteConfig, setSiteConfig, updateSiteConfig,
    landing, setLanding, updateLanding, updateLandingFeature, addLandingFeature, removeLandingFeature,
    updateLandingCta, updateLandingFooter, updateLandingFooterColumn, addLandingFooterColumn, removeLandingFooterColumn,
    updateLandingFooterLink, addLandingFooterLink, removeLandingFooterLink,
    updateLandingFooterLegalLink, addLandingFooterLegalLink, removeLandingFooterLegalLink, resetLanding,
    customerService, setCustomerService, updateCustomerService,
    announcements, setAnnouncements, addAnnouncement, updateAnnouncement, deleteAnnouncement,
    rechargeInfo, setRechargeInfo, saveRechargeInfo,
    legalAgreements, saveLegalAgreements,
    rechargeModalOpen, openRechargeModal, closeRechargeModal, rechargeExpiryDate, rechargeHideExpiry, getUserPlanStatus, refreshCurrentUser, refreshCurrentUserCompute,
    // admin 子页面 mount 时拉最新 adminUsers（2026-08-04 修复「点用户管理只看到新用户」）
    refreshAdminUsersFromServer,
    // admin/frontend 页面 mount 时拉最新列表/配置（2026-08-04 全面修复「侧边栏切模块看不到最新数据」）
    refreshAllAdminLists, refreshAllConfig,
    // 持久化失败提示（admin 显式操作写回服务端失败时，App 顶层 Toast 提示「同步失败，请刷新重试」）
    persistError, dismissPersistError: () => setPersistError(null),
    ensureUser: () => { if (!user) { setLoginModalOpen(true); return false; } return true; },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
