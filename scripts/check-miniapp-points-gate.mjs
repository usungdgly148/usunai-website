import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * 回归：「算力不足」弹窗引导（小程序 / 智能体对话 + 工作流）。
 *
 * 背景：新用户是**静默登录即注册**，号上一分算力都没有。改造前点发送只在对话气泡里回一句
 * 「调用失败：算力不足，请先充值」、输入框上方再挂一条红字 —— 两处都是**死的文字**，
 * 既不能点，也没告诉用户「去哪儿充值」。本次改为弹窗 + 一键跳充值页。
 *
 * 契约（改任何一条都会让这个脚本红）：
 *   ① 识别信号三个都要认，缺一个就会有一整条链路漏判：
 *        · `statusCode === 402`  —— 对话被服务端拒绝（服务端**没给错误码**，状态码是当前唯一稳的机器信号）
 *        · `code === 'POINTS_INSUFFICIENT'` —— 日后服务端补码的正式契约（提前认下）
 *        · 文案含「算力不足」     —— SSE 流内报错 + 工作流后台任务 `task.error` 都只有字符串
 *   ② **失败即放行**：拿不到档案 / `points` 缺失（老服务端）一律不拦，交给服务端那道闸门。
 *      宁可漏拦，也不要因为一次取档案失败把还能用的用户挡在门外。
 *   ③ 只在 `points <= 0` 时拦；`points > 0` 但「不够本次消耗」只有服务端算得出（工作流成本随配置变化），
 *      必须由工作流**任务状态**那条路接住。
 *   ④ 并发去重：发送按钮在预检期间并不置 `sending`，连点两下会叠出两个弹窗 → 模块级 promise 收敛。
 *   ⑤ 跳转失败必须退化：页面栈满（上限 10 层）时 `navigateTo` 会失败，退回 `redirectTo`。
 *   ⑥ 门禁顺序必须与服务端一致：手机号 → 套餐 → 算力。**刻意不把算力提到套餐之前** ——
 *      对「0 算力 + 非 VIP」的新用户服务端先回 `VIP_REQUIRED`，客户端先弹「去充值」
 *      只会把人往错方向引（充完回来照样撞 VIP）。
 *   ⑦ 算力不足**不得**让对话页进入错误态（`setError('')`），否则红色横幅 + PageState 会一起翻脸。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const gateSource = read('miniapp/src/utils/points-gate.ts');
const chatSource = read('miniapp/src/pages/chat/index.tsx');
const workflowSource = read('miniapp/src/pages/workflow/index.tsx');
const vipGateSource = read('miniapp/src/utils/vip-gate.ts');
const apiSource = read('miniapp/src/services/api.ts');
const serverIndex = read('server/index.mjs');
const runtimeSource = read('server/miniapp-runtime.mjs');

// ─────────────────────────────────────────────────────────────────────────────
// 第一部分：把真实的 points-gate.ts 转成 CJS 跑起来（不是另写一份等价逻辑 —— 那测不到真代码）
// ─────────────────────────────────────────────────────────────────────────────
const require_ = createRequire(import.meta.url);
const ts = require_(path.join(repoRoot, 'miniapp/node_modules/typescript'));

const transpile = (source, fileName) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName,
}).outputText;

/** 一次「页面」会话：独立的弹窗 / 跳转记录 + 可控的档案返回。 */
const createHarness = ({ profile, modalConfirm = true, source = gateSource, fileName = 'points-gate.ts' } = {}) => {
  const calls = { showModal: [], navigateTo: [], redirectTo: [], getMe: 0 };
  let pendingModal = null;
  const state = {
    profile,
    profileThrows: false,
    modalConfirm,
    modalQueue: null, // 设成数组时用于手工控制多个弹窗的 resolve 时机
    navigateThrows: false,
    redirectThrows: false,
  };

  const Taro = {
    showModal(options) {
      calls.showModal.push(options);
      if (state.modalQueue) return new Promise((resolve) => state.modalQueue.push(() => resolve({ confirm: state.modalConfirm, cancel: !state.modalConfirm })));
      pendingModal = { options };
      return Promise.resolve({ confirm: state.modalConfirm, cancel: !state.modalConfirm });
    },
    async navigateTo(options) {
      calls.navigateTo.push(options);
      if (state.navigateThrows) throw new Error('navigateTo:fail page limit exceeded');
    },
    async redirectTo(options) {
      calls.redirectTo.push(options);
      if (state.redirectThrows) throw new Error('redirectTo:fail');
    },
  };
  // esModuleInterop 下 `import Taro from '…'` 会读 `.default`；两种读法都给到同一个桩。
  const taroModule = { __esModule: true, default: Taro, ...Taro };

  const apiModule = {
    async getMe() {
      calls.getMe += 1;
      if (state.profileThrows) throw new Error('network down');
      return state.profile;
    },
  };

  const stubRequire = (id) => {
    if (id === '@tarojs/taro') return taroModule;
    if (id.endsWith('/services/api') || id.endsWith('services/api')) return apiModule;
    if (id.endsWith('/types') || id.endsWith('types')) return {};
    throw new Error(`points-gate.ts 引入了未打桩的模块：${id}`);
  };

  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', transpile(source, fileName))(stubRequire, module_, module_.exports);
  return { mod: module_.exports, calls, state, Taro };
};

