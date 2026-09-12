// 微信「两端打通」阶段1 回归：跨应用 unionid 归并 + 扫码一次性票据。
//
// 分三段，按本机能力自动降级（与仓库既有 check-* 脚本同风格）：
//   A  键派生 + 源码契约 —— 无依赖，本机即可跑
//   B  真实 KV 归并       —— 需要 better-sqlite3（本机没有 → 上服务器跑）
//   C  票据 HTTP 链路     —— 需要 better-sqlite3 + 能拉起 server/index.mjs（同上）
//
// 为什么必须有 B：A 只证明「两端算出的 unionKey 一样」，而目标是「两端落到同一个 userId」
// —— 那只有在真实的 kvResolveWechatIdentity 事务里才验证得到。

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const MINI_APPID = 'wx4f071fbfd1e51130'; // 小程序
const WEB_APPID = 'wxc73517858ed7b403'; // 开放平台「网站应用」
const UNION = 'unionid-cross-app-test';

/* ── A. 键派生 ──────────────────────────────────────────────── */
const { identityStorageKeys } = await import('../server/miniapp-auth.mjs');
const mini = identityStorageKeys(MINI_APPID, 'openid-mini', UNION, 'u-mini');
const web = identityStorageKeys(WEB_APPID, 'openid-web', UNION, 'u-web');

assert.equal(mini.unionKey, web.unionKey, '同一 unionid 在两个应用下必须算出同一个 unionKey');
assert.notEqual(mini.identityKey, web.identityKey, 'identityKey 必须按应用隔离（openid 只在单个应用内唯一）');
assert.notEqual(mini.userIndexKey, web.userIndexKey, 'userIndexKey 必须按应用隔离');
assert.notEqual(identityStorageKeys(MINI_APPID, 'o', UNION + '-x').unionKey, mini.unionKey, '不同 unionid 不得碰撞');
assert.equal(identityStorageKeys(MINI_APPID, 'o', '').unionKey, '', '没有 unionid 就不该有 unionKey');
// 回归锚点：旧算法把 appId 混进摘要，跨应用永远算不出同一个键。
const legacyUnionKey = 'wxmini_union_' + crypto.createHash('sha256').update(MINI_APPID + ':' + UNION).digest('hex');
assert.notEqual(mini.unionKey, legacyUnionKey, 'unionKey 不得再包含 appId');

/* ── A2. 源码契约 ───────────────────────────────────────────── */
const source = fs.readFileSync(path.join(root, 'server/index.mjs'), 'utf8');
assert.ok(source.includes("import { handleMiniappAuth, identityStorageKeys } from './miniapp-auth.mjs';"));
assert.ok(source.includes('async function resolveWebWechatAccount(profile)'));
assert.ok(source.includes('KV.kvResolveWechatIdentity('), '网页扫码必须并入小程序同一套微信身份表');
assert.ok(source.includes('KV.kvResetOrphanWechatIdentity'), '网页扫码同样要有孤儿身份自愈');
assert.ok(!source.includes('wechatOpenid === openid'), '不得再按裸 openid 匹配账号');
assert.ok(!source.includes('const { openid, nickname, headimgurl, unionid } = await readBody(req)'), 'wechat-login 不得再接受客户端上报的 openid');
assert.ok(source.includes('consumeWechatTicket(body && body.ticket)'));
assert.ok(source.includes('entry.ticket = issueWechatTicket(entry.user)'));
assert.ok(source.includes('ticket: issueWechatTicket(demo)'));
// 阶段2B：绑定/解绑必须走服务端（旧实现是纯前端假绑定 + Profile 入口写着「功能待开放」）
assert.ok(source.includes("if (p === '/api/wechat/bind' && req.method === 'POST')"), '缺少 /api/wechat/bind 路由');
assert.ok(source.includes("if (p === '/api/wechat/unbind' && req.method === 'POST')"), '缺少 /api/wechat/unbind 路由');
assert.ok(source.includes('async function bindWebWechatToAccount'), '缺少绑定 helper');
assert.ok(source.includes('async function unbindWebWechat'), '缺少解绑 helper');
assert.ok(source.includes("requireUser(req, res, '请先登录后再绑定微信')"), '绑定必须要求登录态');
assert.ok(source.includes('KV.kvBindWechatToUser('), '绑定必须落到 KV 单事务');
assert.ok(source.includes('KV.kvUnbindWechatIdentity('), '解绑必须删服务端身份三件套');
assert.ok(!source.includes('if (!openid) return false;'), '服务端不得再接受客户端上报的 openid 做绑定');

