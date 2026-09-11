/**
 * `@tarojs/taro` 在后台画布里的替身（由 vite.config.js 的 alias 指过来）。
 *
 * 只实现渲染器真正用到的那几件事：本地存储、事件总线、页面跳转。
 * 跳转**不真的跳** —— 而是把「点了会去哪儿」回吐给画布下方那一行读出行。
 * 这样后台配的逐项跳转（分类卡 / 推荐卡）在画布上点一下就能验，不用发版上真机。
 */

const memory = new Map();
const listeners = new Set();

/** 订阅画布里的跳转：返回取消订阅函数 */
export function onPreviewNavigate(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function report(kind, options) {
  const url = String((options && options.url) || '');
  for (const listener of listeners) listener({ kind, url });
}

export default {
  // —— 本地存储：画布内用内存 Map，不碰后台自己的 localStorage
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => { memory.set(key, value); },
  removeStorageSync: (key) => { memory.delete(key); },

  // —— 事件总线：公告已读红点那套监听在画布里不需要真的联动
  eventCenter: { on() {}, off() {}, trigger() {} },

  // —— 跳转：只上报，不执行（画布是个静态预览，不能把后台页面跳走）
  navigateTo: (options) => report('navigateTo', options),
  reLaunch: (options) => report('reLaunch', options),
  redirectTo: (options) => report('redirectTo', options),
  switchTab: (options) => report('switchTab', options),
  navigateBack: () => report('navigateBack', {}),

  stopPullDownRefresh: () => {},
  showToast: () => {},

  // —— 画布明确不支持的：真调用到就是 bug，直接抛比静默返回 undefined 好查
  login: () => Promise.reject(new Error('后台画布不执行小程序登录')),
  request: () => Promise.reject(new Error('后台画布不发起小程序请求')),
};