// ── ① 识别信号：三个都要认 ───────────────────────────────────────────────────
{
  const { mod } = createHarness({});
  const isPointsInsufficient = mod.isPointsInsufficient;

  // 信号 1：对话被服务端拒绝 —— 402（服务端只给文案、没有 code，状态码是唯一稳的机器信号）
  assert.equal(isPointsInsufficient({ statusCode: 402, message: '算力不足，请先充值' }), true,
    '402 必须判为算力不足 —— 服务端那处没有 error.code，只认 code 会整整漏掉一条链路');
  assert.equal(isPointsInsufficient({ statusCode: 402 }), true, '402 即使没有文案也要认');
  assert.equal(isPointsInsufficient({ statusCode: '402' }), true, '状态码可能是字符串（SSE 手写解析的产物）');

  // 信号 2：日后服务端补上错误码时的正式契约
  assert.equal(isPointsInsufficient({ code: 'POINTS_INSUFFICIENT' }), true);
  assert.equal(isPointsInsufficient({ code: 'POINTS_INSUFFICIENT', statusCode: 500 }), true,
    'code 命中就够 —— 日后服务端换了状态码也不该漏判');

  // 信号 3：只有文案的两种回来方式（SSE 流内报错、工作流 task.error）
  assert.equal(isPointsInsufficient('算力不足，本次结果未计入记录，请充值后再试'), true,
    'SSE 流内报错只有字符串，文案匹配是唯一出路');
  assert.equal(isPointsInsufficient({ message: '算力不足，本次运行未执行' }), true);
  assert.equal(isPointsInsufficient('算力不足'), true);

  // 反向：绝不能被非算力错误命中（否则任何一次上游抖动都会弹出「去充值」）
  assert.equal(isPointsInsufficient({ statusCode: 500, message: '上游超时' }), false);
  assert.equal(isPointsInsufficient({ code: 'VIP_REQUIRED', message: '需要升级套餐' }), false);
  assert.equal(isPointsInsufficient('本次运行失败，请调整参数后重试'), false);
  assert.equal(isPointsInsufficient({ statusCode: 403, message: 'PHONE_BIND_REQUIRED' }), false);
  assert.equal(isPointsInsufficient(undefined), false);
  assert.equal(isPointsInsufficient(null), false);
  assert.equal(isPointsInsufficient(''), false);
}

// ── 文案：知道余额就念出来，不知道就不编 ─────────────────────────────────────
{
  const { mod } = createHarness({});
  const text = mod.pointsInsufficientContent;

  // 主人 2026-09-17 定的文案，逐字钉住：改文案必须同步改这里（否则就是悄悄改了口径）
  const zero = text(0);
  assert.equal(zero, '当前算力余额 0 点，充值后可继续使用。');
  assert.ok(!zero.includes('「'), '正文不再点实体名称 —— 别把名称前缀又加回来');

  const unknown = text(undefined);
  assert.equal(unknown, '当前算力余额不足，充值后可继续使用。');
  assert.ok(!/\d/.test(unknown), `不知道余额时不得编一个数字出来（当前：${unknown}）`);

  // ⚠️ 脏输入必须走「不念数字」那一支：`Number(null)` / `Number('')` 都是 **0**，
  // 只用 Number.isFinite(Number(x)) 会把「未知」静默念成「余额 0 点」。
  for (const bad of [null, '', 'abc', '0', NaN, undefined, { points: 0 }]) {
    const out = text(bad);
    assert.ok(!/\d/.test(out), `非数字输入（${JSON.stringify(bad) ?? String(bad)}）不得被念成余额：${out}`);
    assert.ok(out.includes('余额不足'), '脏输入要退到「不念数字」那一支');
  }

  // 负数余额（越界充值后的脏数据）照实念 —— 不编数字，但也别瞒着用户
  assert.ok(text(-5).includes('-5'), `负数余额应照实念出：${text(-5)}`);

  // 两句「替代服务端原文」的说明：都不许再出现「请先充值」这种光说不做的口吻
  const chat = mod.pointsInsufficientHint('chat');
  const flow = mod.pointsInsufficientHint('workflow');
  assert.ok(chat.includes('重新生成'), '对话页的说明要点明「重新生成」这个具体出口，而不是泛泛说去充值');
  assert.ok(flow.includes('重新提交'), '工作流页的说明要点明回到本页重新提交');
  assert.notEqual(chat, flow, '两个场景的后续动作不同，文案不该共用一句');
}

