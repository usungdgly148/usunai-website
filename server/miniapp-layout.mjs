import crypto from 'node:crypto';

export const MINIAPP_LAYOUT_PAGES = new Set(['home', 'category']);
/**
 * 区块白名单。
 * ⚠️ 这里每多一个类型，小程序渲染器就要多一个分支 —— 加之前先确认它真能被渲染出来。
 * 已移除 `quick-links`：渲染器里是 `return null` 的死块，后台摆着只会让人以为配上就有用。
 */
export const MINIAPP_LAYOUT_TYPES = new Set([
  'carousel',
  'announcements',
  'search',
  'categories',
  'featured-agents',
  'featured-workflows',
  'spacer',
]);

/**
 * 小程序内页白名单 —— 「点击链接」选「小程序页面」时只能从这里挑。
 *
 * ⚠️ 必须与 `miniapp/src/app.config.ts` 的 pages 数组保持一致（验证脚本会逐条比对）。
 * 故意**排除**两个页面：
 *   - `pages/detail/index` 需要 id 参数
 *   - `pages/webview/index` 需要 url 参数
 * 让运营从下拉里选这两个没有意义，选了也打不开。
 */
export const MINIAPP_INTERNAL_PAGES = [
  { path: '/pages/home/index', label: '首页' },
  { path: '/pages/announcements/index', label: '公告通知' },
  { path: '/pages/category/index', label: '分类（全部）' },
  { path: '/pages/search/index', label: '搜索' },
  { path: '/pages/chat/index', label: 'AI 智能体对话' },
  { path: '/pages/workflow/index', label: 'AI 工作流' },
  { path: '/pages/profile/index', label: '我的' },
  { path: '/pages/compute/index', label: '算力记录' },
  { path: '/pages/assets/index', label: '我的资产' },
  { path: '/pages/orders/index', label: '订单记录' },
  { path: '/pages/bind/index', label: '绑定账号' },
  { path: '/pages/account-security/index', label: '账号与安全' },
  { path: '/pages/legal/index', label: '政策协议' },
  { path: '/pages/recharge/index', label: '算力充值' },
  { path: '/pages/service/index', label: '联系客服' },
  { path: '/pages/hot/index', label: '热门智能体 / 工作流' },
];
const INTERNAL_PAGE_PATHS = new Set(MINIAPP_INTERNAL_PAGES.map((item) => item.path));

const MAX_BLOCKS = 40;
const MAX_VERSIONS = 30;

/**
 * 各区块「展示数量」的兜底值。featured-* 取 6 —— 与首页现状（网页版同源的 recommended 前 6）一致，
 * 所以放开 limit 硬上限之后，没被改过的布局看起来不会变。
 */
function defaultLimitFor(type) {
  if (String(type).startsWith('featured-')) return 6;
  if (type === 'categories') return 12;
  return 8;
}

/** 链接对象允许的 kind 白名单 */
const LINK_KINDS = new Set(['agent', 'workflow', 'page', 'category', 'external', 'none']);
const TARGET_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

const defaults = {
  home: ['carousel', 'announcements', 'search', 'categories', 'featured-agents', 'featured-workflows'],
  category: ['search', 'categories', 'featured-agents', 'featured-workflows'],
};

function text(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeColor(value) {
  const color = text(value, 16);
  if (!color) return '';
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) throw new Error('颜色必须使用十六进制格式');
  return color;
}

/**
 * 链接校验，两种形态都收：
 *  - 裸字符串（旧配置，**不迁移**）：只允许 `'/pages/...'` 或 `https://`
 *  - 对象（新配置）：{ kind: agent | workflow | page | category | external | none, ... }
 *    返回的对象是**小程序端可直接消费**的最小结构，多余字段一律丢弃（不吃未知输入）。
 * 返回 '' 表示没有跳转。
 */
