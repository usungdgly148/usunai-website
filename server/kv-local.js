// 本地 SQLite 版 KV —— 替代文件版 kv-local.js（usun_kv）
// 接口与 node-functions/api/_kv.js 完全一致（kvGet/kvPut/kvDelete/kvList/kvAvailable），
// 这样前端 store.jsx 调用的 /api/data/* 与 /api/single-key/* 路由无需任何改动。
//
// 实现：SQLite 单文件数据库（USUN_DATA_DIR/usun.db），kv(key, value) 表，value 存 JSON 文本。
// - WAL 模式：读不阻塞写，并发友好（100 并发打字机 / 工作流场景绰绰有余）。
// - 原子写入：每条 kvPut 是单语句 INSERT OR REPLACE（事务保证），比文件 rename 更稳，
//   彻底杜绝旧文件 KV 的「部分写损坏」与「多写互相覆盖」问题（曾导致 7-30 uses/资产丢写）。
// - 自动迁移：首次启动若 db 为空且旧 data/kv/*.json 存在，单事务全量导入；旧 json 保留作备份，不删除。
// - JSON1 扩展：提供 kvAdjustJSON 原子增减（供算力/余额等并发敏感字段，本次未接调用方，预留）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.USUN_DATA_DIR
  ? path.resolve(process.env.USUN_DATA_DIR)
  : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'usun.db');
const LEGACY_KV_DIR = path.join(DATA_DIR, 'kv');

// EdgeOne KV key 仅允许 [a-zA-Z0-9_]，这里同样 sanitize 以防异常跨目录
const safeKey = (k) =>
  String(k == null ? '' : k).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 200);

// LIKE 通配符转义：prefix 里的 _ / % 当作字面量（否则 'user_' 的 _ 会匹配任意字符）
const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

function initDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // 读不阻塞写，并发友好
  db.pragma('synchronous = NORMAL'); // WAL + NORMAL：崩溃安全且写入更快
  // 关键修复（2026-07-30）：better-sqlite3 默认不设 busy_timeout，并发写会立刻抛 SQLITE_BUSY
  // → 被顶层 catch 变成 500（编辑页保存同时发两个写请求就会触发）。设 5s 让写排队而非失败。
  db.pragma('busy_timeout = 5000');
  db.exec(
    'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  );

  // 首次迁移：db 刚建（无数据）且旧文件 KV 目录存在 → 单事务导入，要么全成要么全败
  const count = db.prepare('SELECT COUNT(*) AS c FROM kv').get().c;
  if (count === 0 && fs.existsSync(LEGACY_KV_DIR)) {
    const files = fs
      .readdirSync(LEGACY_KV_DIR)
      .filter((f) => f.endsWith('.json'));
    const insert = db.prepare(
      'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)'
    );
    const tx = db.transaction(() => {
      for (const f of files) {
        const k = f.slice(0, -5); // 去掉 .json
        try {
          const raw = fs.readFileSync(path.join(LEGACY_KV_DIR, f), 'utf8');
          JSON.parse(raw); // 校验合法 JSON 再存
          insert.run(k, raw);
        } catch (e) {
          // 损坏的 json 跳过，保留原文件供人工排查
          console.error('[kv-migrate] skip invalid json:', f, e.message);
        }
      }
    });
    tx();
    console.log(
      `[kv-migrate] imported ${files.length} legacy json files into SQLite (${DB_PATH})`
    );
  }
  return db;
}

const db = initDB();

export function kvAvailable() {
  return true;
}

export async function kvGet(key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(safeKey(key));
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export async function kvPut(key, value) {
  const raw = JSON.stringify(value, null, 2);
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
    safeKey(key),
    raw
  );
  return true;
}

export async function kvPutMany(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return true;
  const insert = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  db.transaction((items) => {
    for (const [key, value] of items) insert.run(safeKey(key), JSON.stringify(value, null, 2));
  })(entries);
  return true;
}