// ── ④ 并发去重 + ⑤ 跳转退化 + 按钮语义 ───────────────────────────────────────
{
  const { mod, calls, state } = createHarness({});
  state.modalQueue = [];
  // 前两次并发调用应当收敛成**一个**弹窗
  const p1 = mod.promptRecharge(0);
  const p2 = mod.promptRecharge(0);
  assert.equal(calls.showModal.length, 1,
    '并发调用只允许弹一个窗 —— 发送按钮在预检期间不置 sending，连点两下会叠出两个弹窗甚至两次跳转');
  state.modalQueue.forEach((resolve) => resolve());
  state.modalQueue = null; // 手工模式用完必须复位，否则后续调用会一直等一个永不到来的 resolve
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1, true, '用户点了「去充值」要回报 true');
  assert.equal(r2, true, '被收敛的那一次要拿到**同一个结果**，不能返回 false（调用方会据此放行，等于白拦）');
  assert.equal(calls.navigateTo.length, 1, '两次并发也只该跳一次充值页');

  // 弹窗完成后再调 → 必须能正常弹第二次（模块级 promise 要清干净，不能一次之后永久静音）
  const r3 = await mod.promptRecharge();
  assert.equal(calls.showModal.length, 2, 'inFlightPrompt 必须在结束时清空，否则用户第二次永远看不到弹窗');
  assert.equal(r3, true);

  const withGap = calls.showModal[0];
  assert.equal(withGap.title, '算力不足');
  assert.equal(withGap.content, '当前算力余额 0 点，充值后可继续使用。',
    '弹窗正文必须与主人 2026-09-17 定的措辞逐字一致');
  assert.equal(withGap.confirmText, '去充值', '主按钮必须直说去处');
  assert.equal(withGap.cancelText, '再想想', '次按钮不能写成「取消」那种官腔');
  assert.equal(withGap.confirmColor, '#305CE0', '主色要与其他门禁弹窗一致（vip-gate 同色）');
  assert.equal(calls.navigateTo[0].url, '/pages/recharge/index', '必须落在充值页（非 tabBar 页，navigateTo 可达）');

  // 用户点了「再想想」→ 不跳转、且不留任何副作用
  const decline = createHarness({ modalConfirm: false });
  assert.equal(await decline.mod.promptRecharge(0), false);
  assert.equal(decline.calls.navigateTo.length, 0, '用户拒绝后不得跳转');

  // ⑤ 页面栈满 → navigateTo 失败，必须退化 redirectTo，而不是让「去充值」点了没反应
  const fallback = createHarness({});
  fallback.state.navigateThrows = true;
  assert.equal(await fallback.mod.promptRecharge(0), true);
  assert.equal(fallback.calls.navigateTo.length, 1);
  assert.equal(fallback.calls.redirectTo.length, 1, 'navigateTo 失败必须退一步 redirectTo（小程序页面栈上限 10 层）');
  assert.equal(fallback.calls.redirectTo[0].url, '/pages/recharge/index');

  // 两条路都失败也不能抛出去把调用方打断
  const dead = createHarness({});
  dead.state.navigateThrows = true;
  dead.state.redirectThrows = true;
  assert.equal(await dead.mod.promptRecharge(), true, '跳转彻底失败也不该把异常抛回调用页（那会在对话页炸出错误态）');
}

