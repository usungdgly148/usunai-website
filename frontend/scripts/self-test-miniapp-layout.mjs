/**
 * 后台「小程序设计」布局 schema 的自测（**服务端那份校验**，不是画布）。
 *
 * 为什么单独有这么一个脚本：这个项目的头号顽疾不是「功能不够」，而是「**配了没反应**」——
 * 后台面板里能填的字段，到了小程序要么不读、要么被服务端悄悄剥掉。所以每加一个可配字段，
 * 都要有断言把三件事钉死：
 *   1. 合法值**原样透传**（顺序、空串、对象形态都不能被改写）；
 *   2. 空值语义明确（`''` 是「不显示」这个合法状态，不是「缺失」）；
 *   3. 非法值**硬报错**（静默吞掉 = 又制造一种「配了没反应」）。
 *
 * 直接 import 服务端真模块，不 mock —— 断言的就是线上跑的那份代码。
 * 用法：node scripts/self-test-miniapp-layout.mjs
 */
import { validateMiniappLayout, defaultMiniappLayout, MAX_TOOL_CARDS } from '../../server/miniapp-layout.mjs';

let pass = 0; let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('  PASS', name); }
  else { fail += 1; console.log('  FAIL', name, '←', extra); }
}

const base = defaultMiniappLayout('home');
function build(patch) {
  return {
    page: 'home',
    blocks: base.blocks.map((b) => (b.type === 'tool-cards' ? { ...b, ...patch } : b)),
  };
}
const toolBlockOf = (doc) => validateMiniappLayout(doc, 'home').blocks.find((b) => b.type === 'tool-cards');

console.log('[1] 默认结构');
ok('home 默认区块里有 tool-cards', base.blocks.some((b) => b.type === 'tool-cards'));
ok('tool-cards 在 featured-agents 之后（热门智能体下方）', (() => {
  const types = base.blocks.map((b) => b.type);
  return types.indexOf('tool-cards') === types.indexOf('featured-agents') + 1;
})(), base.blocks.map((b) => b.type).join(','));
ok('默认 toolCards 为空数组', Array.isArray(base.blocks.find((b) => b.type === 'tool-cards').toolCards)
  && base.blocks.find((b) => b.type === 'tool-cards').toolCards.length === 0);

console.log('[2] 合法值透传');
const good = [
  { id: 't1', image: '/api/blob/serve?key=a', title: '文案生成', subtitle: '一句话出稿', link: { kind: 'page', path: '/pages/chat/index' } },
  { id: 't2', image: 'https://cdn.x/b.png', title: '图像处理', subtitle: '', link: { kind: 'external', url: 'https://usunai.top' } },
];
const out = toolBlockOf(build({ toolCards: good }));
ok('两张卡都在且顺序不变', out.toolCards.length === 2 && out.toolCards[0].id === 't1' && out.toolCards[1].id === 't2');
ok('站内图地址保留', out.toolCards[0].image === '/api/blob/serve?key=a');
ok('https 图地址保留', out.toolCards[1].image === 'https://cdn.x/b.png');
ok('主标保留', out.toolCards[0].title === '文案生成' && out.toolCards[1].title === '图像处理');
ok('副标留空＝空串（不是 undefined，也不是被兜底成默认文案）', out.toolCards[1].subtitle === '', JSON.stringify(out.toolCards[1].subtitle));
ok('link 对象透传', out.toolCards[0].link.kind === 'page' && out.toolCards[0].link.path === '/pages/chat/index');
ok('外链 link 透传', out.toolCards[1].link.kind === 'external' && out.toolCards[1].link.url === 'https://usunai.top');
ok('只回白名单字段（不吃未知输入）', Object.keys(out.toolCards[0]).sort().join(',') === 'id,image,link,subtitle,title', Object.keys(out.toolCards[0]).join(','));

