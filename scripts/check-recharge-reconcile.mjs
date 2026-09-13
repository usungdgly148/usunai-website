// 未支付订单自动关单的自测。
//
// 背景：用户点了「立即支付」但没走完会留下永远 pending 的订单，微信侧压根没建单，
// query_order 明确回「数据不存在」。老行为只打日志 → 对账循环每 180s 无限重试。
// 本脚本锁住两件事：① 什么样的错误才算「明确不存在」；② 什么条件下才允许关单。
//
// 纯函数直接 import（server/miniapp-api.mjs 及其依赖都只依赖 node 内置模块，本机可跑），
// 所以这里是**真正的单元测试**，不是正则断言。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECONCILE_CLOSE_MIN_AGE_MS,
  RECONCILE_CLOSE_MISSES,
  isVirtualOrderNotFoundError,
  shouldCloseUnpaidOrder,
} from '../server/miniapp-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 8, 13, 4, 0, 0);
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// ============ 1. 「微信明确说不存在」的判定 ============
// 命中：唯一的权威信号。
assert.equal(isVirtualOrderNotFoundError({ errcode: 268490002, message: '数据不存在' }), true, 'errcode+errmsg 命中');
assert.equal(isVirtualOrderNotFoundError({ errcode: 268490002 }), true, '只给 errcode 也要命中');
assert.equal(isVirtualOrderNotFoundError({ message: '数据不存在' }), true, '只给 errmsg 也要命中');

// 不命中：这些是「没问到」，不是「不存在」—— 拿它们关单会误伤正在支付的订单。
assert.equal(isVirtualOrderNotFoundError(null), false, '空错误不算');
assert.equal(isVirtualOrderNotFoundError({ code: 'VIRTUAL_PAY_API_ERROR', errcode: 40001, message: 'access_token 过期' }), false, 'token 过期不算');
assert.equal(isVirtualOrderNotFoundError({ code: 'VIRTUAL_PAY_API_ERROR', errcode: 42001, message: 'token expired' }), false, 'token 非法不算');
assert.equal(isVirtualOrderNotFoundError({ message: 'fetch failed' }), false, '网络错误不算');
assert.equal(isVirtualOrderNotFoundError({ message: '未支付' }), false, '支付状态类文案不算');
// ⚠️ 关键回归：session_key 那条的 errmsg 里也有「不存在」二字，但**不是**订单不存在。
// 哪天有人把提示词从「数据不存在」放宽成「不存在」，这条会立刻红。
assert.equal(
  isVirtualOrderNotFoundError({ errcode: 268490009, message: '用户session_key不存在或已过期,请重新登录' }),
  false,
  'session_key 不存在 ≠ 订单不存在（提示词不得放宽成「不存在」）',
);
assert.equal(isVirtualOrderNotFoundError({ errcode: 268490011, message: '数据生成中,请稍后调用本接口获取' }), false, '数据生成中不算');
assert.equal(isVirtualOrderNotFoundError({ errcode: 268490015, message: '频率限制' }), false, '限流不算');

// ============ 2. 关单门槛：miss 次数 + 宽限期，双条件 ============
const GRACE = RECONCILE_CLOSE_MIN_AGE_MS;
const MISSES = RECONCILE_CLOSE_MISSES;

// 把主人定的口径钉住：改阈值必须是有意为之，不能被顺手改掉。
assert.equal(GRACE, 15 * 60 * 1000, '宽限期应为 15 分钟（主人定的：超时未支付自动取消）');
assert.equal(MISSES, 3, 'miss 门槛应为 3 轮（防微信接口单次抖动）');

const pending = (ago, misses) => ({ id: 'p1', status: 'pending', createdAt: iso(ago), meta: { reconcileMisses: misses } });

assert.equal(shouldCloseUnpaidOrder(pending(5 * MIN, 99), NOW), false, '刚下单 5 分钟，miss 再多也不关（宽限期）');
assert.equal(shouldCloseUnpaidOrder(pending(GRACE - MIN, 99), NOW), false, '还差 1 分钟到宽限期 → 不关');
assert.equal(shouldCloseUnpaidOrder(pending(GRACE, MISSES), NOW), true, '刚满宽限期 + miss 达标 → 关');
assert.equal(shouldCloseUnpaidOrder(pending(GRACE * 2, MISSES), NOW), true, '远超宽限期 + miss 达标 → 关');
assert.equal(shouldCloseUnpaidOrder(pending(GRACE * 2, MISSES - 1), NOW), false, '超宽限期但 miss 差 1 次 → 再等等');
assert.equal(shouldCloseUnpaidOrder(pending(GRACE * 2, 0), NOW), false, '没有 miss 记录 → 不关');
assert.equal(shouldCloseUnpaidOrder({ ...pending(GRACE * 2, 9), status: 'paid' }, NOW), false, '已支付绝不关');
assert.equal(shouldCloseUnpaidOrder({ ...pending(GRACE * 2, 9), status: 'closed' }, NOW), false, '已关闭不重复处理');
assert.equal(shouldCloseUnpaidOrder({ ...pending(GRACE * 2, 9), createdAt: '坏时间' }, NOW), false, '时间解析不出来 → 保守不关');
assert.equal(shouldCloseUnpaidOrder({ ...pending(GRACE * 2, 9), createdAt: undefined }, NOW), false, '没有 createdAt → 保守不关');
assert.equal(shouldCloseUnpaidOrder({ id: 'p1', status: 'pending', createdAt: iso(GRACE * 2) }, NOW), false, '没有 meta → 不关');
assert.equal(shouldCloseUnpaidOrder(null, NOW), false, '空订单不算');

// ============ 3. 接线契约 ============
const api = read('server/miniapp-api.mjs');
assert.match(api, /if \(isVirtualOrderNotFoundError\(error\)\) \{\s*return countUnpaidMiss\(/, '查单报「不存在」时必须走计数/关单');
assert.match(api, /next\.status = 'closed'/, '达到门槛要把订单置为 closed');
assert.match(api, /closedReason = 'unpaid_timeout'/, '要记录关单原因，便于后台区分「系统关的」和「人工关的」');
assert.match(api, /closedBy = 'system'/, '要标记关单来源为系统');
assert.match(api, /const latest = \(await KV\.kvGet\(key\)\) \|\| order;/, '累加要基于 KV 最新记录（前端轮询与定时对账会并发）');
// 关掉的单不能再被扫到 —— 扫描条件必须只挑 pending。
assert.match(api, /if \(!order \|\| String\(order\.status\) !== 'pending'\) continue;/, '对账只扫 pending，closed 天然退出重试');

// 复用系统**已有**的 closed 状态 → 前端无需改动，这里把契约钉死。
for (const page of ['frontend/src/pages/Orders.jsx', 'frontend/src/pages/AdminOrders.jsx']) {
  assert.match(read(page), /closed: '已关闭'/, `${page} 必须已支持 closed 状态（否则关单会显示空白）`);
}

console.log(
  `Recharge reconcile check passed: 未支付死单满 ${GRACE / 60000} 分钟且 ${MISSES} 轮查不到后自动关闭，且只认「微信明确说订单不存在」。`,
);