// ── ②③ ensureEnoughPoints：只在明确 <= 0 时拦，其余一律放行 ───────────────────
{
  // 有余额 → 放行，且不弹窗
  const rich = createHarness({ profile: { points: 120 } });
  assert.equal(await rich.mod.ensureEnoughPoints({ points: 120 }), true);
  assert.equal(rich.calls.showModal.length, 0, '有算力时不该弹任何窗');

  // 余额为 0（新用户常态）→ 拦下 + 弹窗
  const broke = createHarness({ profile: { points: 0 } });
  assert.equal(await broke.mod.ensureEnoughPoints({ points: 0 }), false);
  assert.equal(broke.calls.showModal.length, 1);
  assert.equal(broke.calls.showModal[0].content, '当前算力余额 0 点，充值后可继续使用。');
  assert.equal(broke.calls.getMe, 0, '调用方已经取过档案时不得再请求一次（三道门禁只该取一次）');

  // 负数余额（越界充值后的脏数据）也要拦
  const negative = createHarness({ profile: { points: -5 } });
  assert.equal(await negative.mod.ensureEnoughPoints({ points: -5 }), false);
  assert.ok(negative.calls.showModal[0].content.includes('-5'), '负数余额照实念，别抹平成 0');

  // 没有传档案 → 自己取一次
  const noCache = createHarness({ profile: { points: 0 } });
  assert.equal(await noCache.mod.ensureEnoughPoints(), false);
  assert.equal(noCache.calls.getMe, 1, '没传档案时应自己取一次');

  // ② 失败即放行：取档案抛错 / points 缺失（老服务端）/ 整体没档案
  const offline = createHarness({ profile: { points: 0 } });
  offline.state.profileThrows = true;
  assert.equal(await offline.mod.ensureEnoughPoints(), true,
    '取档案失败必须放行 —— 一次网络抖动不该把还能用的用户挡在门外');

  const legacy = createHarness({ profile: { points: undefined } });
  assert.equal(await legacy.mod.ensureEnoughPoints({ points: undefined }), true,
    '老服务端不下发 points 时必须放行（版本差不能误拦）');
  assert.equal(legacy.calls.showModal.length, 0);

  const noProfile = createHarness({ profile: null });
  assert.equal(await noProfile.mod.ensureEnoughPoints(), true, '拿不到档案（未登录）同样放行');

  // ③ 有余但可能不够本次消耗 —— 客户端不猜，由服务端那条路接住
  const thin = createHarness({ profile: { points: 1 } });
  assert.equal(await thin.mod.ensureEnoughPoints({ points: 1 }), true,
    '「不够本次消耗」只有服务端算得出（工作流成本随配置变化），客户端不得凭余额猜');
}

// ── handlePointsInsufficient：只对算力不足起作用，返回值必须准确 ──────────────
{
  const hit = createHarness({});
  assert.equal(await hit.mod.handlePointsInsufficient({ statusCode: 402, message: '算力不足，请先充值' }), true);
  assert.equal(hit.calls.showModal.length, 1);
  assert.equal(hit.calls.showModal[0].content, '当前算力余额不足，充值后可继续使用。',
    '402 这条路径手上没有余额 → 走「不念数字」的那句');

  // 手上确实知道余额时也支持传进来（页面在别处已经取过档案的场景）
  const withBalance = createHarness({});
  assert.equal(await withBalance.mod.handlePointsInsufficient({ statusCode: 402 }, 0), true);
  assert.equal(withBalance.calls.showModal[0].content, '当前算力余额 0 点，充值后可继续使用。');

  const miss = createHarness({});
  assert.equal(await miss.mod.handlePointsInsufficient(new Error('上游超时')), false,
    '非算力错误必须返回 false —— 调用方要靠它决定「照旧走红色横幅」');
  assert.equal(miss.calls.showModal.length, 0, '非算力错误绝不能弹充值窗（那是误导）');

  // 工作流那条：task.error 是纯字符串
  const taskFail = createHarness({});
  assert.equal(await taskFail.mod.handlePointsInsufficient('算力不足，本次运行未执行'), true);
}