const feStore = fs.readFileSync(path.join(root, 'frontend/src/store.jsx'), 'utf8');
const feProfile = fs.readFileSync(path.join(root, 'frontend/src/pages/Profile.jsx'), 'utf8');
const feComponents = fs.readFileSync(path.join(root, 'frontend/src/components.jsx'), 'utf8');
assert.ok(feStore.includes("'/api/wechat/bind'"), 'store 必须调服务端绑定端点');
assert.ok(feStore.includes("'/api/wechat/unbind'"), 'store 必须调服务端解绑端点');
assert.ok(!feStore.includes('if (!openid) return false;'), 'store 不得再保留前端假绑定');
assert.ok(!feProfile.includes('功能待开放'), 'Profile 绑定入口不得再写「功能待开放」');
assert.ok(feProfile.includes('bindWechat({ ticket: w && w.ticket })'), 'Profile 绑定只许提交一次性票据');
assert.ok(feComponents.includes("hintText = '扫码后，请在手机上确认登录'"), '扫码提示必须是「扫码后…」而非「已扫描…」');
assert.ok(!/text-green-600 mt-2">已扫描/.test(feComponents), '不得再出现会误报「已被扫过」的提示');
// 阶段2C：归并键自愈 / 本端身份登记 / 空壳归并 —— 线上「同一微信号两端两个 userId」事故的守卫
const kvSource = fs.readFileSync(path.join(root, 'server/kv-local.js'), 'utf8');
assert.ok(kvSource.includes("import { identityStorageKeys } from './miniapp-auth.mjs';"), '键派生必须复用唯一实现，不得在 kv-local 里复制一份');
assert.ok(kvSource.includes('unionConflict:'), '归并键被他人占用时必须上报 unionConflict');
assert.ok(kvSource.includes('unionHealed: true'), 'direct 命中时必须有 unionid 自愈分支');
assert.ok(kvSource.includes('export async function kvMergeEmptyAccountByUnion'), '缺少空壳账号归并事务');
assert.ok(kvSource.includes('function isEmptyShellAccount'), '缺少空壳判定（资产/会员/业务键三重检查）');
const maSource = fs.readFileSync(path.join(root, 'server/miniapp-auth.mjs'), 'utf8');
assert.ok(maSource.includes('resolved.unionConflict'), '小程序端必须处理归并键冲突');
assert.ok(maSource.includes('deps.KV.kvMergeEmptyAccountByUnion'), '小程序端必须调用空壳归并');
assert.ok(source.includes('resolved.unionConflict'), '网页端必须处理归并键冲突');
assert.ok(source.includes('KV.kvMergeEmptyAccountByUnion'), '网页端必须调用空壳归并');
console.log('wechat: cross-app key derivation + source contract ok');

/* ── B/C：需要 better-sqlite3 ───────────────────────────────── */
let hasSqlite = true;
try {
  await import('better-sqlite3');
} catch {
  hasSqlite = false;
}

if (!hasSqlite) {
  console.log('wechat: KV merge + ticket flow skipped (better-sqlite3 not installed on this machine)');
} else {
  // ── B. 真实 KV 归并：两个方向各一次 ──
  const mergeCase = async (firstApp) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-wx-merge-'));
    // kv-local.js 在 import 期就按 USUN_DATA_DIR 打开库 → 用 query 参数换一份独立模块实例
    process.env.USUN_DATA_DIR = dir;
    const url = new URL('../server/kv-local.js', import.meta.url);
    url.searchParams.set('case', crypto.randomBytes(6).toString('hex'));
    const KV = await import(url.href);
    const seed = async (appId, openid, uid) => {
      const keys = identityStorageKeys(appId, openid, UNION, uid);
      const rec = { id: uid, email: '', name: '归并测试', points: 0, role: 'user', status: 'active' };
      return KV.kvResolveWechatIdentity({
        identityKey: keys.identityKey,
        unionKey: keys.unionKey,
        userIndexKey: keys.userIndexKey,
        identity: { id: keys.identityKey, appId, openid, unionid: UNION, userId: uid, bindingState: 'unbound' },
        reg: rec,
        user: rec,
      });
    };
    const firstIsMini = firstApp === 'mini';
    const firstUid = firstIsMini ? 'u-mini' : 'u-web';
    const secondUid = firstIsMini ? 'u-web' : 'u-mini';
    const created = await seed(
      firstIsMini ? MINI_APPID : WEB_APPID,
      firstIsMini ? 'openid-mini' : 'openid-web',
      firstUid,
    );
    assert.equal(created.created, true);
    const merged = await seed(
      firstIsMini ? WEB_APPID : MINI_APPID,
      firstIsMini ? 'openid-web' : 'openid-mini',
      secondUid,
    );
    assert.equal(merged.created, false, '第二次登录必须复用已有身份，不得新建账号');
    assert.equal(merged.identity.userId, firstUid, '同一 unionid 必须归并到同一个 userId');
    const accountKeys = await KV.kvList('user_', 100);
    const accounts = accountKeys.filter((key) => key.startsWith('user_') && !key.includes('Index'));
    assert.equal(accounts.length, 1, '归并后只应存在一个账号，不得产生第二个');
    return firstUid;
  };
  assert.equal(await mergeCase('mini'), 'u-mini'); // 小程序先建号 → 网页扫码归并过来
  assert.equal(await mergeCase('web'), 'u-web'); // 网页先建号 → 小程序登录归并过来
  console.log('wechat: cross-app unionid merge ok (both directions)');

  // ── B2. 绑定 / 解绑（阶段2B）：冲突必须**拒绝**，不能像旧前端那样把别人的绑定抢过来 ──
  process.env.USUN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-wx-bind-'));
  const bindUrl = new URL('../server/kv-local.js', import.meta.url);
  bindUrl.searchParams.set('case', crypto.randomBytes(6).toString('hex'));
  const BK = await import(bindUrl.href);

  const mkAccount = async (uid) => {
    const rec = { id: uid, email: uid + '@bind.test', name: '绑定测试', points: 100, balance: 7, role: 'user', status: 'active', provider: 'email' };
    await BK.kvPutMany([['reg_' + uid, { ...rec, password: 'x' }], ['user_' + uid, rec]]);
  };
  const keysOf = (openid, uid, union = '') => identityStorageKeys(WEB_APPID, openid, union, uid);
  const bindArgs = (openid, uid, union = '') => {
    const keys = keysOf(openid, uid, union);
    return {
      keys,
      args: {
        identityKey: keys.identityKey,
        unionKey: keys.unionKey,
        userIndexKey: keys.userIndexKey,
        identity: { id: keys.identityKey, appId: WEB_APPID, openid, unionid: union || null, userId: uid, bindingState: 'bound', source: 'web' },
        userId: uid,
        userPatch: { wechatOpenid: openid, wechat: '微信昵称', wechatAvatar: 'https://x/a.png', unionid: union || '' },
        regPatch: { wechatOpenid: openid, wechat: '微信昵称' },
      },
    };
  };

  await mkAccount('u-bindA');
  await mkAccount('u-bindB');
  await mkAccount('u-bindC');

  // 1) 正常绑定
  const b1 = bindArgs('openid-bind-1', 'u-bindA');
  const r1 = await BK.kvBindWechatToUser(b1.args);
  assert.equal(r1.ok, true, '首次绑定必须成功');
  assert.equal(r1.alreadyBound, false);
  const userA = await BK.kvGet('user_u-bindA');
  assert.equal(userA.wechatOpenid, 'openid-bind-1', '绑定后必须回写 wechatOpenid');
  assert.equal(userA.points, 100, '绑定不得改动 points');
  assert.equal(userA.balance, 7, '绑定不得改动 balance');
  assert.equal(await BK.kvGet(b1.keys.userIndexKey), b1.keys.identityKey, '必须写入用户索引');

  // 2) 同一微信再绑到同一账号 → 幂等
  const r2 = await BK.kvBindWechatToUser(bindArgs('openid-bind-1', 'u-bindA').args);
  assert.equal(r2.ok, true);
  assert.equal(r2.alreadyBound, true, '同一微信绑到同一账号必须幂等');

  // 3) 同一微信绑到别的账号 → 拒绝（旧前端会把那个账号的绑定直接抹掉）
  const r3 = await BK.kvBindWechatToUser(bindArgs('openid-bind-1', 'u-bindB').args);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'wechat_taken');
  assert.equal((await BK.kvGet('user_u-bindB')).wechatOpenid, undefined, '冲突时不得改动对方账号');

  // 4) 同一账号再绑另一个微信 → 拒绝
  const r4 = await BK.kvBindWechatToUser(bindArgs('openid-bind-2', 'u-bindA').args);
  assert.equal(r4.ok, false);
  assert.equal(r4.reason, 'account_already_bound');

  // 5) unionid 相同但账号不同 → 拒绝（同一个人在小程序那端已属别的账号）
  const u1 = bindArgs('openid-union-1', 'u-bindC', 'union-bind-x');
  assert.equal((await BK.kvBindWechatToUser(u1.args)).ok, true);
  const r5 = await BK.kvBindWechatToUser(bindArgs('openid-union-2', 'u-bindB', 'union-bind-x').args);
  assert.equal(r5.ok, false, 'unionid 相同必须视为同一微信');
  assert.equal(r5.reason, 'wechat_taken');

  // 6) 账号不存在 → 拒绝
  const r6 = await BK.kvBindWechatToUser(bindArgs('openid-bind-9', 'u-nobody').args);
  assert.equal(r6.ok, false);
  assert.equal(r6.reason, 'account_not_found');

  // 7) 解绑：身份三件套删除、账号字段清空、points 不动
  const un = await BK.kvUnbindWechatIdentity({
    identityKey: b1.keys.identityKey,
    unionKey: b1.keys.unionKey,
    userIndexKey: b1.keys.userIndexKey,
    userId: 'u-bindA',
    userPatch: { wechatOpenid: '', wechat: '', wechatAvatar: '', unionid: '' },
    regPatch: { wechatOpenid: '', wechat: '' },
  });
  assert.equal(un.ok, true);
  assert.equal(await BK.kvGet(b1.keys.identityKey), null, '解绑后身份键必须删除');
  assert.equal(await BK.kvGet(b1.keys.userIndexKey), null, '解绑后用户索引必须删除');
  const afterUn = await BK.kvGet('user_u-bindA');
  assert.equal(afterUn.wechatOpenid, '', '解绑后账号字段必须清空');
  assert.equal(afterUn.points, 100, '解绑不得改动 points');

  // 8) 解绑已不存在的身份 → identity_not_found
  const un2 = await BK.kvUnbindWechatIdentity({
    identityKey: b1.keys.identityKey, unionKey: '', userIndexKey: b1.keys.userIndexKey, userId: 'u-bindA',
  });
  assert.equal(un2.ok, false);
  assert.equal(un2.reason, 'identity_not_found');

  // 9) 身份不属于该账号时不许解绑
  const un3 = await BK.kvUnbindWechatIdentity({
    identityKey: u1.keys.identityKey, unionKey: u1.keys.unionKey, userIndexKey: u1.keys.userIndexKey, userId: 'u-bindB',
  });
  assert.equal(un3.ok, false);
  assert.equal(un3.reason, 'identity_mismatch');
  console.log('wechat: bind/unbind contract ok (idempotent / taken / already-bound / union-conflict / mismatch)');

  // ── B3. 归并键自愈 / 本端登记 / 空壳归并（2026-09-12 线上「同一微信两端两个 userId」事故的回归锚点）──
  // 事故根因：老身份建号时微信还没返回 unionid（当时未绑定开放平台），此后每次登录都走 direct
  // 直接返回，永不补 unionid、也不建归并键 → 另一端算出的键查不到人 → 只能新建账号。
  // 所以这里必须**造一个先无 unionid、再带 unionid 登录**的序列，光测「全新身份」是测不出来的。
  process.env.USUN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-wx-heal-'));
  const healUrl = new URL('../server/kv-local.js', import.meta.url);
  healUrl.searchParams.set('case', crypto.randomBytes(6).toString('hex'));
  const HK = await import(healUrl.href);

  const resolveAs = async ({ appId, openid, unionid, userId, name = '测试' }) => {
    const keys = identityStorageKeys(appId, openid, unionid, userId);
    const now = new Date().toISOString();
    const rec = { id: userId, name, points: 0, balance: 0, role: 'user', status: 'active', provider: 'wechat' };
    return HK.kvResolveWechatIdentity({
      identityKey: keys.identityKey,
      unionKey: keys.unionKey,
      userIndexKey: keys.userIndexKey,
      identity: { id: keys.identityKey, appId, openid, unionid: unionid || null, userId, bindingState: 'unbound', createdAt: now, updatedAt: now },
      reg: { ...rec },
      user: { ...rec },
    });
  };

  // 3.1 老身份（建号时没有 unionid）再次登录 → 必须自愈出 unionid 与归并键
  const healUnion = 'union-heal-legacy';
  await resolveAs({ appId: MINI_APPID, openid: 'openid-legacy', unionid: '', userId: 'u-legacy-mini', name: '老账号' });
  const legacyKeys = identityStorageKeys(MINI_APPID, 'openid-legacy', healUnion, 'u-legacy-mini');
  assert.equal(await HK.kvGet(legacyKeys.unionKey), null, '前提：老身份一开始没有归并键');
  const healedRes = await resolveAs({ appId: MINI_APPID, openid: 'openid-legacy', unionid: healUnion, userId: 'u-legacy-ignored' });
  assert.equal(healedRes.created, false, '老身份必须复用，不得新建账号');
  assert.equal(healedRes.identity.userId, 'u-legacy-mini', '必须仍然指向老账号');
  assert.equal(healedRes.unionHealed, true, '必须标记 unionHealed');
  assert.equal((await HK.kvGet(legacyKeys.identityKey)).unionid, healUnion, '身份记录必须补上 unionid');
  assert.equal(await HK.kvGet(legacyKeys.unionKey), legacyKeys.identityKey, '必须建立归并键');

  // 3.2 另一端用同一 unionid 登录 → 归并到同一账号，**且本端身份必须落库**（旧实现漏了这步）
  const webHealKeys = identityStorageKeys(WEB_APPID, 'openid-web-heal', healUnion, 'u-web-heal');
  const webHealRes = await resolveAs({ appId: WEB_APPID, openid: 'openid-web-heal', unionid: healUnion, userId: 'u-web-heal' });
  assert.equal(webHealRes.created, false, '第二端必须归并，不得新建账号');
  assert.equal(webHealRes.identity.userId, 'u-legacy-mini', '两端必须落到同一个 userId');
  const webIdentityRow = await HK.kvGet(webHealKeys.identityKey);
  assert.ok(webIdentityRow, '归并命中时也必须登记本端 (appId, openid) 身份');
  assert.equal(webIdentityRow.userId, 'u-legacy-mini');
  // 索引键必须按**真实** userId 建（归并时传进来的是 placeholder id，写进去就等于制造幽灵索引）
  const webOwnIndexKey = identityStorageKeys(WEB_APPID, '', '', 'u-legacy-mini').userIndexKey;
  assert.equal(await HK.kvGet(webOwnIndexKey), webHealKeys.identityKey, '本端用户索引必须按真实 userId 落库');
  assert.equal(await HK.kvGet(webHealKeys.userIndexKey), null, '不得把 placeholder userId 的索引键写进库里');

  // 3.3 归并键被「空壳账号」占住 → 上报冲突，且允许自动归并
  const shellUnion = 'union-shell';
  await resolveAs({ appId: MINI_APPID, openid: 'openid-shell-mini', unionid: '', userId: 'u-shell-mini', name: '有资产的老账号' });
  await HK.kvPut('user_u-shell-mini', { id: 'u-shell-mini', name: '有资产的老账号', points: 500, balance: 0, role: 'user', status: 'active' });
  const shellWebRes = await resolveAs({ appId: WEB_APPID, openid: 'openid-shell-web', unionid: shellUnion, userId: 'u-shell-web', name: '空壳网页' });
  assert.equal(shellWebRes.created, true, '网页先扫码会新建账号（空壳）');
  const shellMiniKeys = identityStorageKeys(MINI_APPID, 'openid-shell-mini', shellUnion, 'u-shell-mini');
  const shellWebKeys = identityStorageKeys(WEB_APPID, 'openid-shell-web', shellUnion, 'u-shell-web');
  const shellConflict = await resolveAs({ appId: MINI_APPID, openid: 'openid-shell-mini', unionid: shellUnion, userId: 'u-shell-mini', name: '有资产的老账号' });
  assert.ok(shellConflict.unionConflict, '归并键被空壳占用时必须上报 unionConflict，不得擅自改写');
  assert.equal(shellConflict.unionConflict.ownerIdentityKey, shellWebKeys.identityKey);
  const mergedShell = await HK.kvMergeEmptyAccountByUnion({
    unionKey: shellWebKeys.unionKey,
    keeperIdentityKey: shellMiniKeys.identityKey,
    loserIdentityKey: shellWebKeys.identityKey,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(mergedShell.ok, true, '空壳账号必须可自动归并');
  assert.equal(mergedShell.merged, true);
  assert.equal(mergedShell.keeperUserId, 'u-shell-mini');
  assert.equal(await HK.kvGet(shellWebKeys.identityKey), null, '空壳身份必须被注销');
  assert.equal(await HK.kvGet(shellWebKeys.userIndexKey), null, '空壳用户索引必须被清理');
  assert.equal(await HK.kvGet(shellWebKeys.unionKey), shellMiniKeys.identityKey, '归并键必须改指 keeper');
  assert.equal((await HK.kvGet('user_u-shell-web')).status, 'merged', '空壳账号标记 merged，不物理删除');
  assert.equal((await HK.kvGet('user_u-shell-mini')).points, 500, 'keeper 账号资产不得被动到');

  // 3.4 归并键被「有资产的账号」占住 → 拒绝归并（宁可留两个账号，也不能吞资产）
  const richUnion = 'union-rich';
  const richWebRes = await resolveAs({ appId: WEB_APPID, openid: 'openid-rich-web', unionid: richUnion, userId: 'u-rich-web', name: '网页有钱' });
  assert.equal(richWebRes.created, true);
  await HK.kvPut('user_u-rich-web', { id: 'u-rich-web', name: '网页有钱', points: 999, balance: 0, role: 'user', status: 'active' });
  await resolveAs({ appId: MINI_APPID, openid: 'openid-rich-mini', unionid: '', userId: 'u-rich-mini', name: '老账号' });
  const richWebKeys = identityStorageKeys(WEB_APPID, 'openid-rich-web', richUnion, 'u-rich-web');
  const richMiniKeys = identityStorageKeys(MINI_APPID, 'openid-rich-mini', richUnion, 'u-rich-mini');
  const refused = await HK.kvMergeEmptyAccountByUnion({
    unionKey: richWebKeys.unionKey,
    keeperIdentityKey: richMiniKeys.identityKey,
    loserIdentityKey: richWebKeys.identityKey,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(refused.ok, false, '有资产的账号绝不允许被自动归并');
  assert.equal(refused.reason, 'loser_not_empty');
  assert.ok(await HK.kvGet(richWebKeys.identityKey), '被拒绝时不得改动对方身份');
  assert.equal((await HK.kvGet('user_u-rich-web')).points, 999, '被拒绝时不得改动对方资产');
  console.log('wechat: union self-heal + own-end registration + empty-shell merge ok');

  // ── C. 票据 HTTP 链路 ──
  const reservePort = () => new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const port = await reservePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-wx-ticket-'));
  // index.mjs 启动时有两道数据守卫：数据目录要有 kv 子目录，且该子目录不能为空
  //（防止误清数据后带空库启动），缺一即 FATAL 退出。所以先铺最小种子 ——
  // 与仓库既有的 check-stage-d-integration.mjs 做法一致。
  const kvSeedDir = path.join(dataDir, 'kv');
  fs.mkdirSync(kvSeedDir, { recursive: true });
  fs.writeFileSync(path.join(kvSeedDir, 'agents.json'), '[]');
  fs.writeFileSync(path.join(kvSeedDir, 'authProviders.json'), '[]');
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      USUN_DATA_DIR: dataDir,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      CONFIG_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      WECHAT_APPID: WEB_APPID,
      WECHAT_APPSECRET: 'test-only-secret',
      WECHAT_REDIRECT_URI: 'https://www.usunai.top/api/wechat/callback',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const collect = (chunk) => { log = (log + chunk.toString()).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (url, { method = 'GET', body } = {}) => {
    const response = await fetch(baseUrl + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
  };

  try {
    const deadline = Date.now() + 25000;
    for (;;) {
      if (child.exitCode !== null) throw new Error('test server exited early: ' + log);
      try {
        if ((await request('/api/health')).status === 200) break;
      } catch { /* 还没起来 */ }
      if (Date.now() > deadline) throw new Error('test server did not become healthy: ' + log);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const config = await request('/api/wechat/config');
    assert.equal(config.data.mode, 'real', '三个变量配齐后必须切到 real 模式');
    assert.equal(config.data.appId, WEB_APPID);

    const qr = await request('/api/wechat/qrcode', { method: 'POST' });
    assert.equal(qr.data.mode, 'real');
    assert.ok(String(qr.data.url).includes('open.weixin.qq.com/connect/qrconnect'));
    assert.ok(
      decodeURIComponent(String(qr.data.url)).includes('redirect_uri=https://www.usunai.top/api/wechat/callback'),
      '回调地址必须落在开放平台登记的授权回调域 www.usunai.top 上',
    );
    assert.ok(qr.data.state);

    // 旧式请求体（客户端上报 openid）必须被拒 —— 这正是本次修掉的认证绕过
    const legacyBody = await request('/api/auth/wechat-login', { method: 'POST', body: { openid: 'mock_openid_whatever' } });
    assert.equal(legacyBody.status, 401);
    assert.equal(legacyBody.data.code, 'INVALID_TICKET');
    assert.equal((await request('/api/auth/wechat-login', { method: 'POST', body: {} })).status, 401);

    const scan = await request('/api/wechat/mock-scan', { method: 'POST' });
    assert.ok(scan.data.ticket, 'mock 扫码也必须由服务端签发票据');

    const login = await request('/api/auth/wechat-login', { method: 'POST', body: { ticket: scan.data.ticket } });
    assert.equal(login.status, 200);
    assert.equal(login.data.ok, true);
    assert.ok(login.data.token);
    assert.ok(login.data.user && login.data.user.id);

    const replay = await request('/api/auth/wechat-login', { method: 'POST', body: { ticket: scan.data.ticket } });
    assert.equal(replay.status, 401, '票据必须一次性，重放要拒绝');
    console.log('wechat: ticket flow ok (no-ticket / legacy-openid / scan / exchange / replay)');
  } finally {
    child.kill('SIGTERM');
  }
}

console.log('wechat web merge: ok');