function safeLink(value, label = '链接') {
  if (value == null || value === '' || typeof value === 'string') {
    const link = text(value, 500);
    if (!link) return '';
    if (link.startsWith('/pages/') || /^https:\/\//i.test(link)) return link;
    throw new Error(`${label}只允许 HTTPS 或小程序内部页面路径`);
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`);

  const kind = text(value.kind, 20);
  if (!LINK_KINDS.has(kind)) throw new Error(`${label}的跳转类型不在白名单中`);
  if (kind === 'none') return '';

  if (kind === 'agent' || kind === 'workflow') {
    const id = text(value.id, 100);
    const noun = kind === 'agent' ? '智能体' : '工作流';
    if (!id) throw new Error(`${label}：请选择具体的${noun}`);
    if (!TARGET_ID_PATTERN.test(id)) throw new Error(`${label}：${noun} ID 无效`);
    return { kind, id };
  }

  if (kind === 'page') {
    // 白名单比对的是**路径部分**；query 原样保留（历史配置里有 `/pages/hot/index?type=agent` 这类值，
    // 不保留等于把老配置改坏了）。
    const raw = text(value.path, 200);
    const [pathname, ...rest] = raw.split('?');
    const query = rest.join('?');
    if (!INTERNAL_PAGE_PATHS.has(pathname)) throw new Error(`${label}：只能选择已注册的小程序页面`);
    if (query && !/^[a-zA-Z0-9_=&%.\-]+$/.test(query)) throw new Error(`${label}：页面参数包含非法字符`);
    return { kind, path: query ? `${pathname}?${query}` : pathname };
  }

  if (kind === 'category') {
    const key = text(value.key, 100);
    if (!key) throw new Error(`${label}：请选择具体分类`);
    return { kind, key };
  }

  const url = text(value.url, 500);
  if (!/^https:\/\//i.test(url)) throw new Error(`${label}只允许 HTTPS 外部链接`);
  return { kind: 'external', url };
}

function safeImage(value) {
  const image = text(value, 500);
  if (!image) return '';
  if ((image.startsWith('/') && !image.startsWith('//')) || /^https:\/\//i.test(image)) return image;
  throw new Error('图片地址只允许 HTTPS 或站内绝对路径');
}

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function safeCarouselSlides(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 8) throw new Error('轮播图最多支持 8 张');
  return value.map((slide, index) => {
    if (!slide || typeof slide !== 'object') throw new Error(`第 ${index + 1} 张轮播图无效`);
    return {
      image: safeImage(slide.image),
      title: text(slide.title, 80),
      subtitle: text(slide.subtitle, 160),
      link: safeLink(slide.link, '轮播图链接'),
    };
  }).filter((slide) => slide.image);
}

function safeCategoryImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > 30) throw new Error('分类背景图最多支持 30 项');
  return Object.fromEntries(entries.map(([key, image]) => {
    const categoryKey = text(key, 100);
    if (!categoryKey) throw new Error('分类标识无效');
    return [categoryKey, safeImage(image)];
  }).filter(([, image]) => image));
}

export function defaultMiniappLayout(page) {
  const pageKey = MINIAPP_LAYOUT_PAGES.has(page) ? page : 'home';
  return {
    page: pageKey,
    blocks: defaults[pageKey].map((type, index) => ({
      id: `${type}-${index + 1}`,
      type,
      visible: true,
      title: '',
      image: '',
      backgroundColor: '',
      textColor: '',
      spacing: type === 'spacer' ? 24 : 16,
      link: '',
      slides: [],
      categoryImages: {},
      dataSource: type.startsWith('featured-') ? 'recommended' : '',
      limit: defaultLimitFor(type),
      searchPlaceholder: '',
      moreText: '',
      showMore: true,
    })),
  };
}

export function validateMiniappLayout(input, expectedPage = '') {
  if (!input || typeof input !== 'object') throw new Error('布局配置不能为空');
  const page = text(input.page || expectedPage, 20);
  if (!MINIAPP_LAYOUT_PAGES.has(page) || (expectedPage && page !== expectedPage)) throw new Error('页面标识无效');
  if (!Array.isArray(input.blocks) || input.blocks.length > MAX_BLOCKS) throw new Error(`区块数量必须在 0-${MAX_BLOCKS} 之间`);
  const ids = new Set();
  const dropped = [];
  const blocks = input.blocks.flatMap((block, index) => {
    /*
     * 未知区块类型 = 历史遗留（例如已下线的 quick-links），**只丢这一块**，保住其余配置的顺序与数值。
     * ⚠️ 这里绝对不能 throw：线上已发布的布局里就躺着一个 quick-links，
     *    throw 会让整份配置作废 —— 客户端回落到默认结构（首页顺序突变、多出一个区块），
     *    后台更危险：draft 校验失败 → 静默换成默认结构 → 主人一按「保存草稿」就把真配置覆盖掉。
     */
    if (!block || typeof block !== 'object' || !MINIAPP_LAYOUT_TYPES.has(block.type)) {
      if (block && typeof block === 'object' && block.type) dropped.push(String(block.type));
      return [];
    }
    const id = text(block.id, 80) || `${block.type}-${crypto.randomUUID().slice(0, 8)}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(`第 ${index + 1} 个区块 ID 无效或重复`);
    ids.add(id);
    return [{
      id,
      type: block.type,
      visible: block.visible !== false,
      title: text(block.title, 80),
      image: safeImage(block.image),
      backgroundColor: safeColor(block.backgroundColor),
      textColor: safeColor(block.textColor),
      spacing: numberInRange(block.spacing, 16, 0, 120),
      link: safeLink(block.link),
      slides: safeCarouselSlides(block.slides),
      categoryImages: safeCategoryImages(block.categoryImages),
      // 可配文案（B）：搜索框提示语 / 「更多」的文字 / 是否显示「更多」
      searchPlaceholder: text(block.searchPlaceholder, 40),
      moreText: text(block.moreText, 12),
      showMore: block.showMore !== false,
      dataSource: ['recommended', 'all', 'current-category', ''].includes(block.dataSource) ? block.dataSource : '',
      limit: numberInRange(block.limit, defaultLimitFor(block.type), 1, 24),
    }];
  });
  // 整份配置的区块全被丢掉（类型全不认识）才回落到默认结构，避免页面白屏
  if (!blocks.length && input.blocks.length) return defaultMiniappLayout(page);
  if (dropped.length) console.warn(`[miniapp-layout] ${page} 丢弃 ${dropped.length} 个未知区块: ${dropped.join(', ')}`);
  return { page, blocks };
}

