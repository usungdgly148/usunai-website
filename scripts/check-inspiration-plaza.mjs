// 回归：灵感广场（AI全能设计 作品墙）契约
//
// 覆盖三层：
//   1. 纯函数真跑（server/inspiration.mjs 的地址白名单 —— 安全边界，必须逐条验）
//   2. 前后端**分类清单一致性**（两份副本，最容易悄悄漂移）
//   3. 前后端接线与关键结构（游标分页 / 瀑布流 / 滚动增量加载 / 做同款回填）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INSPIRATION_CATEGORIES,
  INSPIRATION_MAX_ITEMS,
  INSPIRATION_PAGE_MAX,
  normalizeOwnImageUrl,
} from '../server/inspiration.mjs';
import { PLAZA_CATEGORIES } from '../frontend/src/inspirationCategories.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const serverSrc = read('server/index.mjs');
const inspirationSrc = read('server/inspiration.mjs');
const plazaSrc = read('frontend/src/InspirationPlaza.jsx');
const pageSrc = read('frontend/src/pages/ImageGen.jsx');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
}

// ===== 1. 地址白名单（安全边界）=====
check('接受本站图床相对地址', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2Fgen-1.png') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('把未编码斜杠规范化', normalizeOwnImageUrl('/api/blob/serve?key=uploads/gen-1.png') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('剥离多余 query', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2Fgen-1.png&x=1') === '/api/blob/serve?key=uploads%2Fgen-1.png');
check('拒绝外链', normalizeOwnImageUrl('https://evil.example.com/a.png') === '');
check('拒绝本站非图床路径', normalizeOwnImageUrl('https://www.usunai.top/uploads/gen-1.png') === '');
check('拒绝目录穿越', normalizeOwnImageUrl('/api/blob/serve?key=uploads%2F..%2F..%2Fetc%2Fpasswd') === '');
check('拒绝非 uploads 前缀', normalizeOwnImageUrl('/api/blob/serve?key=other%2Fgen-1.png') === '');
check('拒绝空值', normalizeOwnImageUrl('') === '' && normalizeOwnImageUrl(null) === '');
check('拒绝伪协议', normalizeOwnImageUrl('javascript:alert(1)') === '');

// ===== 2. 分类清单一致性（前端副本 vs 服务端真值）=====
const serverIds = INSPIRATION_CATEGORIES.map((item) => item.id).join(',');
const clientIds = PLAZA_CATEGORIES.map((item) => item.id).join(',');
check('前后端分类 id 完全一致', serverIds === clientIds, `服务端 ${serverIds} / 前端 ${clientIds}`);
check('分类数 = 6（全部 + 5 个可发布分类）', INSPIRATION_CATEGORIES.length === 6, String(INSPIRATION_CATEGORIES.length));
check('「全部」只用于筛选、不在发布白名单', inspirationSrc.includes("filter((item) => item.id !== 'all')"));

// ===== 3. 容量与分页 =====
check('作品总数有硬上限（防 KV 无限膨胀）', INSPIRATION_MAX_ITEMS === 300, String(INSPIRATION_MAX_ITEMS));
check('单页上限有界', INSPIRATION_PAGE_MAX === 40, String(INSPIRATION_PAGE_MAX));
check('超出上限丢最旧（slice 保留前 N 条）', inspirationSrc.includes('.slice(0, INSPIRATION_MAX_ITEMS)'));
check('列表用游标而不是页码', inspirationSrc.includes('nextCursor') && inspirationSrc.includes("u.searchParams.get('cursor')"));
check('发布前查重（同一张图不重复入广场）', inspirationSrc.includes('INSPIRATION_DUPLICATE'));

// ===== 4. 服务端接线 =====
check('index.mjs 已 import 灵感广场处理器', /import \{ handleInspiration \} from '\.\/inspiration\.mjs'/.test(serverSrc));
check('index.mjs 已接入路由', serverSrc.includes('handleInspiration(req, res, u, { KV, readBody, requireUser, getSession, isAdminSession })'));
check('发布需登录（requireUser）', inspirationSrc.includes("requireUser(req, res, '未登录，无法发布到灵感广场')"));
check('删除校验归属（本人或管理员）', inspirationSrc.includes('isOwner') && inspirationSrc.includes('isAdminSession(session)'));

// ===== 5. 前端结构：瀑布流 + 增量加载 =====
check('瀑布流用 CSS 多列实现', plazaSrc.includes('columns-2') && plazaSrc.includes('break-inside-avoid'));
check('图片懒加载', plazaSrc.includes('loading="lazy"'));
// ⚠️ 这里断言的是「滚动位置判断」而不是 IntersectionObserver ——
// 后者在"触发时正好有请求在飞"会永久丢事件（实测只加载到第 3 页就停），已弃用。
check('触底加载由滚动事件驱动', plazaSrc.includes("addEventListener('scroll'"));
check('提前 600px 预取', plazaSrc.includes('window.innerHeight + 600'));
check('加载完复查（视口没填满会续取）', plazaSrc.includes('[items.length, hasMore]'));
check('滚动加载不重复请求（防重入）', plazaSrc.includes('inflightRef'));
check('按 id 去重（游标翻页会因新增作品产生重叠）', plazaSrc.includes('seen.has(item.id)'));
check('切换分类/关键词会重置游标', plazaSrc.includes('cursorRef.current = 0'));
check('小屏不再依赖 hover（触屏可用）', plazaSrc.includes('opacity-100') && plazaSrc.includes('sm:group-hover:opacity-100'));

// ===== 6. 做同款 & 发布 =====
check('广场有「做同款」入口', plazaSrc.includes('做同款'));
check('做同款把提示词回调给页面', plazaSrc.includes('onUsePrompt?.(text)'));
check('页面接收回调并回填输入框', pageSrc.includes('<InspirationPlaza onUsePrompt={applyPrompt}') && pageSrc.includes("setPrompt(String(text || '')"));
check('页面挂载灵感广场组件', pageSrc.includes("from '../InspirationPlaza.jsx'"));
check('生成结果有「加入灵感广场」按钮', pageSrc.includes('加入灵感广场'));
check('发布调用 /api/inspiration/publish', pageSrc.includes("apiFetch('/api/inspiration/publish'"));
check('发布后让瀑布流刷新', pageSrc.includes('setPlazaToken'));
check('点赞走 /api/inspiration/like', plazaSrc.includes("apiFetch('/api/inspiration/like'"));
check('点赞失败会回滚', plazaSrc.includes('回滚'));

// ===== 7. 参数配置未被改版破坏（原有能力必须保留）=====
check('页面仍从服务端取模型/档位配置', pageSrc.includes("apiFetch('/api/image-gen/config')"));
check('页面仍提交 model/resolution/aspectRatio/images', pageSrc.includes('aspectRatio: aspect') && pageSrc.includes('model,') && pageSrc.includes('resolution,') && pageSrc.includes('images: toApiImages(refs)'));
check('页面仍处理 402 充值引导', pageSrc.includes('POINTS_INSUFFICIENT') && pageSrc.includes('openRechargeModal?.()'));

if (failures.length) {
  console.log(`\n[FAIL] ${failures.length}/${pass + failures.length} 项不通过：`);
  for (const item of failures) console.log('  ·', item);
  process.exit(1);
}
console.log(`\n[OK] inspiration-plaza 契约 ${pass}/${pass} 项全部通过`);
