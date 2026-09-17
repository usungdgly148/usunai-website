import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exchangeWechatPhoneCode } from '../server/wechat-phone.mjs';

/**
 * 回归（纯单元）：微信「手机号快速验证组件」换号的错误映射与号码归一化。
 *
 * 为什么要单独守：这个函数是 P1-1 一键绑定的**唯一**外部依赖，而它对面是微信 ——
 * 线上跑起来会遇到的错几乎都不是「你代码写错了」，而是**配置还没到位**：
 *   48001 接口未授权 = 手机号快速验证组件还没在 MP 后台「开发管理 → 接口设置」申请开通
 *                       （这正是能力刚上线时的常态，也是真机验收第一次点击最可能撞到的返回）
 *   45011 调用太频繁 / -1 微信侧系统繁忙 = 抖动
 * 这三类都必须是 `WECHAT_PHONE_UNAVAILABLE` → 上层回 503 → 客户端退化到短信。
 * 一旦有人把它们并进 400，用户看到的就是微信那句英文 errmsg（api unauthorized hint…），
 * 既看不懂也走不下去。所以这里逐条钉住。
 *
 * ⚠️ 本脚本不碰网络：`getToken` 与 `fetchImpl` 都可注入。
 */
const TOKEN = 'token-abc';

// 造一个假微信：`responses` 依次消费，每个元素是 { status, body }
const makeFetch = (responses, log = []) => async (url, init) => {
  const next = responses.shift();
  if (!next) throw new Error('fetch 被多调了一次（responses 用尽）');
  log.push({ url, init });
  return {
    ok: next.status ? next.status < 400 : true,
    status: next.status || 200,
    async text() { return next.body === undefined ? '' : JSON.stringify(next.body); },
  };
};
const okToken = async () => TOKEN;

// ── ① 空令牌：本地就该拒，绝不能白跑一次网络请求（一次 0.03 元、且额度只有 1000）──
let called = 0;
await assert.rejects(
  () => exchangeWechatPhoneCode('   ', {
    getToken: okToken,
    fetchImpl: async () => { called += 1; throw new Error('不该发起请求'); },
  }),
  (error) => error.code === 'WECHAT_PHONE_CODE_REQUIRED',
);
assert.equal(called, 0, '空令牌必须在本地拒绝，不得打网络请求');
await assert.rejects(() => exchangeWechatPhoneCode(undefined, { getToken: okToken }), 
  (error) => error.code === 'WECHAT_PHONE_CODE_REQUIRED');

// ── ② 成功：拿 purePhoneNumber，返回号码与国家码 ──────────────────────────────
const log = [];
const okRes = await exchangeWechatPhoneCode('DYN-1', {
  getToken: okToken,
  fetchImpl: makeFetch([{ body: { errcode: 0, phone_info: { phoneNumber: '+8613800001234', purePhoneNumber: '13800001234', countryCode: '86' } } }], log),
});
assert.equal(okRes.phone, '13800001234');
assert.equal(okRes.countryCode, '86');
assert.equal(log.length, 1, '成功路径只该请求一次');
assert.match(log[0].url, /\/wxa\/business\/getuserphonenumber\?access_token=token-abc$/,
  '必须打到官方接口，且 access_token 拼在 query 上');
assert.equal(log[0].init.method, 'POST');
assert.deepEqual(JSON.parse(log[0].init.body), { code: 'DYN-1' }, '动态令牌必须放 body.code，不能拼进 URL');
assert.ok(log[0].init.signal, '必须带超时信号，否则微信不响应时会挂住请求');

// ── ③ 只有 phoneNumber（带 +86）时的兜底剥前缀 ───────────────────────────────
const fallback = await exchangeWechatPhoneCode('DYN-2', {
  getToken: okToken,
  fetchImpl: makeFetch([{ body: { errcode: 0, phone_info: { phoneNumber: '+8613800005678', countryCode: '86' } } }]),
});
assert.equal(fallback.phone, '13800005678', '没有 purePhoneNumber 时必须从 phoneNumber 剥掉国家码');

// 国家码缺失时兜底 '86'
const noCountry = await exchangeWechatPhoneCode('DYN-3', {
  getToken: okToken,
  fetchImpl: makeFetch([{ body: { errcode: 0, phone_info: { purePhoneNumber: '13800009999' } } }]),
});
assert.equal(noCountry.countryCode, '86');

// ── ④ 号码格式不对：微信给了非大陆号码 → 明确拒绝，不要拿它去建账号 ──────────
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-4', {
    getToken: okToken,
    fetchImpl: makeFetch([{ body: { errcode: 0, phone_info: { purePhoneNumber: '99999999999', countryCode: '1' } } }]),
  }),
  (error) => error.code === 'WECHAT_PHONE_INVALID_NUMBER',
);
// 微信返回了但 phone_info 是空的 → 同样按「号码不可用」处理
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-5', {
    getToken: okToken,
    fetchImpl: makeFetch([{ body: { errcode: 0 } }]),
  }),
  (error) => error.code === 'WECHAT_PHONE_INVALID_NUMBER',
);