// Resolve or create one WeChat mini-program identity atomically. This prevents
// two concurrent wx.login requests from creating duplicate website accounts.
export async function kvResolveWechatIdentity({ identityKey, unionKey = '', userIndexKey, identity, reg, user }) {
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  return db.transaction(() => {
    const direct = select.get(safeKey(identityKey));
    if (direct) return { ok: true, created: false, identity: JSON.parse(direct.value) };

    if (unionKey) {
      const unionRow = select.get(safeKey(unionKey));
      if (unionRow) {
        const linkedIdentityKey = JSON.parse(unionRow.value);
        const linked = select.get(safeKey(linkedIdentityKey));
        if (linked) return { ok: true, created: false, identity: JSON.parse(linked.value) };
      }
    }

    put.run(safeKey(identityKey), JSON.stringify(identity));
    put.run(safeKey(userIndexKey), JSON.stringify(identityKey));
    if (unionKey) put.run(safeKey(unionKey), JSON.stringify(identityKey));
    put.run(safeKey('reg_' + reg.id), JSON.stringify(reg));
    put.run(safeKey('user_' + user.id), JSON.stringify(user));
    return { ok: true, created: true, identity };
  })();
}

// Repoint a verified mini-program identity to an existing website account in
// one transaction. Existing balances, validity, assets and history are never
// overwritten by the temporary mini-program account.
export async function kvBindWechatIdentity({ identityKey, currentUserId, targetUserId, currentUserIndexKey, targetUserIndexKey, updatedAt }) {
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM kv WHERE key = ?');
  return db.transaction(() => {
    const identityRow = select.get(safeKey(identityKey));
    if (!identityRow) return { ok: false, reason: 'identity_not_found' };
    const identity = JSON.parse(identityRow.value);
    if (String(identity.userId) !== String(currentUserId)) return { ok: false, reason: 'identity_mismatch' };

    const targetRegRow = select.get(safeKey('reg_' + targetUserId));
    const targetUserRow = select.get(safeKey('user_' + targetUserId));
    if (!targetRegRow && !targetUserRow) return { ok: false, reason: 'target_not_found' };

    const linkedRow = select.get(safeKey(targetUserIndexKey));
    if (linkedRow && JSON.parse(linkedRow.value) !== identityKey) {
      return { ok: false, reason: 'target_already_bound' };
    }

    const updatedIdentity = { ...identity, userId: targetUserId, bindingState: 'bound', updatedAt };
    put.run(safeKey(identityKey), JSON.stringify(updatedIdentity));
    put.run(safeKey(targetUserIndexKey), JSON.stringify(identityKey));
    del.run(safeKey(currentUserIndexKey));

    const currentRegRow = select.get(safeKey('reg_' + currentUserId));
    const currentUserRow = select.get(safeKey('user_' + currentUserId));
    if (currentRegRow) {
      const currentReg = JSON.parse(currentRegRow.value);
      put.run(safeKey('reg_' + currentUserId), JSON.stringify({ ...currentReg, status: 'merged', mergedInto: targetUserId, updatedAt }));
    }
    if (currentUserRow) {
      const currentUser = JSON.parse(currentUserRow.value);
      put.run(safeKey('user_' + currentUserId), JSON.stringify({ ...currentUser, status: 'merged', mergedInto: targetUserId, updatedAt }));
    }

    return {
      ok: true,
      identity: updatedIdentity,
      reg: targetRegRow ? JSON.parse(targetRegRow.value) : null,
      user: targetUserRow ? JSON.parse(targetUserRow.value) : null,
    };
  })();
}

