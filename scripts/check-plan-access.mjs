import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TRIAL_ALREADY_PURCHASED_CODE,
  TRIAL_ALREADY_PURCHASED_MESSAGE,
  VIP_REQUIRED_CODE,
  buildPlanPatch,
  hasUsedTrial,
  hasVipAccess,
  isTrialPackage,
  vipRequiredMessage,
} from '../server/plan-access.mjs';

// ============ 1. 试用套餐识别：开关优先 + 名称兜底 ============
// 线上套餐就叫「免费试用」，没有任何标记字段，名称兜底必须生效。
assert.equal(isTrialPackage({ name: '免费试用' }), true, '名称含「试用」应判定为试用套餐');
assert.equal(isTrialPackage({ name: '免费试用', trial: false }), true, '开关为 false 时仍按名称兜底（存量数据无开关）');
assert.equal(isTrialPackage({ name: '体验包', trial: true }), true, '后台开关应生效');
assert.equal(isTrialPackage({ name: '🥇 金卡' }), false, '普通套餐不能误判');
assert.equal(isTrialPackage({ name: '👑 至尊卡' }), false, '普通套餐不能误判');
assert.equal(isTrialPackage(null), false, '空值不能抛错');
assert.equal(isTrialPackage({ name: '' }), false, '无名套餐不能误判');

// ============ 2. 试用资格「每用户一次」的判定 ============
assert.equal(hasUsedTrial({ trialPurchased: true }), true, 'trialPurchased 置位即已用过');
assert.equal(hasUsedTrial({ membership: { plan: '免费试用' } }), true, '老数据：生效套餐就是试用套餐 → 已用过');
assert.equal(hasUsedTrial({ membership: { plan: '金卡', trial: true } }), true, 'membership.trial 标记同样算已用过');
assert.equal(hasUsedTrial({ membership: { plan: '🥇 金卡' } }), false, '买过正式套餐不算用过试用');
assert.equal(hasUsedTrial({}), false, '新用户未用过');
assert.equal(hasUsedTrial(null), false, '空值不能抛错');

// ============ 3. VIP 专享门禁口径（与主人确认：试用中 / 已过期 / 无套餐一律无资格）============
const active = { expired: false, validTo: null };
const expired = { expired: true, validTo: '2026-01-01T00:00:00.000Z' };
assert.equal(hasVipAccess({ membership: { plan: '🥇 金卡' } }, active), true, '生效中的金卡应放行');
assert.equal(hasVipAccess({ membership: { plan: '👑 至尊卡' } }, active), true, '生效中的至尊卡应放行');
assert.equal(hasVipAccess({ membership: { plan: '免费试用', expireAt: '2026-09-19' } }, active), false, '试用中应拦截');
assert.equal(hasVipAccess({ membership: { plan: '免费试用' } }, expired), false, '已过期的试用应拦截');
assert.equal(hasVipAccess({ membership: { plan: '🥇 金卡' } }, expired), false, '已过期的金卡应拦截');
assert.equal(hasVipAccess({}, active), false, '从未买过套餐应拦截');
assert.equal(hasVipAccess(null, active), false, '空值不能抛错');
assert.equal(
  hasVipAccess({ membership: { plan: '双十一特惠', trial: true } }, active),
  false,
  'membership.trial 标记优先于套餐名（改名后仍能拦住试用）',
);

// ============ 4. 有效期补丁：不叠加时长、永久优先、试用标记同步置位 ============
const trialPatch = buildPlanPatch(null, {
  packageName: '免费试用',
  validDays: 7,
  fallbackStart: '2026-09-12',
});
assert.equal(trialPatch.trial, true);
assert.deepEqual(trialPatch.patch.membership, { plan: '免费试用', expireAt: '2026-09-19', trial: true });
assert.equal(trialPatch.patch.trialPurchased, true, '买过试用必须置位 trialPurchased');
assert.equal(trialPatch.winner, 'incoming');

// 已有 365 天金卡的用户再买 7 天试用：有效期不叠加（金卡胜出），但试用资格照样记上。
const trialOnTopOfGold = buildPlanPatch(
  { planValidFrom: '2026-09-12', planValidDays: 365 },
  { packageName: '免费试用', validDays: 7, fallbackStart: '2026-09-12' },
);
assert.equal(trialOnTopOfGold.winner, 'existing', '更晚到期的金卡应胜出');
assert.equal(trialOnTopOfGold.patch.membership, undefined, '胜出者是既有套餐时不覆盖 membership');
assert.equal(trialOnTopOfGold.patch.trialPurchased, true, '被更高档套餐压过也算用过试用');

const permanentPatch = buildPlanPatch(null, {
  packageName: '👑 至尊卡',
  validDays: 0,
  fallbackStart: '2026-09-12',
});
assert.deepEqual(permanentPatch.patch.membership, { plan: '👑 至尊卡', expireAt: '长期有效', trial: false });

const goldPatch = buildPlanPatch(null, {
  packageName: '🥇 金卡',
  validDays: 365,
  fallbackStart: '2026-09-12',
});
assert.equal(goldPatch.patch.trialPurchased, undefined, '非试用套餐不得置位 trialPurchased');
assert.equal(goldPatch.patch.membership.trial, false);