const DEFAULT_MINIAPP_PUBLIC_ORIGIN = 'https://www.usunai.top';

function publicMediaUrl(value, origin) {
  const source = String(value || '').trim();
  if (!source || /^https:\/\//i.test(source)) return source;
  if (!source.startsWith('/') || source.startsWith('//')) return source;
  return `${origin.replace(/\/+$/, '')}${source}`;
}

export function prepareMiniappLayoutForClient(layout, origin = process.env.MINIAPP_PUBLIC_ORIGIN || DEFAULT_MINIAPP_PUBLIC_ORIGIN) {
  const result = JSON.parse(JSON.stringify(layout || {}));
  result.blocks = Array.isArray(result.blocks) ? result.blocks.map((block) => ({
    ...block,
    image: publicMediaUrl(block.image, origin),
    slides: Array.isArray(block.slides) ? block.slides.map((slide) => ({
      ...slide,
      image: publicMediaUrl(slide.image, origin),
    })) : [],
    categoryImages: block.categoryImages && typeof block.categoryImages === 'object'
      ? Object.fromEntries(Object.entries(block.categoryImages).map(([key, image]) => [key, publicMediaUrl(image, origin)]))
      : {},
  })) : [];
  return result;
}

const keys = (page) => ({
  draft: `miniapp_layout_draft_${page}`,
  versions: `miniapp_layout_versions_${page}`,
  published: `miniapp_layout_published_${page}`,
});

async function versionsFor(KV, page) {
  const value = await KV.kvGet(keys(page).versions);
  return Array.isArray(value) ? value : [];
}

export async function getMiniappLayoutAdmin(KV, page) {
  const key = keys(page);
  const [draftValue, versions, publishedId] = await Promise.all([
    KV.kvGet(key.draft),
    versionsFor(KV, page),
    KV.kvGet(key.published),
  ]);
  let draft;
  try { draft = validateMiniappLayout(draftValue || defaultMiniappLayout(page), page); }
  catch { draft = defaultMiniappLayout(page); }
  const published = versions.find((item) => item?.id === publishedId) || null;
  return {
    draft,
    published,
    versions: versions.map(({ layout: _layout, ...item }) => item),
    // 后台「点击链接」选择器要用：可选的小程序内页（唯一事实来源在服务端）
    pages: MINIAPP_INTERNAL_PAGES,
  };
}

export async function saveMiniappLayoutDraft(KV, page, layout) {
  const clean = validateMiniappLayout(layout, page);
  await KV.kvPut(keys(page).draft, clean);
  return clean;
}

export async function publishMiniappLayout(KV, page, layout = null, note = '') {
  const key = keys(page);
  const source = layout || await KV.kvGet(key.draft) || defaultMiniappLayout(page);
  const clean = validateMiniappLayout(source, page);
  const versions = await versionsFor(KV, page);
  const version = {
    id: `v_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    page,
    note: text(note, 120),
    createdAt: new Date().toISOString(),
    layout: clean,
  };
  const next = [version, ...versions].slice(0, MAX_VERSIONS);
  await KV.kvPutMany([[key.draft, clean], [key.versions, next], [key.published, version.id]]);
  return version;
}

export async function rollbackMiniappLayout(KV, page, versionId) {
  const versions = await versionsFor(KV, page);
  const source = versions.find((item) => item?.id === versionId);
  if (!source) throw new Error('历史版本不存在');
  return publishMiniappLayout(KV, page, source.layout, `回滚自 ${versionId}`);
}

export async function resolveMiniappLayout(KV, page) {
  const key = keys(page);
  const [versions, publishedId] = await Promise.all([versionsFor(KV, page), KV.kvGet(key.published)]);
  const ordered = [versions.find((item) => item?.id === publishedId), ...versions.filter((item) => item?.id !== publishedId)].filter(Boolean);
  for (const version of ordered) {
    try {
      return { layout: validateMiniappLayout(version.layout, page), versionId: version.id, source: version.id === publishedId ? 'published' : 'history' };
    } catch { /* try the next known-good version */ }
  }
  return { layout: defaultMiniappLayout(page), versionId: 'default', source: 'default' };
}

function send(res, statusCode, payload, cache = '') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(payload));
}

export async function handleMiniappLayout(req, res, url, { KV, requireAdmin, readBody }) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/api/miniapp/v1/layout') {
    const page = text(url.searchParams.get('page'), 20);
    if (!MINIAPP_LAYOUT_PAGES.has(page)) {
      send(res, 400, { ok: false, data: null, meta: { timestamp: new Date().toISOString() }, error: { code: 'INVALID_PAGE', message: '页面标识无效' } });
      return true;
    }
    const result = await resolveMiniappLayout(KV, page);
    send(res, 200, { ok: true, data: prepareMiniappLayoutForClient(result.layout), meta: { timestamp: new Date().toISOString(), versionId: result.versionId, source: result.source } }, 'public, max-age=30');
    return true;
  }

  const match = path.match(/^\/api\/admin\/miniapp-layouts\/(home|category)(?:\/(draft|publish|versions|rollback))?$/);
  if (!match) return false;
  if (!requireAdmin(req, res)) return true;
  const [, page, action = ''] = match;
  try {
    if (req.method === 'GET' && (!action || action === 'versions')) {
      const data = await getMiniappLayoutAdmin(KV, page);
      send(res, 200, { ok: true, data: action === 'versions' ? data.versions : data });
      return true;
    }
    const body = await readBody(req);
    if (req.method === 'PUT' && action === 'draft') {
      send(res, 200, { ok: true, data: await saveMiniappLayoutDraft(KV, page, body.layout) });
      return true;
    }
    if (req.method === 'POST' && action === 'publish') {
      send(res, 200, { ok: true, data: await publishMiniappLayout(KV, page, body.layout || null, body.note || '') });
      return true;
    }
    if (req.method === 'POST' && action === 'rollback') {
      send(res, 200, { ok: true, data: await rollbackMiniappLayout(KV, page, text(body.versionId, 100)) });
      return true;
    }
    send(res, 405, { ok: false, error: 'method not allowed' });
  } catch (error) {
    send(res, 400, { ok: false, error: error?.message || '布局配置无效' });
  }
  return true;
}