// 自愈：微信身份指向的账号已经不存在了。
// 成因：历史版本的「注销账号 / 后台删除用户」只删了 user_/reg_ 记录，没清微信身份，
// 留下「身份还在、账号没了」的孤儿身份。kvResolveWechatIdentity 命中已存在的 identity
// 会直接返回（不做有效性校验），于是这类微信会永久卡在「查到 userId → 账号不存在」，
// 用户在小程序端连重新注册都做不到。
// 修复方式：单事务内把该身份重指向一个全新占位账号，等价于「以该微信重新注册」，用户无感。
// 并发保护：若期间该身份已被其它请求重置或绑定（userId 变了），返回 identity_changed，
// 由调用方重新走一次 resolve，绝不覆盖新状态。
export async function kvResetOrphanWechatIdentity({
  identityKey,
  unionKey = '',
  staleUserId,
  staleUserIndexKey = '',
  userIndexKey,
  identity,
  reg,
  user,
}) {
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const del = db.prepare('DELETE FROM kv WHERE key = ?');
  return db.transaction(() => {
    const row = select.get(safeKey(identityKey));
    if (!row) return { ok: false, reason: 'identity_missing' };
    let current;
    try {
      current = JSON.parse(row.value);
    } catch {
      return { ok: false, reason: 'identity_corrupt' };
    }
    if (!current || String(current.userId) !== String(staleUserId)) {
      return { ok: false, reason: 'identity_changed' };
    }
    put.run(safeKey(identityKey), JSON.stringify(identity));
    put.run(safeKey(userIndexKey), JSON.stringify(identityKey));
    if (unionKey) put.run(safeKey(unionKey), JSON.stringify(identityKey));
    if (staleUserIndexKey && staleUserIndexKey !== userIndexKey) del.run(safeKey(staleUserIndexKey));
    put.run(safeKey('reg_' + reg.id), JSON.stringify(reg));
    put.run(safeKey('user_' + user.id), JSON.stringify(user));
    return { ok: true, identity };
  })();
}

// ── 账号清理的内部工具（供 kvDeleteWechatIdentitiesByUser / kvPurgeAccount 复用）──
// 找出属于该账号的微信身份记录键。遍历 wxmini_* 即可、无需重算摘要。
// 注：用 GLOB 而非 LIKE —— LIKE 里的 _ 是单字符通配符，会误匹配。
function collectWechatIdentityKeys(rows, uid) {
  const identityKeys = new Set();
  for (const row of rows) {
    if (!row.key.startsWith('wxmini_identity_')) continue;
    try {
      const identity = JSON.parse(row.value);
      if (identity && String(identity.userId) === uid) identityKeys.add(row.key);
    } catch {
      // 损坏记录跳过，不影响其它身份清理
    }
  }
  return identityKeys;
}

// 由身份键集合反查：身份记录本身 + 指向它的索引键（wxmini_union_* / wxmini_user_* 的值即 identityKey）
function wechatKeysToDelete(rows, identityKeys) {
  const out = [];
  for (const row of rows) {
    if (row.key.startsWith('wxmini_identity_')) {
      if (identityKeys.has(row.key)) out.push(row.key);
      continue;
    }
    try {
      const linked = JSON.parse(row.value);
      if (identityKeys.has(String(linked))) out.push(row.key);
    } catch {
      // 索引值不是字符串（异常数据），不动
    }
  }
  return out;
}

