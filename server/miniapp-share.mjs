/**
 * 小程序「分享（转发给朋友 / 分享到朋友圈）」的可配置文案。
 *
 * 背景：分享卡片上那三样东西以前是写死在源码里的（`miniapp/src/utils/share.ts`），
 * 想改个标题就得重新构建 + 重新上传小程序。现在改成后台「小程序设置 → 分享设置」可改：
 * 存 KV，随 `/api/miniapp/v1/content` 下发，小程序端在**分享那一刻**从本地缓存里同步取值。
 *
 * 三个字段与微信原生 `onShareAppMessage` 的三个变量一一对应：
 *   title    分享标题
 *   path     点开卡片后打开的页面；留空 = 跟随分享时用户所在的那一页
 *   imageUrl 卡片配图（微信按 5:4 展示）；留空 = 微信默认截取当前页面
 *
 * ⚠️ 本模块**纯函数、不碰 KV**：后台读写接口（server/index.mjs）、公开下发
 * （server/miniapp-api.mjs）和本机的契约自测共用这一份归一化/校验逻辑，
 * 不各处再写一套（写两套必然漂移）。
 */

/** 分享设置存这个 KV 键；下发给小程序时字段名叫 `shareSettings`（见 miniapp-api.mjs）。 */
export const SHARE_CONFIG_KV_KEY = 'miniappShareSettings';

/**
 * 标题上限 60 字：微信分享卡片标题过长会被截断，60 字足够写完整句，
 * 也能拦住「误把整段营销文案粘进来」这种操作。
 */
export const SHARE_TITLE_MAX = 60;

/**
 * 落地页必须是本小程序内的页面。
 *
 * 只校验**形状**，不比对页面清单：页面清单（app.config.ts）会随迭代变化，
 * 服务端再存一份副本，将来新增页面时合法路径会被错判成非法。
 */
const SHARE_PATH_RE = /^\/pages\/[a-z0-9-]+\/index(?:\?[^\s#]*)?$/;
const SHARE_PATH_MAX = 200;
const SHARE_IMAGE_MAX = 500;

/**
 * 配图的可用形态只有两种：`https://` 外链，或本站图床（点「上传图片」得到的就是
 * `/api/blob/serve?key=…`）。
 *
 * ⚠️ 明确**不接受**小程序包内相对路径 —— 微信文档的示例恰好写成 `/images/share.png`，
 * 很容易被照抄。但后台改不了代码包，那个文件多半不存在，写进去只会在分享卡片上
 * 得到一张加载失败的图，而且**不报错**。宁可在这里拦下。
 */
const SHARE_IMAGE_RE = /^(?:https?:\/\/|\/api\/blob\/serve\?)/i;

/**
 * 读取侧归一化：把任意形状（旧数据 / 手改过的 KV / 缺字段）收敛成
 * `{ title, path, imageUrl }` 三个字符串，永远不会返回 undefined。
 *
 * ⚠️ 这里对超长值是**截断**（读取侧要容错），而 validateShareSettingsInput 对超长值是**报错**
 * （写入侧要拦人）——两处行为不同是有意的，别合并。
 */
export function normalizeShareSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const path = text(source.path, SHARE_PATH_MAX);
  const imageUrl = text(source.imageUrl, SHARE_IMAGE_MAX);
  return {
    title: text(source.title, SHARE_TITLE_MAX),
    // 读取侧也校验形态，不只是写入侧：KV 可能被手工改过、或被别的版本写进过非法路径，
    // 那种值一旦下发，用户点开分享卡片就是「页面不存在」——宁可退化成「跟随当前页面」。
    path: SHARE_PATH_RE.test(path) ? path : '',
    // 同理：不可加载的配图会让卡片变成一张破图，退化成「截取当前页面」反而更好看。
    imageUrl: SHARE_IMAGE_RE.test(imageUrl) ? imageUrl : '',
  };
}

/** 三个字段全空 = 未配置（小程序端回退到内置默认标题与「跟随当前页面」）。 */
export function shareSettingsConfigured(raw) {
  const s = normalizeShareSettings(raw);
  return !!(s.title || s.path || s.imageUrl);
}

/**
 * 后台保存前的校验：返回 `{ ok: true, data }` 或 `{ ok: false, msg }`。
 * 校验放服务端（而不是只信前端）：直接调接口写进一个点开就白屏的路径，
 * 影响的是所有分享出去的名片，必须拦在写入之前。
 */
export function validateShareSettingsInput(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const trimmed = (key) => (typeof raw[key] === 'string' ? raw[key].trim() : '');
  const title = trimmed('title');
  const path = trimmed('path');
  const imageUrl = trimmed('imageUrl');

  if (title.length > SHARE_TITLE_MAX) {
    return { ok: false, msg: `分享标题最多 ${SHARE_TITLE_MAX} 字（当前 ${title.length} 字）` };
  }
  if (path.length > SHARE_PATH_MAX) {
    return { ok: false, msg: '页面路径过长' };
  }
  if (path && !SHARE_PATH_RE.test(path)) {
    return { ok: false, msg: '页面路径格式不对：应形如 /pages/home/index，留空则跟随用户当前所在页面' };
  }
  if (imageUrl.length > SHARE_IMAGE_MAX) {
    return { ok: false, msg: '图片地址过长' };
  }
  if (imageUrl && !SHARE_IMAGE_RE.test(imageUrl)) {
    return {
      ok: false,
      msg: '配图需是 https 外链，或先用「上传图片」传到本站图床；不能填小程序包内相对路径（如 /images/share.png）',
    };
  }
  return { ok: true, data: { title, path, imageUrl } };
}