// ── 空档案不得把整条门禁链打断 ───────────────────────────────────────────────
// getMe() 声明为 `Promise<UserProfile>`（非空），但运行时 `.data` 仍可能是 null（会话刚失效那一刻）。
// 这三道门禁是**串行**的：前一道抛异常，后一道根本没机会跑 —— 而对话页的 passGates 没有
// try/catch，用户看到的就是「点了发送、输入框空了、什么都没发生」。
// （本次改造还真踩到过：ensureEnoughPoints 少了 null 守卫，被这个脚本抓出来。）
{
  const vipHarness = (profile) => createHarness({ profile, source: vipGateSource, fileName: 'vip-gate.ts' });

  const nullProfile = createHarness({ profile: null });
  assert.equal(await nullProfile.mod.ensureEnoughPoints(), true,
    'getMe() 返回 null 必须放行 —— 绝不能走成 null.points');

  const vipNull = vipHarness(null);
  assert.equal(await vipNull.mod.ensureVipAccess({ vip: true, name: 'x' }), true,
    'vip 门禁遇到 null 档案也要放行，否则后面的算力门禁根本没机会跑');
  assert.equal(vipNull.calls.showModal.length, 0);

  // 顺带把 vip 门的既有语义钉住（这次为它加了第二参，别改坏）
  assert.equal(await vipHarness({ vipAccess: true }).mod.ensureVipAccess({ vip: true, name: 'x' }), true);
  assert.equal(await vipHarness({}).mod.ensureVipAccess({ vip: false, name: 'x' }), true,
    '非 VIP 专享内容不得被 VIP 门禁拦（门禁只对 item.vip === true 生效）');
  const vipBlocked = vipHarness({ vipAccess: false });
  assert.equal(await vipBlocked.mod.ensureVipAccess({ vip: true, name: 'x' }), false);
  assert.equal(vipBlocked.calls.showModal.length, 1);
  assert.equal(vipBlocked.calls.navigateTo[0].url, '/pages/recharge/index',
    'vip 与算力两道门禁的落地页必须是同一个充值页');

  // 传了缓存档案时不得再请求一次（三道门禁只取一次的意义所在）
  const cached = vipHarness({ vipAccess: false });
  assert.equal(await cached.mod.ensureVipAccess({ vip: true, name: 'x' }, { vipAccess: false }), false);
  assert.equal(cached.calls.getMe, 0, '调用方已取过档案时，VIP 门禁不得再 getMe 一次');
}

// ─────────────────────────────────────────────────────────────────────────────
// 第二部分：源码级接线（改错页面 / 漏挂一处，行为测试测不到）
// ─────────────────────────────────────────────────────────────────────────────

// 信号常量必须与**服务端真实文案**对得上 —— 服务端改了字，这里就得跟着改
assert.match(gateSource, /const INSUFFICIENT_POINTS_TEXT = '算力不足';/);
assert.ok(serverIndex.includes('算力不足，请先充值'),
  '服务端 /api/coze/chat 的 402 文案必须仍然含「算力不足」，否则客户端的文案匹配会静默失效');
assert.ok(serverIndex.includes('算力不足'),
  '服务端算力不足的出口文案改了就必须同步 points-gate.ts 的匹配串');
assert.match(serverIndex, /statusCode = 402|statusCode: 402|\b402\b/,
  '服务端算力不足必须仍以 402 返回（客户端的第一号机器信号）');
assert.ok(runtimeSource.includes('proxyRequest(deps.port, \'/api/coze/chat\''),
  'miniapp-runtime 必须原样透传上游状态码，否则 402 到不了客户端，预检之外的兜底就断了');

// 正文文案逐字钉住（主人 2026-09-17 定稿的措辞）：改文案必须同步改这里，否则就是悄悄改了口径
assert.match(gateSource, /return `当前算力余额 \$\{balance\} 点，充值后可继续使用。`;/,
  '知道余额时的正文模板');
assert.match(gateSource, /return '当前算力余额不足，充值后可继续使用。';/,
  '余额未知时的正文（不编数字）');
assert.match(gateSource, /typeof points === 'number' && Number\.isFinite\(points\)/,
  '余额必须先用 typeof 卡一道：Number(null) / Number(\'\') 都是 0，只写 Number.isFinite(Number(x)) 会把「未知」念成「余额 0 点」');