function readRecordSafe(key) {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

// 清理某个账号名下的全部微信身份。保留作为 /api/single-key/* 删除路径的兜底
// （前端已改走 /api/account/purge，但旧版前端缓存仍可能调用前者）。
export async function kvDeleteWechatIdentitiesByUser(userId) {
  const uid = String(userId == null ? '' : userId);
  if (!uid) return { ok: false, removed: [] };
  let rows;
  try {
    rows = db.prepare("SELECT key, value FROM kv WHERE key GLOB 'wxmini_*'").all();
  } catch {
    return { ok: false, removed: [] };
  }
  const identityKeys = collectWechatIdentityKeys(rows, uid);
  if (identityKeys.size === 0) return { ok: true, removed: [] };
  const removed = [];
  const del = db.prepare('DELETE FROM kv WHERE key = ?');
  db.transaction(() => {
    for (const key of wechatKeysToDelete(rows, identityKeys)) {
      del.run(key);
      removed.push(key);
    }
  })();
  return { ok: true, removed };
}

// 一次性清干净一个账号的全部痕迹（用户注销 / 后台删除用户）。
// 存在意义：根治「前端分步删、漏一项」的结构性问题 —— 历史上先后踩过两个坑：
//   ① 只删 user_ 留下 reg_ → 用户用原邮箱原密码仍能登录、且邮箱被永久占用无法重新注册；
//   ② 删了 user_/reg_ 却没清 wxmini_* → 微信身份变成孤儿，该微信永久登录失败。
// 单事务执行（要么全成要么全败）；email/phone 索引由记录里反查，调用方无需传。
// 返回按类别的删除明细便于审计。
export async function kvPurgeAccount({ userId, email = '', phone = '' }) {
  const uid = String(userId == null ? '' : userId);
  if (!uid) return { ok: false, reason: 'missing_user_id', total: 0, breakdown: {} };
  const safe = safeKey(uid);
  const del = db.prepare('DELETE FROM kv WHERE key = ?');
  const fixed = [];
  const identities = [];
  const records = [];

  return db.transaction(() => {
    // 0) 记录马上要被删，先把 email/phone 读出来用于清索引
    const regRec = readRecordSafe('reg_' + safe);
    const userRec = readRecordSafe('user_' + safe);
    const em = String(email || (regRec && regRec.email) || (userRec && userRec.email) || '')
      .trim().toLowerCase().replace(/[^a-z0-9@.]/g, '_');
    const ph = String(phone || (regRec && regRec.phone) || (userRec && userRec.phone) || '')
      .replace(/[^0-9]/g, '');

    // 1) 记录型数据：按记录内的 userId 归属（order_/compute_/hist_ 都带 userId 字段）
    for (const prefix of ['order_', 'compute_', 'hist_']) {
      for (const row of db.prepare('SELECT key, value FROM kv WHERE key GLOB ?').all(prefix + '*')) {
        try {
          const rec = JSON.parse(row.value);
          if (rec && String(rec.userId) === uid) {
            del.run(row.key);
            records.push(row.key);
          }
        } catch {
          // 损坏记录跳过
        }
      }
    }

    // 2) 微信身份三件套（identity + union 索引 + user 索引）
    const wxRows = db.prepare("SELECT key, value FROM kv WHERE key GLOB 'wxmini_*'").all();
    const identityKeys = collectWechatIdentityKeys(wxRows, uid);
    for (const key of wechatKeysToDelete(wxRows, identityKeys)) {
      del.run(key);
      identities.push(key);
    }

    // 3) 账号本体、资产、登录索引
    // 注意：这里统一过一道 safeKey —— email 索引键里带 @ 和 .，而落库时 safeKey 会把它们
    // 替换成 _（如 email_a@b.c → email_a_b_c）。若直接把拼好的键交给 DELETE，会与真实行键对不上，
    // 结果就是「账号删了、email 索引还留着」——正是本次要根治的那类漏项。
    const fixedKeys = [safeKey('user_' + safe), safeKey('reg_' + safe), safeKey('assets_' + safe)];
    if (em) fixedKeys.push(safeKey('email_' + em));
    if (ph) fixedKeys.push(safeKey('phone_' + ph));
    for (const key of fixedKeys) {
      if (del.run(key).changes) fixed.push(key);
    }

    return {
      ok: true,
      total: fixed.length + identities.length + records.length,
      breakdown: { fixed: fixed.length, identities: identities.length, records: records.length },
      keys: { fixed, identities, records },
    };
  })();
}

// 智能体调用完成后的余额、算力流水在同一事务落库。
// allowPartial 仅用于“上游已经成功返回，但实际费用超过当前余额”的收尾场景：
// 扣完剩余余额并保留应计费用/差额，避免成功任务没有任何算力流水。
export async function kvRecordAgentUsage({ userId, amount, computeRecord, requestId, allowPartial = false }) {
  const uid = safeKey(userId);
  const requestedPoints = Number(amount);
  const rid = safeKey(requestId);
  if (!uid || !rid || !Number.isFinite(requestedPoints) || requestedPoints <= 0 || !computeRecord) {
    return { ok: false, reason: 'invalid' };
  }
  const userKey = 'user_' + uid;
  const regKey = 'reg_' + uid;
  const markerKey = 'agent_usage_' + rid;
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const run = db.transaction(() => {
    const marker = select.get(markerKey);
    if (marker) return { ...JSON.parse(marker.value), duplicate: true };
    const userRow = select.get(userKey);
    if (!userRow) return { ok: false, reason: 'notfound' };
    const user = JSON.parse(userRow.value);
    const current = Math.max(0, Number(user.points) || 0);
    if (current <= 0 || (!allowPartial && current < requestedPoints)) {
      return { ok: false, reason: 'insufficient', points: current };
    }
    const chargedPoints = allowPartial ? Math.min(current, requestedPoints) : requestedPoints;
    const shortfallPoints = Math.max(0, requestedPoints - chargedPoints);
    const next = current - chargedPoints;
    put.run(userKey, JSON.stringify({ ...user, points: next }, null, 2));
    const regRow = select.get(regKey);
    if (regRow) {
      const reg = JSON.parse(regRow.value);
      put.run(regKey, JSON.stringify({ ...reg, points: next }, null, 2));
    }
    const savedCompute = {
      ...computeRecord,
      userId: uid,
      amount: chargedPoints,
      meta: {
        ...(computeRecord.meta || {}),
        billablePoints: requestedPoints,
        chargedPoints,
        shortfallPoints,
        partialCharge: shortfallPoints > 0,
      },
    };
    put.run('compute_' + uid + '_' + safeKey(savedCompute.id), JSON.stringify(savedCompute, null, 2));
    const result = { ok: true, points: next, chargedPoints, requestedPoints, shortfallPoints, computeRecord: savedCompute };
    put.run(markerKey, JSON.stringify(result));
    return result;
  });
  try { return run(); } catch (error) { return { ok: false, reason: 'database', msg: error.message }; }
}

// 原生模型一次调用的余额扣减、算力流水与指标记录在同一事务落库。
// requestId 是幂等键，避免浏览器或反向代理重试造成重复扣费。
export async function kvRecordNativeUsage({ userId, amount, computeRecord, metricRecord, requestId, allowPartial = false }) {
  const uid = safeKey(userId);
  const points = Number(amount);
  const rid = safeKey(requestId);
  if (!uid || !rid || !Number.isFinite(points) || points <= 0 || !computeRecord || !metricRecord) {
    return { ok: false, reason: 'invalid' };
  }
  const userKey = 'user_' + uid;
  const regKey = 'reg_' + uid;
  const markerKey = 'native_usage_' + rid;
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const run = db.transaction(() => {
    const marker = select.get(markerKey);
    if (marker) return { ...JSON.parse(marker.value), duplicate: true };
    const userRow = select.get(userKey);
    if (!userRow) return { ok: false, reason: 'notfound' };
    const user = JSON.parse(userRow.value);
    const current = Math.max(0, Number(user.points) || 0);
    if (current <= 0 || (!allowPartial && current < points)) return { ok: false, reason: 'insufficient', points: current };
    const chargedPoints = allowPartial ? Math.min(current, points) : points;
    const shortfallPoints = Math.max(0, points - chargedPoints);
    const next = current - chargedPoints;
    put.run(userKey, JSON.stringify({ ...user, points: next }, null, 2));
    const regRow = select.get(regKey);
    if (regRow) {
      const reg = JSON.parse(regRow.value);
      put.run(regKey, JSON.stringify({ ...reg, points: next }, null, 2));
    }
    const savedCompute = {
      ...computeRecord,
      userId: uid,
      amount: chargedPoints,
      meta: {
        ...(computeRecord.meta || {}),
        billablePoints: points,
        chargedPoints,
        shortfallPoints,
        partialCharge: shortfallPoints > 0,
      },
    };
    const savedMetric = { ...metricRecord, userId: uid };
    put.run('compute_' + safeKey(savedCompute.id), JSON.stringify(savedCompute, null, 2));
    put.run('ai_metric_' + safeKey(savedMetric.id), JSON.stringify(savedMetric, null, 2));
    const result = { ok: true, points: next, chargedPoints, requestedPoints: points, shortfallPoints, computeRecord: savedCompute, metricRecord: savedMetric };
    put.run(markerKey, JSON.stringify(result));
    return result;
  });
  try { return run(); } catch (error) { return { ok: false, reason: 'database', msg: error.message }; }
}

// 管理员调整算力：余额、注册镜像、算力流水和订单在同一事务中落库。
// requestId 用作幂等键，避免网络重试造成重复加点。
export async function kvAdminAdjustPoints({ userId, amount, userPatch = {}, computeRecord, orderRecord, requestId }) {
  const uid = safeKey(userId);
  const delta = Number(amount);
  const rid = safeKey(requestId);
  if (!uid || !rid || !Number.isFinite(delta) || delta === 0 || !computeRecord || !orderRecord) {
    return { ok: false, reason: 'invalid' };
  }
  const userKey = 'user_' + uid;
  const regKey = 'reg_' + uid;
  const markerKey = 'admin_adjust_' + rid;
  const select = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
  const run = db.transaction(() => {
    const existingMarker = select.get(markerKey);
    if (existingMarker) return { ...JSON.parse(existingMarker.value), duplicate: true };

    const userRow = select.get(userKey);
    if (!userRow) return { ok: false, reason: 'notfound' };
    const user = JSON.parse(userRow.value);
    const current = Number(user.points) || 0;
    const next = current + delta;
    if (next < 0) return { ok: false, reason: 'insufficient', points: current };

    const allowedPatch = {};
    if (Object.prototype.hasOwnProperty.call(userPatch, 'planValidFrom')) allowedPatch.planValidFrom = userPatch.planValidFrom;
    if (Object.prototype.hasOwnProperty.call(userPatch, 'planValidDays')) allowedPatch.planValidDays = userPatch.planValidDays;
    if (userPatch.membership && typeof userPatch.membership === 'object') allowedPatch.membership = userPatch.membership;
    const updatedUser = { ...user, ...allowedPatch, points: next };
    put.run(userKey, JSON.stringify(updatedUser, null, 2));

    const regRow = select.get(regKey);
    if (regRow) {
      const reg = JSON.parse(regRow.value);
      put.run(regKey, JSON.stringify({ ...reg, ...allowedPatch, points: next }, null, 2));
    }

    const savedCompute = { ...computeRecord, userId: uid };
    const savedOrder = { ...orderRecord, userId: uid };
    put.run('compute_' + safeKey(savedCompute.id), JSON.stringify(savedCompute, null, 2));
    put.run('order_' + safeKey(savedOrder.id), JSON.stringify(savedOrder, null, 2));

    const result = { ok: true, points: next, user: updatedUser, computeRecord: savedCompute, order: savedOrder };
    put.run(markerKey, JSON.stringify(result));
    return result;
  });
  try { return run(); } catch (error) { return { ok: false, reason: 'database', msg: error.message }; }
}

export async function kvDelete(key) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(safeKey(key));
  return true;
}

