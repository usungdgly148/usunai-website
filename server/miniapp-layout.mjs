import crypto from 'node:crypto';

export const MINIAPP_LAYOUT_PAGES = new Set(['home', 'category']);
export const MINIAPP_LAYOUT_TYPES = new Set([
  'carousel',
  'announcements',
  'search',
  'categories',
  'featured-agents',
  'featured-workflows',
  'quick-links',
  'spacer',
]);

const MAX_BLOCKS = 40;
const MAX_VERSIONS = 30;

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

function safeLink(value, label = '链接') {
  const link = text(value, 500);
  if (!link) return '';
  if (link.startsWith('/pages/') || /^https:\/\//i.test(link)) return link;
  throw new Error(`${label}只允许 HTTPS 或小程序内部页面路径`);
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
      limit: type.startsWith('featured-') ? 8 : 12,
    })),
  };
}

export function validateMiniappLayout(input, expectedPage = '') {
  if (!input || typeof input !== 'object') throw new Error('布局配置不能为空');
  const page = text(input.page || expectedPage, 20);
  if (!MINIAPP_LAYOUT_PAGES.has(page) || (expectedPage && page !== expectedPage)) throw new Error('页面标识无效');
  if (!Array.isArray(input.blocks) || input.blocks.length > MAX_BLOCKS) throw new Error(`区块数量必须在 0-${MAX_BLOCKS} 之间`);
  const ids = new Set();
  const blocks = input.blocks.map((block, index) => {
    if (!block || typeof block !== 'object' || !MINIAPP_LAYOUT_TYPES.has(block.type)) throw new Error(`第 ${index + 1} 个区块类型不在白名单中`);
    const id = text(block.id, 80) || `${block.type}-${crypto.randomUUID().slice(0, 8)}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(`第 ${index + 1} 个区块 ID 无效或重复`);
    ids.add(id);
    return {
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
      dataSource: ['recommended', 'all', 'current-category', ''].includes(block.dataSource) ? block.dataSource : '',
      limit: numberInRange(block.limit, 8, 1, 24),
    };
  });
  return { page, blocks };
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
  return { draft, published, versions: versions.map(({ layout: _layout, ...item }) => item) };
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
    send(res, 200, { ok: true, data: result.layout, meta: { timestamp: new Date().toISOString(), versionId: result.versionId, source: result.source } }, 'public, max-age=30');
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