// 公开形状：正文不再点实体名称 → 这三个函数都不该再收 name / item（死参数会误导后人）
assert.match(gateSource, /export async function promptRecharge\(points\?: number\): Promise<boolean> \{/);
assert.match(gateSource, /export async function ensureEnoughPoints\(profile\?: UserProfile \| null\): Promise<boolean> \{/,
  'ensureEnoughPoints 只收档案（与 ensurePhoneBound 对齐）—— 正文不用实体名了，别留没人读的 item 入参');
assert.match(gateSource, /export async function handlePointsInsufficient\(reason: unknown, points\?: number\): Promise<boolean> \{/);
for (const [label, source] of [['对话', chatSource], ['工作流', workflowSource]]) {
  assert.match(source, /await ensureEnoughPoints\(me\)/,
    `${label}页：ensureEnoughPoints 现在只收档案`);
  assert.doesNotMatch(source, /ensureEnoughPoints\((?:agent|workflow),/,
    `${label}页：正文不再点实体名，不要再往 ensureEnoughPoints 传实体名`);
}

// 跳转目标：与 vip-gate 的升级落地页必须是同一个（都指充值页）
assert.match(gateSource, /const RECHARGE_PAGE = '\/pages\/recharge\/index';/);
assert.match(vipGateSource, /const RECHARGE_PAGE = '\/pages\/recharge\/index';/,
  '两道门禁的落地页必须一致 —— 一处改了另一处必成漏网');
const appConfig = read('miniapp/src/app.config.ts');
assert.ok(appConfig.includes('pages/recharge/index'),
  '充值页必须在 app.config.ts 里注册，否则 navigateTo 必失败、弹窗点了等于没点');

// ⑥⑦ 对话页：三道门禁同序 + 门禁跑在 runTurn 之前 + 算力不足不得进错误态
const chatGateAt = chatSource.indexOf('const passGates = async () => {');
assert.ok(chatGateAt > 0, '对话页必须有统一的 passGates（避免三道门禁被复制到 send / regenerate 两处各写一遍）');
const chatGateBody = chatSource.slice(chatGateAt, chatSource.indexOf('\n  };', chatGateAt));
const orderChat = ['ensurePhoneBound(me)', 'ensureVipAccess(agent, me)', 'ensureEnoughPoints(me)']
  .map((needle) => chatGateBody.indexOf(needle));
assert.ok(orderChat.every((at) => at > 0), `对话页三道门禁必须都在 passGates 里（${orderChat.join(',')}）`);
assert.ok(orderChat[0] < orderChat[1] && orderChat[1] < orderChat[2],
  '对话页顺序必须是 手机号 → 套餐 → 算力（与服务端 miniapp-runtime 同序；算力刻意排在套餐之后）');
assert.match(chatGateBody, /const me = await getMe\(\)/,
  '对话页三道门禁必须只取一次档案（逐道各取一次 = 白跑两个来回）');
assert.match(chatGateBody, /if \(!me\) return true;/,
  '取不到档案必须整体放行 —— 与三道门禁各自「拿不到就放行」的姿态一致');

// ⚠️ 这两个文件是 CRLF（同一个仓库里 api.ts 是 LF、页面是 CRLF），多行正则一律用 \r?\n，
// 否则在只有 \n 的断言上会得到一个「源码明明改了却说没改」的假 FAIL。
assert.match(chatSource, /if \(!\(await passGates\(\)\)\) return;\r?\n\s+await runTurn\(userMessage, messages\);/,
  'send 必须先过门禁再 runTurn —— runTurn 一进去就 setInput(\'\') 清空输入框，拦不住就是「点了发送、输入框空了、什么都没发生」');
assert.match(chatSource, /if \(!\(await passGates\(\)\)\) return;\r?\n\s+await runTurn\(userMessage, messages\.slice/,
  '「重新生成」是充值回来后最自然的重试入口，同样必须先过门禁');

const chatCatchAt = chatSource.indexOf('if (await handlePointsInsufficient(reason)) {');
assert.ok(chatCatchAt > 0, '对话页 catch 必须单独接住算力不足');
const chatCatchBody = chatSource.slice(chatCatchAt, chatSource.indexOf('const message = reason instanceof Error', chatCatchAt));
assert.match(chatCatchBody, /setError\(''\)/,
  '算力不足必须保持 error 为空 —— 否则红色横幅与 PageState 会一起翻脸，用户看到「弹窗 + 满屏红字」反而更慌');
assert.match(chatCatchBody, /pointsInsufficientHint\('chat'\)/,
  '气泡必须换成不照抄服务端原文的说明文案（原文本就是要替换掉的「纯文字提示」）');
assert.ok(!chatCatchBody.includes('`调用失败：'),
  '算力不足分支不得再拼「调用失败：…」——那正是改造前的死文字');

// 工作流页：同一套顺序 + 后台任务失败要接住
const wfGateAt = workflowSource.indexOf('const me = await getMe().catch(() => null);');
assert.ok(wfGateAt > 0, '工作流页提交前必须取一次档案');
const wfGateBody = workflowSource.slice(wfGateAt, workflowSource.indexOf('if (fields.some(', wfGateAt));
const orderWf = ['ensurePhoneBound(me)', 'ensureVipAccess(workflow, me)', 'ensureEnoughPoints(me)']
  .map((needle) => wfGateBody.indexOf(needle));
assert.ok(orderWf.every((at) => at > 0), `工作流页三道门禁必须都在（${orderWf.join(',')}）`);
assert.ok(orderWf[0] < orderWf[1] && orderWf[1] < orderWf[2],
  '工作流页顺序必须是 手机号 → 套餐 → 算力（与服务端同序）');
// 门禁要排在表单校验之前（同一处 submit 里比较，避免 indexOf 撞到别处的同名调用）
{
  const gateAt = workflowSource.indexOf('ensureEnoughPoints(me)', wfGateAt);
  const formAt = workflowSource.indexOf('if (fields.some(', wfGateAt);
  assert.ok(gateAt > 0 && formAt > 0 && gateAt < formAt,
    '门禁必须排在表单校验之前 —— 反正要先去处理完才能提交，不该让用户先把参数填一遍');
}

const wfPromptAt = workflowSource.indexOf('const promptIfPointsFailed = (current: RuntimeTask) => {');
assert.ok(wfPromptAt > 0, '工作流后台任务的算力不足必须接住（提交时 402 只挡得住余额为 0）');
const wfPromptBody = workflowSource.slice(wfPromptAt, workflowSource.indexOf('\n  };', wfPromptAt));
assert.match(wfPromptBody, /current\.status !== 'failed' \|\| !isPointsInsufficient\(current\.error\)/);
assert.match(wfPromptBody, /pointsPromptedRef\.current\.has\(id\)/,
  '必须按 task.id 去重 —— 任务状态会被轮询与切页恢复各读一次，不去重就反复弹同一个窗');
assert.ok(wfPromptBody.indexOf('pointsPromptedRef.current.add(id)') < wfPromptBody.indexOf('handlePointsInsufficient('),
  '必须**先登记再 await** —— 先 await 的话并发进来还是会叠出两个弹窗');
assert.ok(!/await handlePointsInsufficient/.test(wfPromptBody),
  '登记与弹窗之间不要 await（那会让去重失去意义）');
assert.match(workflowSource, /Taro\.removeStorageSync\(`\$\{ACTIVE_TASK_PREFIX\}\$\{workflowId\}`\);\r?\n\s+promptIfPointsFailed\(current\);/,
  'promptIfPointsFailed 必须挂在「任务已结束」那条分支上（刷新与切页恢复都要经过它）');

// 失败卡片的文案：算力不足换人话，其它失败原因照旧原样展示（便于客服定位）
assert.match(workflowSource, /isPointsInsufficient\(task\.error\) \? pointsInsufficientHint\('workflow'\) : \(task\.error \|\| '本次运行失败，请调整参数后重试'\)/,
  '工作流失败卡片要区分「算力不足」与「真失败」：前者换人话，后者仍要留原文');

// 客户端不得自己写一份算力判定口径（唯一实现在 points-gate.ts）
// ⚠️ 只扫**代码**，注释不算 —— 各调用页都留了「算力不足为什么走弹窗」的说明，
// 那条断言要是连注释一起算，等于逼后人删掉解释性注释。
const stripComments = (source) => source.replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
const miniappSrcFiles = [];
const collectSrc = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSrc(full);
    else if (/\.tsx?$/.test(entry.name)) miniappSrcFiles.push(full);
  }
};
collectSrc(path.join(repoRoot, 'miniapp/src'));
const offenders = miniappSrcFiles.filter((file) => {
  if (path.basename(file) === 'points-gate.ts') return false;
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  return code.includes('算力不足') || code.includes('POINTS_INSUFFICIENT');
});
assert.equal(offenders.length, 0,
  `「算力不足」的文案与判定口径只允许出现在 utils/points-gate.ts 的代码里（命中的文件：${offenders.map((f) => path.relative(repoRoot, f)).join(', ')}）`);

console.log('miniapp points gate check passed: 算力不足一律弹窗引导充值（402 / 错误码 / 文案三信号；并发去重 + 跳转退化 + 三道门禁同序）');