// ── ⑤ 错误码映射表：哪些该让用户「重新点一次」（400），哪些该退化到短信（503）──
// 400 类：令牌本身不好使
for (const [errcode, expected, hint] of [
  [40029, 'WECHAT_PHONE_CODE_INVALID', '令牌无效/已消费'],
  [40163, 'WECHAT_PHONE_CODE_INVALID', '令牌已被使用过'],
  [40013, 'WECHAT_PHONE_CODE_INVALID', '其它业务报错，一律按「重新点一次」处理'],
  [-1, 'WECHAT_PHONE_UNAVAILABLE', '微信侧系统繁忙'],
  [48001, 'WECHAT_PHONE_UNAVAILABLE', '接口未授权 = 手机号快速验证组件还没在 MP 后台申请开通'],
  [45011, 'WECHAT_PHONE_UNAVAILABLE', '调用太频繁'],
]) {
  await assert.rejects(
    () => exchangeWechatPhoneCode('DYN-BAD', {
      getToken: okToken,
      fetchImpl: makeFetch([{ body: { errcode, errmsg: 'errmsg for ' + errcode } }]),
    }),
    (error) => {
      assert.equal(error.code, expected, `errcode ${errcode}（${hint}）必须映射为 ${expected}`);
      assert.equal(error.detail?.errcode, errcode, '原始 errcode 必须留在 detail 里便于排查');
      return true;
    },
  );
}

// ── ⑥ access_token 失效：强刷一次再试（微信会作废旧 token，缓存不能当权威）─────
const refreshLog = [];
const seenForceFlags = [];
const refreshed = await exchangeWechatPhoneCode('DYN-6', {
  getToken: async (force) => { seenForceFlags.push(Boolean(force)); return force ? 'token-new' : 'token-old'; },
  fetchImpl: makeFetch([
    { body: { errcode: 42001, errmsg: 'access_token expired' } },
    { body: { errcode: 0, phone_info: { purePhoneNumber: '13800001111', countryCode: '86' } } },
  ], refreshLog),
});
assert.equal(refreshed.phone, '13800001111', 'token 过期后强刷一次必须能成功');
assert.deepEqual(seenForceFlags, [false, true], '第一次用缓存、第二次必须 forceRefresh');
assert.equal(refreshLog.length, 2);
assert.match(refreshLog[1].url, /access_token=token-new$/, '重试必须用刷出来的新 token');
// 40001（无效 token）同样强刷
const refreshed2Seen = [];
await exchangeWechatPhoneCode('DYN-7', {
  getToken: async (force) => { refreshed2Seen.push(Boolean(force)); return 't'; },
  fetchImpl: makeFetch([
    { body: { errcode: 40001, errmsg: 'invalid credential' } },
    { body: { errcode: 0, phone_info: { purePhoneNumber: '13800002222' } } },
  ]),
});
assert.deepEqual(refreshed2Seen, [false, true], '40001 也必须触发强刷重试');

// 但只重试一次：刷完还是过期就必须抛，不能无限循环
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-8', {
    getToken: okToken,
    fetchImpl: makeFetch([
      { body: { errcode: 42001 } },
      { body: { errcode: 42001 } },
    ]),
  }),
  (error) => error.code === 'WECHAT_PHONE_UNAVAILABLE' || error.code === 'WECHAT_PHONE_CODE_INVALID',
);
// 令牌本身无效（40029）不该触发强刷 —— 刷 token 治不了坏令牌，只会白花一次额度
let badTokenCalls = 0;
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-9', {
    getToken: async () => { badTokenCalls += 1; return TOKEN; },
    fetchImpl: makeFetch([{ body: { errcode: 40029, errmsg: 'invalid code' } }]),
  }),
  (error) => error.code === 'WECHAT_PHONE_CODE_INVALID',
);
assert.equal(badTokenCalls, 1, '40029 不该强刷 access_token');

// ── ⑦ 传输层坏掉（无 JSON 可解析）→ 暂时不可用，而不是「号码错」 ─────────────
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-A', { getToken: okToken, fetchImpl: makeFetch([{ status: 502, body: undefined }]) }),
  (error) => error.code === 'WECHAT_PHONE_UNAVAILABLE',
);
// 返回非 JSON 文本（微信网关挂了会回 HTML）→ 同样按不可用处理
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-B', {
    getToken: okToken,
    fetchImpl: async () => ({ ok: true, status: 200, async text() { return '<html>gateway</html>'; } }),
  }),
  (error) => error.code === 'WECHAT_PHONE_UNAVAILABLE',
);

// ── ⑧ 凭证没配（AppSecret 缺失）→ 原样向上抛，由上层映射为 503 ───────────────
let tokenFetchCalls = 0;
await assert.rejects(
  () => exchangeWechatPhoneCode('DYN-C', {
    getToken: async () => { const e = new Error('小程序 AppSecret 未配置'); e.code = 'VIRTUAL_PAY_NOT_CONFIGURED'; throw e; },
    fetchImpl: async () => { tokenFetchCalls += 1; throw new Error('不该发起请求'); },
  }),
  (error) => error.code === 'VIRTUAL_PAY_NOT_CONFIGURED',
);
assert.equal(tokenFetchCalls, 0, '凭证缺失时不该发起业务请求');

// ── 源码闸门：不得绕过官方接口、不得自己写库、必须复用虚拟支付的 token 缓存 ───
const source = fs.readFileSync(new URL('../server/wechat-phone.mjs', import.meta.url), 'utf8');
assert.match(source, /getuserphonenumber/, '必须走微信官方换号接口');
assert.ok(!/kvPut|kvBindPhoneToAccount/.test(source),
  'wechat-phone.mjs 只负责换号：写库只能有一个出口（kvBindPhoneToAccount）');
assert.match(source, /import \{ getAccessToken \} from '\.\/wechat-virtual-pay\.mjs'/,
  'access_token 必须复用虚拟支付那套缓存 —— 同一 AppId 各建一份会互相作废对方的 token');
assert.match(source, /不能混用/, '必须留下「动态令牌 ≠ wx.login 的 code」的注释');

console.log('miniapp wechat phone check passed: 换号错误映射（400 重试 / 503 退化）× 号码归一化 × token 强刷重试');