export async function kvList(prefix, maxTotal = 8000) {
  const rows = db
    .prepare('SELECT key FROM kv WHERE key LIKE ? ESCAPE ? ORDER BY key ASC')
    .all(likeEscape(prefix) + '%', '\\');
  const keys = rows.map((r) => r.key);
  return maxTotal ? keys.slice(0, maxTotal) : keys;
}

// ===== 原子增减（通用，单语句原子，杜绝客户端读改写超卖）=====
// jsonPath 形如 '$.points'；返回更新后的整个 JSON 对象，失败（key 不存在）返回 null。
export async function kvAdjustJSON(key, jsonPath, delta) {
  const k = safeKey(key);
  const r = db
    .prepare(
      `UPDATE kv SET value = json_set(value, ?, json_extract(value, ?) + ?)
       WHERE key = ? RETURNING value`
    )
    .get(jsonPath, jsonPath, delta, k);
  if (!r) return null;
  try {
    return JSON.parse(r.value);
  } catch {
    return null;
  }
}

// ===== 算力余额原子扣减 / 增加（根除超卖，P1 收敛）=====
// kvDeductPoints：原子扣减；余额不足时整条 UPDATE 不生效（WHERE points>=amount），
//   绝不超卖、绝不扣成负数。返回 { ok:true, points:新余额 } 或
//   { ok:false, reason:'insufficient'|'invalid'|'parse', points:当前余额 }。
// kvAddPoints：原子增加（充值/赠送），返回 { ok, points }。
// COALESCE(...,0)：points 字段缺失时按 0 处理，避免 json_extract 返回 null 把余额写成 null。
// 单 UPDATE 语句由 SQLite 串行化执行，天然互斥，并发安全。
export async function kvDeductPoints(key, amount) {
  const k = safeKey(key);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid' };
  const update = db.prepare(
    `UPDATE kv SET value = json_set(value, '$.points', COALESCE(json_extract(value, '$.points'), 0) - ?)
     WHERE key = ? AND COALESCE(json_extract(value, '$.points'), 0) >= ?
     RETURNING value`
  );
  const syncReg = db.prepare(
    `UPDATE kv SET value = json_set(value, '$.points', ?)
     WHERE key = ?`
  );
  const r = db.transaction(() => {
    const updated = update.get(amt, k, amt);
    if (updated && k.startsWith('user_')) {
      const obj = JSON.parse(updated.value);
      syncReg.run(obj.points ?? 0, 'reg_' + k.slice('user_'.length));
    }
    return updated;
  })();
  if (!r) {
    // 多半是余额不足；回读当前余额供前端提示
    const cur = db.prepare('SELECT value FROM kv WHERE key = ?').get(k);
    let points = 0;
    if (cur) {
      try { points = JSON.parse(cur.value).points ?? 0; } catch { /* ignore */ }
    }
    return { ok: false, reason: 'insufficient', points };
  }
  try {
    const obj = JSON.parse(r.value);
    return { ok: true, points: obj.points ?? 0, user: obj };
  } catch {
    return { ok: false, reason: 'parse' };
  }
}

export async function kvAddPoints(key, amount) {
  const k = safeKey(key);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: 'invalid' };
  const update = db.prepare(
    `UPDATE kv SET value = json_set(value, '$.points', COALESCE(json_extract(value, '$.points'), 0) + ?)
     WHERE key = ?
     RETURNING value`
  );
  const syncReg = db.prepare(
    `UPDATE kv SET value = json_set(value, '$.points', ?)
     WHERE key = ?`
  );
  const r = db.transaction(() => {
    const updated = update.get(amt, k);
    if (updated && k.startsWith('user_')) {
      const obj = JSON.parse(updated.value);
      syncReg.run(obj.points ?? 0, 'reg_' + k.slice('user_'.length));
    }
    return updated;
  })();
  if (!r) return { ok: false, reason: 'notfound' };
  try {
    const obj = JSON.parse(r.value);
    return { ok: true, points: obj.points ?? 0, user: obj };
  } catch {
    return { ok: false, reason: 'parse' };
  }
}

// 优雅关闭（若 server 需要）
export function closeKV() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}