// 无有效期的套餐（validDays <= 0 且不为 0 的永久档）：只置试用标记，不动有效期字段。
const noValidity = buildPlanPatch(null, { packageName: '免费试用', validDays: undefined, fallbackStart: '2026-09-12' });
assert.deepEqual(noValidity.patch, { trialPurchased: true });
assert.equal(noValidity.winner, 'preserve');

// ============ 5. 三个入口的接线契约（防回归：判定只能有一处实现）============
const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const miniappApi = read('server/miniapp-api.mjs');
assert.match(miniappApi, /TRIAL_ALREADY_PURCHASED_CODE/, '下单接口必须回试用限购错误码');
assert.match(miniappApi, /if \(isTrialPackage\(pkg\)\) \{/, '下单前必须按套餐判定试用限购');
assert.match(miniappApi, /hasUsedTrial\(existingUser\)/, '限购判定必须走 hasUsedTrial');
assert.match(miniappApi, /trial: isTrialPackage\(pkg\)/, '下单时要把「是否试用套餐」固化进订单 meta');
assert.match(miniappApi, /vipAccess: hasVipAccess\(merged, validity\)/, '/me 必须下发 vipAccess 供前端预判');
assert.match(miniappApi, /trialPurchased: hasUsedTrial\(merged\)/, '/me 必须下发 trialPurchased');
// 三处发货/调整路径都不许再各自复制有效期逻辑。
assert.doesNotMatch(miniappApi, /resolved\.winner === 'incoming' && resolved\.planValidFrom/, '有效期补丁必须收口到 buildPlanPatch');
assert.doesNotMatch(miniappApi, /resolveMaxPlanValidity\(existingUser,/, '有效期补丁必须收口到 buildPlanPatch');

const runtime = read('server/miniapp-runtime.mjs');
assert.match(runtime, /VIP_REQUIRED_CODE, vipRequiredMessage/, '运行接口必须回 VIP 专享错误码与统一文案');
assert.equal((runtime.match(/agent\.vip === true && !\(await hasVipContentAccess/g) || []).length, 1, 'chat 入口必须有 VIP 门禁');
assert.equal((runtime.match(/workflow\.vip === true && !\(await hasVipContentAccess/g) || []).length, 1, '工作流入口必须有 VIP 门禁');

const serverIndex = read('server/index.mjs');
assert.equal((serverIndex.match(/cfg\.vip === true && !\(await hasVipContentAccess/g) || []).length, 1, '网页 /api/coze/chat 必须有 VIP 门禁');
assert.equal((serverIndex.match(/runtime\.vip === true && !\(await hasVipContentAccess/g) || []).length, 1, '网页 /api/coze/workflow-run 必须有 VIP 门禁');
assert.match(serverIndex, /if \(packageTrial\) userPatch\.trialPurchased = true;/, '后台手动发放试用也要算用过');

const kvLocal = read('server/kv-local.js');
assert.match(kvLocal, /if \(userPatch\.trialPurchased === true\) allowedPatch\.trialPurchased = true;/, 'trialPurchased 必须进 userPatch 白名单');

// ============ 6. 提示文案：不许写死套餐名 ============
// 门禁同时拦「试用中 / 已过期 / 无套餐」三类用户，后两类手上并没有试用套餐，
// 文案里若写「当前『免费试用』套餐无法使用」会让他们以为系统认错人了。
const vipMsg = vipRequiredMessage('AI 短视频脚本');
assert.equal(vipMsg, '「AI 短视频脚本」为 VIP 专享，需升级为更高权益套餐后使用。', 'VIP 提示文案要带内容名并给出升级指引');
assert.doesNotMatch(vipMsg, /免费试用/, '服务端 VIP 文案不得写死套餐名');
assert.doesNotMatch(read('miniapp/src/utils/vip-gate.ts'), /免费试用/, '小程序升级弹窗文案同样不得写死套餐名（须与服务端同一口径）');
assert.equal(vipRequiredMessage(''), '该内容为 VIP 专享，需升级为更高权益套餐后使用。', '缺内容名时要有兜底措辞');

// 试用限购文案：充值页有两条路径弹这个窗（本地预拦 / 服务端 409 兜底），
// 必须共用同一个常量、且与服务端逐字一致 —— 否则用户会被同一件事用两套说法告知。
const rechargePage = read('miniapp/src/pages/recharge/index.tsx');
const miniappTrialMsg = (rechargePage.match(/const TRIAL_ALREADY_PURCHASED_MESSAGE = '([^']*)';/) || [])[1];
assert.ok(miniappTrialMsg, '充值页必须定义 TRIAL_ALREADY_PURCHASED_MESSAGE 常量');
assert.equal(miniappTrialMsg, TRIAL_ALREADY_PURCHASED_MESSAGE, '小程序与服务端的试用限购文案必须逐字一致');
assert.doesNotMatch(rechargePage, /只能购买一次/, '两条路径都要引常量，不许再就地写死措辞');

console.log('Plan access check passed: trial purchase limited to once per user, VIP-only content gated on all four entry points.');
console.log(`codes: ${TRIAL_ALREADY_PURCHASED_CODE} / ${VIP_REQUIRED_CODE}`);
console.log(`message: ${vipRequiredMessage('AI 短视频脚本')}`);