console.log('[3] 空值语义');
const mixed = toolBlockOf(build({ toolCards: [
  { id: 'a', image: '', title: '', subtitle: '', link: '' },              // 全空 → 丢弃
  { id: 'b', image: '', title: '只有文字', subtitle: '', link: '' },       // 只有主标 → 保留
  { id: 'c', image: '/x.png', title: '', subtitle: '', link: '' },        // 只有图 → 保留
  { id: 'd', image: '', title: '', subtitle: '', link: { kind: 'page', path: '/pages/home/index' } }, // 只配了链接 → 服务端留住（不丢输入），渲染器不显示
] }));
ok('全空卡被丢弃', !mixed.toolCards.some((c) => c.id === 'a'));
ok('只有主标的卡保留（文案空＝不显示，但卡还在）', mixed.toolCards.some((c) => c.id === 'b' && c.title === '只有文字' && c.subtitle === ''));
ok('只有背景图的卡保留', mixed.toolCards.some((c) => c.id === 'c' && c.image === '/x.png' && c.title === ''));
ok('只配了链接的卡**保留**（丢掉＝运营保存后一刷新链接没了）', mixed.toolCards.some((c) => c.id === 'd' && c.link && c.link.path === '/pages/home/index'));
ok('结果恰好 3 张（只有 a 被丢）', mixed.toolCards.length === 3, `实际 ${mixed.toolCards.length}`);
ok('空数组照旧', toolBlockOf(build({ toolCards: [] })).toolCards.length === 0);
ok('缺字段照旧（undefined → 空数组）', toolBlockOf(build({ toolCards: undefined })).toolCards.length === 0);
ok('缺 id 会自动补一个合法的', (() => {
  const o = toolBlockOf(build({ toolCards: [{ image: '/x.png', title: 'T', subtitle: '', link: '' }] }));
  return o.toolCards.length === 1 && /^tool-[a-z0-9-]+$/.test(o.toolCards[0].id);
})());

console.log('[4] 非法值硬报错');
function expectThrow(name, patch) {
  try { toolBlockOf(build(patch)); ok(name, false, '未抛错'); }
  catch (e) { ok(name, true); console.log('       →', String(e.message).slice(0, 70)); }
}
expectThrow('toolCards 传字符串 → 报错', { toolCards: 'x' });
expectThrow('toolCards 传对象 → 报错', { toolCards: { a: 1 } });
expectThrow('卡片是 null → 报错', { toolCards: [null] });
expectThrow('图片用 http（非 https/站内）→ 报错', { toolCards: [{ id: 'a', image: 'http://x.com/a.png', title: 'T' }] });
expectThrow('链接指向未注册页面 → 报错', { toolCards: [{ id: 'a', title: 'T', link: { kind: 'page', path: '/pages/ghost/index' } }] });
expectThrow('智能体 id 非法 → 报错', { toolCards: [{ id: 'a', title: 'T', link: { kind: 'agent', id: '不 合法 ' } }] });
expectThrow(`超过 ${MAX_TOOL_CARDS} 张 → 报错`, { toolCards: Array.from({ length: MAX_TOOL_CARDS + 1 }, (_v, i) => ({ id: `t${i}`, title: 'T' })) });
expectThrow('卡片 id 带非法字符 → 报错', { toolCards: [{ id: 'a b', title: 'T' }] });

console.log('[5] 上限边界与截断');
ok(`恰好 ${MAX_TOOL_CARDS} 张可以通过`, (() => {
  try {
    const o = toolBlockOf(build({ toolCards: Array.from({ length: MAX_TOOL_CARDS }, (_v, i) => ({ id: `t${i}`, title: 'T' })) }));
    return o.toolCards.length === MAX_TOOL_CARDS;
  } catch { return false; }
})());
ok('主标超 20 字被截断到 20', (() => {
  const long = '一二三四五六七八九十一二三四五六七八九十一二三四五';
  const o = toolBlockOf(build({ toolCards: [{ id: 'a', title: long }] }));
  return o.toolCards[0].title.length === 20;
})());
ok('副标超 30 字被截断到 30', (() => {
  const long = 'x'.repeat(50);
  const o = toolBlockOf(build({ toolCards: [{ id: 'a', subtitle: long }] }));
  return o.toolCards[0].subtitle.length === 30;
})());

console.log('[6] 回归：别的块不受影响');
const reg = validateMiniappLayout(build({ toolCards: [] }), 'home');
ok('其余区块数量与顺序不变', reg.blocks.filter((b) => b.type !== 'tool-cards').map((b) => b.type).join(',')
  === base.blocks.filter((b) => b.type !== 'tool-cards').map((b) => b.type).join(','));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
