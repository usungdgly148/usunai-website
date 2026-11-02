#!/usr/bin/env node
// 网页端算力充值（微信扫码支付）契约守卫。
//
// 守的是「主人 2026-11-02 定的产品口径」：网页端充值必须是在线自助扫码支付，
// 不允许回退成「联系客服手动充值」。同时守住几处**改了就出事且不易察觉**的接缝：
//   · 发货必须复用 miniapp-api 的 deliverRechargeOrder（两套加算力实现 = 有效期/试用规则必然漂移）
//   · /api/recharge/notify 必须排在登录校验之前（微信服务器没有我们的会话）
//   · 微信 description 必须剥 emoji（否则下单直接 INVALID_REQUEST）
//   · 支付通知地址必须与小程序的虚拟支付推送地址分开
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const webRecharge = read('server/web-recharge.mjs');
const wechatPay = read('server/wechat-pay.mjs');
const miniappApi = read('server/miniapp-api.mjs');
const indexJs = read('server/index.mjs');
const components = read('frontend/src/components.jsx');
const appJsx = read('frontend/src/App.jsx');

// ---- 1. 服务端模块 ----
check('web-recharge 导出路由入口', /export async function handleWebRecharge\(/.test(webRecharge));
check('web-recharge 导出定时对账', /export async function reconcilePendingNativeOrders\(/.test(webRecharge));
check(
  '通知地址与小程序虚拟支付推送地址分离',
  /WEB_RECHARGE_NOTIFY_URL/.test(webRecharge) && webRecharge.includes('/api/recharge/notify'),
  '通知必须走 /api/recharge/notify，不能复用 /api/miniapp/v1/recharge/virtual-notify',
);
check('三条路由齐备', ['/api/recharge/order', '/api/recharge/status', '/api/recharge/notify'].every((p) => webRecharge.includes(p)));
check(
  'notify 分支排在登录校验之前',
  webRecharge.indexOf("path === '/api/recharge/notify'") < webRecharge.indexOf("path === '/api/recharge/order'"),
);
check('下单走 Native（扫码）支付', /createNativeOrder\(/.test(webRecharge));
check('货币单位为分', /Math\.round\(price \* 100\)/.test(webRecharge));

// ---- 2. 发货实现唯一 ----
check('发货复用 deliverRechargeOrder', /deliverRechargeOrder/.test(webRecharge));
check('miniapp-api 已导出 deliverRechargeOrder', /export async function deliverRechargeOrder\(/.test(miniappApi));
check(
  'web-recharge 不自行加算力（无 kvAdminAdjustPoints）',
  !/kvAdminAdjustPoints/.test(webRecharge),
  '出现即代表写了第二套发货实现',
);
check(
  '试用限购闸门在服务端',
  /TRIAL_ALREADY_PURCHASED_CODE/.test(webRecharge) && /hasUsedTrial\(/.test(webRecharge),
);
check('手机号门禁在服务端', /PHONE_BIND_REQUIRED_CODE/.test(webRecharge) && /hasPhoneBound\(/.test(webRecharge));
check('订单归属校验（只能查自己的单）', /FORBIDDEN/.test(webRecharge));

// ---- 3. 微信支付模块 ----
check('wechat-pay 有 Native 下单', /export async function createNativeOrder\(/.test(wechatPay));
check('wechat-pay 有关单能力', /export async function closeOrderByOutTradeNo\(/.test(wechatPay));
check('wechat-pay 导出描述清洗', /export function plainDescription\(/.test(wechatPay));

// ---- 4. index.mjs 挂载 ----
check('index.mjs 引入网页充值模块', /from '\.\/web-recharge\.mjs'/.test(indexJs));
check('index.mjs 挂载 handleWebRecharge', /await handleWebRecharge\(req, res, u,/.test(indexJs));
check('对账定时器已接入 Native 订单', /reconcilePendingNativeOrders\(KV, sanitizeIdForKV\)/.test(indexJs));

// ---- 5. 前端弹窗 ----
const start = components.indexOf('export function RechargeDialog(');
const end = components.indexOf('\nexport function ', start + 10);
const dialog = start >= 0 ? components.slice(start, end > 0 ? end : undefined) : '';
check('RechargeDialog 存在', start >= 0);
check('弹窗调用下单接口', dialog.includes('/api/recharge/order'));
check('弹窗轮询支付状态', dialog.includes('/api/recharge/status'));
check('code_url 由前端渲染二维码', /QRCode\.toDataURL\(/.test(dialog));
check('三态齐全', ['paying', 'success', 'error'].every((s) => dialog.includes(`'${s}'`)));
check('有超时/失败重试入口', /重新获取二维码/.test(dialog) && /我已支付/.test(dialog));
check('套餐过滤口径保留（published !== false）', /published !== false/.test(dialog));
check('按 sortOrder 排序', /sortOrder/.test(dialog));
check('不再传客服二维码给弹窗', !/<RechargeDialog[^>]*\bqr=/.test(appJsx));

// 文案合规：弹窗内不允许出现人工充值表述
const BANNED = ['联系客服', '人工充值', '扫码添加客服', '客服二维码', '人工办理'];
const hitBanned = BANNED.filter((w) => dialog.includes(w));
check('弹窗内无「联系客服/人工充值」类文案', hitBanned.length === 0, hitBanned.join('、'));
check('弹窗内有扫码支付引导', /扫一扫/.test(dialog) && /自动到账/.test(dialog));

// ---- 6. 行为校验：description 必须剥掉 emoji（微信硬限制）----
let plainDescription = null;
try {
  ({ plainDescription } = await import(pathToFileURL(path.join(ROOT, 'server/wechat-pay.mjs')).href));
} catch (error) {
  check('可加载 wechat-pay.mjs', false, String(error && error.message));
}
if (plainDescription) {
  const samples = [
    ['🥈 银卡 · 算力充值', '银卡 · 算力充值'],
    ['👑 至尊卡 · 算力充值', '至尊卡 · 算力充值'],
    ['🎟️ 体验卡 · 算力充值', '体验卡 · 算力充值'],
  ];
  let ok = true;
  const detail = [];
  for (const [input, expected] of samples) {
    const got = plainDescription(input);
    if (got !== expected) { ok = false; detail.push(`${input} → ${got}`); }
  }
  check('description 剥离 emoji 后保持可读', ok, detail.join(' / '));
  check('description 全为图形字符时有中文兜底', plainDescription('⭐⭐') === '算力充值', plainDescription('⭐⭐'));
  check('description 长度不超过 127', plainDescription('长'.repeat(300)).length === 127);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok || !r.detail ? '' : `  ← ${r.detail}`}`);
console.log(`\n===== ${results.length - failed.length} 通过 / ${failed.length} 失败 =====`);
process.exit(failed.length === 0 ? 0 : 1);
