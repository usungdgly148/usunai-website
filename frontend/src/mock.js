export const SVG_URL = (w, h, color, text) => {
  const hex = color.replace('#', '');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='%23${hex}' rx='${Math.min(w,h)/2}' ry='${Math.min(w,h)/2}'/><text x='50%' y='55%' font-size='${Math.min(w,h)/2.2}' font-family='Arial,sans-serif' font-weight='bold' text-anchor='middle' dominant-baseline='middle' fill='white'>${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// 分类字段说明：
//  sortOrder    排序权重（升序，越小越靠前）
//  showInSidebar 是否显示在前台左侧导航
//  showInTags   是否显示在首页 Banner 下方的分类标签区
//  showInHome   是否作为首页热门快捷入口（带 🔥 标记）
//  published    是否启用（false 为软下架，前台任何位置都不出现）
export const MOCK_CATEGORIES = [
  { id: 'all', name: '全部', icon: 'Home', color: 'bg-slate-100 text-slate-600', group: '', sortOrder: 0, showInSidebar: false, showInTags: false, showInHome: false, published: true },
  { id: 'copy', name: '文案获客', icon: 'FileText', color: 'bg-blue-50 text-blue-600', group: '内容获客', sortOrder: 10, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'short-video', name: '短视频', icon: 'Video', color: 'bg-rose-50 text-rose-600', group: '内容获客', sortOrder: 20, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'xhs', name: '小红书', icon: 'BookOpen', color: 'bg-red-50 text-red-600', group: '内容获客', sortOrder: 30, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'live', name: '直播运营', icon: 'Radio', color: 'bg-pink-50 text-pink-600', group: '内容获客', sortOrder: 40, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'private', name: '私域转化', icon: 'MessageCircle', color: 'bg-green-50 text-green-600', group: '成交增长', sortOrder: 50, showInSidebar: true, showInTags: true, showInHome: false, published: true },
  { id: 'geo', name: 'GEO 获客', icon: 'Search', color: 'bg-teal-50 text-teal-600', group: '成交增长', sortOrder: 60, showInSidebar: true, showInTags: true, showInHome: false, published: true },
  { id: 'image', name: 'AI 生图', icon: 'Image', color: 'bg-purple-50 text-purple-600', group: 'AI 创作', sortOrder: 70, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'video', name: 'AI 生视频', icon: 'Clapperboard', color: 'bg-indigo-50 text-indigo-600', group: 'AI 创作', sortOrder: 80, showInSidebar: true, showInTags: true, showInHome: true, published: true },
  { id: 'advisor', name: '老板顾问', icon: 'Briefcase', color: 'bg-amber-50 text-amber-600', group: '经营工具', sortOrder: 90, showInSidebar: true, showInTags: true, showInHome: false, published: true },
  { id: 'ecom', name: '电商工具', icon: 'ShoppingBag', color: 'bg-cyan-50 text-cyan-600', group: '经营工具', sortOrder: 100, showInSidebar: true, showInTags: true, showInHome: false, published: true },
];

// 大分组（前台左侧导航的分组标题）。分类的 group 字段存储分组「名称」字符串。
// 该列表可在后台「分类管理 - 大分组管理」中自由新建/重命名/删除/排序，不再固定。
export const MOCK_CATEGORY_GROUPS = [
  { id: 'g-content', name: '内容获客', sortOrder: 10 },
  { id: 'g-deal', name: '成交增长', sortOrder: 20 },
  { id: 'g-ai', name: 'AI 创作', sortOrder: 30 },
  { id: 'g-tool', name: '经营工具', sortOrder: 40 },
];

export const BANNER_SLIDES = [
  { id: 1, image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&auto=format&fit=crop', color: 'from-blue-400/10 to-transparent' },
  { id: 2, image: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&auto=format&fit=crop', color: 'from-rose-400/10 to-transparent' },
  { id: 3, image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1200&auto=format&fit=crop', color: 'from-red-400/10 to-transparent' },
];

// 推荐配置 - 首页 Banner 轮播（后台可编辑，store 初始数据）
// 纯图片 Banner，color 为整层遮罩渐变，to 为可选点击图片跳转目标
export const MOCK_BANNERS = [
  { id: 'b1', sortOrder: 10, image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&auto=format&fit=crop', to: '/agents', color: 'from-slate-900/80 via-slate-900/40 to-transparent', published: true },
  { id: 'b2', sortOrder: 20, image: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&auto=format&fit=crop', to: '/agents', color: 'from-blue-950/80 via-slate-900/40 to-transparent', published: true },
  { id: 'b3', sortOrder: 30, image: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1200&auto=format&fit=crop', to: '/agents', color: 'from-rose-950/80 via-slate-900/40 to-transparent', published: true },
];

// 推荐配置 - 首页推荐位（有序的智能体/工作流 id 列表）
// 空数组 = 前台按上架顺序自动取前 6 个展示
export const MOCK_RECOMMENDED = [];

export const MOCK_AGENTS = [
  {
    id: 'a1',
    name: '获客成交型文案',
    desc: '针对微信、朋友圈、落地页的高转化成交文案，掌握钩子+信任背书+行动指令。',
    kind: 'agent',
    category: 'copy',
    views: 284000,
    uses: 6764,
    works: 8237,
    rating: 4.9,
    published: true,
    priceType: 'token',
    priceRate: 8,
    iconColor: 'bg-blue-600',
    iconText: '文',
    icon: 'FileText',
    cardGradient: 'bg-gradient-to-b from-blue-400 to-blue-100',
    cardBg: 'bg-gradient-to-br from-blue-50/60 to-white',
    instructions: `【必填信息】
1. IP人设定位：一句话描述我是谁、在哪里、做什么行业赛道、我提供什么价值。
2. 目标用户：内容给谁看？
3. 具体需求：你想做什么主题/选题？
4. 视频时长：有特定时长要求吗？`,
    opening: `请你直接提供以下信息，我会根据这些为你创作高转化获客文案：\n\n1. 主题/选题：用一句话说清你想讲什么。\n2. 你的身份/行业赛道：你是谁，做什么的？\n3. 目标受众：你这条内容主要讲给谁听？\n4. 其他要求：比如产品、服务优势或字数要求。\n\n【参考示例】\n• 装修行业示例：主题是装修，千万别信免费设计。我是一名在广州做了十年的装修设计师，自己开工作室。目标受众是准备装第一套房子、预算有限但又有一定要求的年轻业主。文案要求 500 字左右。`,
    platform: 'coze-new',
    apiKey: '__REDACTED_COZE_PAT__',
    baseUrl: 'https://p53jnfvr43.coze.site',
    projectId: '7486420193100851234',
    suggestedQuestions: ['我想写一篇装修公司的成交文案', '帮我写一条朋友圈招生文案', '给门店写一段短视频口播'],
    model: 'doubao-pro-32k',
    temperature: 0.7,
    maxTokens: 2048,
    tags: ['文案', '获客', '成交'],
    sortOrder: 10,
  },
  {
    id: 'a2',
    name: '神级短视频文案',
    desc: '黄金3秒钩子+反转+卖点+引导，适配抖音/视频号算法偏好的爆款脚本。',
    kind: 'agent',
    category: 'short-video',
    views: 342000,
    uses: 3100,
    works: 2800,
    rating: 4.8,
    published: true,
    priceType: 'token',
    priceRate: 5,
    iconColor: 'bg-green-600',
    iconText: '短',
    icon: 'Clapperboard',
    cardGradient: 'bg-gradient-to-b from-green-400 to-green-100',
    cardBg: 'bg-gradient-to-br from-green-50/60 to-white',
    instructions: `【必填信息】
1. 视频主题/内容
2. 目标平台：抖音、视频号、小红书
3. 目标人群
【选填】风格：悬念型、数字型、痛点型、反转型`,
    opening: `我会帮你写一条短视频口播文案。请直接告诉我：\n\n1. 视频主题/内容：你想拍什么？\n2. 目标平台：抖音、视频号还是小红书？\n3. 目标人群：给谁看？\n4. 风格偏好：悬念型、数字型、痛点型、反转型？（可选）\n\n【参考示例】\n• 主题是装修获客，平台抖音，目标人群是刚买房的90后，风格用痛点型。`,
  },
  {
    id: 'a3',
    name: '口播文案全能创作',
    desc: '根据人设、行业、产品特点自然口语化输出，拒绝 AI 感，像真人聊天。',
    kind: 'agent',
    category: 'copy',
    views: 227000,
    uses: 1800,
    works: 1500,
    rating: 4.7,
    published: true,
    priceType: 'token',
    priceRate: 6,
    iconColor: 'bg-indigo-600',
    iconText: '播',
    icon: 'Mic',
    cardGradient: 'bg-gradient-to-b from-blue-400 to-blue-100',
    cardBg: 'bg-gradient-to-br from-indigo-50/60 to-white',
    instructions: `【必填信息】
1. IP人设定位
2. 目标用户
3. 具体需求
4. 视频时长`,
    opening: `请告诉我你想创作什么类型的口播文案，我会用自然口语化的方式输出，避免 AI 感。\n\n1. IP人设定位：一句话介绍你是谁。\n2. 目标用户：这条内容给谁看？\n3. 具体需求：做什么主题/选题？\n4. 视频时长：有特定时长要求吗？\n\n我会直接给出可直接出镜口播的完整文案。`,
  },
  {
    id: 'a4',
    name: '小红书图文爆款复刻',
    desc: '粘贴爆款链接，AI 自动拆解结构、语气、标签，产出同款原创笔记。',
    kind: 'agent',
    category: 'xhs',
    views: 193000,
    uses: 2200,
    works: 1900,
    rating: 4.8,
    published: true,
    priceType: 'token',
    priceRate: 6,
    iconColor: 'bg-red-600',
    iconText: '红',
    icon: 'Image',
    cardGradient: 'bg-gradient-to-b from-red-400 to-red-100',
    cardBg: 'bg-gradient-to-br from-red-50/60 to-white',
    instructions: `【必填信息】
1. 赛道/品类
2. 目标人群
3. 内容主题
4. 参考笔记
【选填】品牌卖点、转化动作、语气风格`,
    opening: `请提供以下信息，我会帮你拆解爆款结构并产出同款小红书笔记：\n\n1. 赛道/品类：你做什么行业？\n2. 目标人群：笔记写给谁看？\n3. 内容主题：想写什么？\n4. 参考笔记：可粘贴对标标题或链接。\n5. 品牌卖点/转化动作/语气风格（可选）。\n\n我会输出标题、正文、话题标签和配图建议。`,
  },
  {
    id: 'a5',
    name: '直播操盘大师',
    desc: '生成整场直播脚本、话术节奏、排品策略、互动爆点安排，小白也能开好直播间。',
    kind: 'agent',
    category: 'live',
    vip: true,
    views: 121000,
    uses: 900,
    works: 800,
    rating: 4.5,
    published: true,
    priceType: 'token',
    priceRate: 8,
    iconColor: 'bg-amber-600',
    iconText: '播',
    icon: 'Video',
    cardGradient: 'bg-gradient-to-b from-amber-400 to-amber-100',
    cardBg: 'bg-gradient-to-br from-pink-50/60 to-white',
    instructions: `【必填信息】
1. 直播品类
2. 产品卖点
3. 直播场景
4. 目标人群`,
    opening: `请提供以下信息，我会帮你生成整场直播脚本、话术节奏和排品策略：\n\n1. 直播品类：卖什么？\n2. 产品卖点：核心优势是什么？\n3. 直播场景：门店、工厂、展厅还是家里？\n4. 目标人群：给谁看？\n\n我会输出开场、产品讲解、互动爆点、逼单、下播等完整话术。`,
  },
  {
    id: 'a6',
    name: '朋友圈月度规划',
    desc: '一次性规划 30 天朋友圈内容矩阵，专业+生活+种草+成交比例科学搭配。',
    kind: 'agent',
    category: 'private',
    views: 158000,
    uses: 800,
    works: 700,
    rating: 4.9,
    published: true,
    priceType: 'token',
    priceRate: 4,
    iconColor: 'bg-emerald-600',
    iconText: '私',
    icon: 'Calendar',
    cardGradient: 'bg-gradient-to-b from-emerald-400 to-emerald-100',
    cardBg: 'bg-gradient-to-br from-emerald-50/60 to-white',
    instructions: `【必填信息】
1. 人设定位
2. 今日想传达的信息
3. 客户画像
【选填】配图风格、发布时段、引导动作`,
    opening: `请提供以下信息，我会一次性为你规划 30 天朋友圈内容矩阵：\n\n1. 人设定位：你是谁，做什么？\n2. 今日想传达的信息：今天想推什么？\n3. 客户画像：朋友圈主要客户是谁？\n4. 配图风格、发布时段、引导动作（可选）。\n\n我会按专业、生活、种草、成交比例输出每日文案。`,
  },
];

export const MOCK_WORKFLOWS = [
  {
    id: 'w1',
    name: '短视频下载+文案提取',
    desc: '粘贴短视频链接，自动下载并提取文案、话题标签。',
    kind: 'workflow',
    category: 'short-video',
    views: 520000,
    uses: 1300,
    works: 1600,
    rating: 4.8,
    published: true,
    priceType: 'run',
    priceRate: 3,
    iconColor: 'bg-lime-600',
    iconText: '下',
    icon: 'Video',
    cardGradient: 'bg-gradient-to-b from-lime-400 to-lime-100',
    cardBg: 'bg-gradient-to-br from-lime-50/60 to-white',
    formFields: [
      { key: 'url', label: '视频链接', type: 'text', required: true, placeholder: '粘贴抖音/视频号/小红书/快手链接' },
      { key: 'need_download', label: '同时下载视频', type: 'checkbox', required: false },
    ],
  },
  {
    id: 'w2',
    name: '全屋定制报价师',
    desc: '输入户型、选材、面积，快速生成全屋定制报价单。',
    kind: 'workflow',
    category: 'ecom',
    views: 84300,
    uses: 420,
    works: 380,
    rating: 4.6,
    published: true,
    priceType: 'run',
    priceRate: 10,
    iconColor: 'bg-cyan-600',
    iconText: '报',
    icon: 'ShoppingBag',
    cardGradient: 'bg-gradient-to-b from-cyan-400 to-cyan-100',
    cardBg: 'bg-gradient-to-br from-cyan-50/60 to-white',
    formFields: [
      { key: 'city', label: '城市', type: 'text', required: true, placeholder: '如：杭州' },
      { key: 'area', label: '面积(m²)', type: 'number', required: true, placeholder: '如：89' },
      { key: 'rooms', label: '户型', type: 'select', required: true, options: ['一室一厅', '两室一厅', '三室两厅', '四室两厅'], default: '三室两厅' },
      { key: 'material', label: '主材偏好', type: 'select', required: true, options: ['颗粒板', '多层板', '实木', '进口板材'], default: '颗粒板' },
      { key: 'budget', label: '预算区间', type: 'select', required: false, options: ['5万以内', '5-10万', '10-20万', '20万以上'], default: '5-10万' },
    ],
  },
  {
    id: 'w3',
    name: 'AI 商品主图',
    desc: '上传产品图，自动生成电商主图、详情首图、白底图。',
    kind: 'workflow',
    category: 'image',
    vip: true,
    views: 210000,
    uses: 950,
    works: 1100,
    rating: 4.7,
    published: true,
    priceType: 'run',
    priceRate: 15,
    iconColor: 'bg-purple-600',
    iconText: '图',
    icon: 'Image',
    cardGradient: 'bg-gradient-to-b from-purple-400 to-purple-100',
    cardBg: 'bg-gradient-to-br from-purple-50/60 to-white',
    formFields: [
      { key: 'image', label: '上传产品图', type: 'upload', required: true, placeholder: '点击选择或拖拽图片' },
      { key: 'scene', label: '场景风格', type: 'select', required: true, options: ['简约白底', '家居场景', '高端奢石', '奶油风'], default: '家居场景' },
      { key: 'size', label: '输出尺寸', type: 'select', required: true, options: ['1:1', '3:4', '16:9'], default: '1:1' },
    ],
  },
  {
    id: 'w4',
    name: '图生视频',
    desc: '上传参考图，生成电影级视频分镜，支持多种比例与时长。',
    kind: 'workflow',
    category: 'video',
    vip: true,
    views: 121000,
    uses: 849,
    works: 2168,
    rating: 4.8,
    published: true,
    priceType: 'run',
    priceRate: 50,
    iconColor: 'bg-indigo-600',
    iconText: '影',
    icon: 'Clapperboard',
    cardGradient: 'bg-gradient-to-b from-indigo-400 to-indigo-100',
    cardBg: 'bg-gradient-to-br from-indigo-50/60 to-white',
    formFields: [
      { key: 'image', label: '上传参考图', type: 'upload', required: true, placeholder: '点击选择或拖拽本地文件上传' },
      { key: 'ratio', label: '视频比例', type: 'select', required: true, options: ['9:16', '16:9'], default: '9:16' },
      { key: 'duration', label: '视频时长(秒)', type: 'select', required: true, options: ['5', '10', '15'], default: '10' },
      { key: 'prompt', label: '视频提示词', type: 'textarea', required: true, placeholder: '请输入：画面主体、动作、场景、风格等描述' },
    ],
  },
  {
    id: 'w5',
    name: 'GEO 搜索优化',
    desc: '把产品卖点改造成 GEO/AI 搜索可引用、可核验的推荐内容。',
    kind: 'workflow',
    category: 'geo',
    views: 90000,
    uses: 340,
    works: 280,
    rating: 4.5,
    published: true,
    priceType: 'run',
    priceRate: 12,
    iconColor: 'bg-teal-600',
    iconText: 'G',
    icon: 'Search',
    cardGradient: 'bg-gradient-to-b from-teal-400 to-teal-100',
    cardBg: 'bg-gradient-to-br from-teal-50/60 to-white',
    formFields: [
      { key: 'content', label: '原文内容', type: 'textarea', required: true, placeholder: '粘贴产品页、公众号文章或白皮书内容' },
      { key: 'product', label: '产品名', type: 'text', required: true, placeholder: '如：友尚不锈钢橱柜' },
      { key: 'keywords', label: '目标关键词', type: 'text', required: false, placeholder: '用逗号分隔多个关键词' },
    ],
  },
  {
    id: 'w6',
    name: '装修避坑顾问',
    desc: '专为装修家居建材老板打造，提供获客话术、客户异议处理、签单策略。',
    kind: 'workflow',
    category: 'advisor',
    views: 310000,
    uses: 1800,
    works: 1500,
    rating: 4.7,
    published: true,
    priceType: 'run',
    priceRate: 10,
    iconColor: 'bg-amber-600',
    iconText: '问',
    icon: 'Briefcase',
    cardGradient: 'bg-gradient-to-b from-amber-400 to-amber-100',
    cardBg: 'bg-gradient-to-br from-amber-50/60 to-white',
    formFields: [
      { key: 'identity', label: '你的身份', type: 'select', required: true, options: ['门店老板', '品牌方', '经销商', '设计师'], default: '门店老板' },
      { key: 'city', label: '所在城市', type: 'text', required: true, placeholder: '如：杭州' },
      { key: 'product', label: '主营品类', type: 'select', required: true, options: ['全屋定制', '瓷砖', '卫浴', '门窗', '软装'], default: '全屋定制' },
      { key: 'pain', label: '当前困惑', type: 'textarea', required: true, placeholder: '客户到店率低、报价后没下文、抖音没流量等' },
    ],
  },
];

// 2026-08-04 商用清理：清空开发期 mock 用户数据（王老板/李店长等测试账号）。
// 后台用户列表只以服务端 user_<id> 为准（adminFetch 拉全量）；这里兜底为空，不再出现假用户。
export const MOCK_ADMIN_USERS = [];

export const MOCK_COMPUTE_PACKAGES = [
  { id: 'p1', name: '新人礼包', points: 100, price: 9.9, published: true, sortOrder: 10 },
  { id: 'p2', name: '专业版月付', points: 500, price: 99, published: true, sortOrder: 20 },
  { id: 'p3', name: '团队版月付', points: 2000, price: 299, published: true, sortOrder: 30 },
  { id: 'p4', name: '企业年付', points: 30000, price: 1999, published: false, sortOrder: 40 },
];

// 2026-08-04 商用清理：清空 mock 运营账号（运营小美/客服小林是开发期假数据）
export const MOCK_ADMIN_ACCOUNTS = [];

export const MOCK_OPERATION_LOGS = [];

// 2026-08-04 商用清理：清空 mock 算力流水（u1/u2/u3 测试用户数据）
export const MOCK_COMPUTES = [];

// 2026-08-04 商用清理：清空 mock 订单（u1/u2/u3 测试订单）
export const MOCK_ORDERS = [];

export const ASSET_TYPE_LABELS = {
  task: '任务', copy: '文案', image: '图片', video: '视频', audio: '音频', graphic: '图文',
};

export const ASSET_STATUS_LABELS = { success: '成功', running: '运行中', failed: '失败' };

export const ORDER_TYPE_LABELS = { compute: '算力', source: '源码' };

// 2026-08-04 商用清理：清空 mock 资产（u1/u2 测试资产）
export const MOCK_ASSETS = [];
