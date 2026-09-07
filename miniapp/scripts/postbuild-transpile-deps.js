// 把顶层 miniprogram_npm 下的第三方依赖（marked 等）的「现代 JS 语法」降级到 ES2018。
// 背景：Taro 的 copy 是纯物理复制，不编译。marked 18.x 的 UMD（marked.umd.js）用了
// ES2020/ES2022 语法（?. 可选链、?? 空值合并、class 字段），微信开发者工具的「预览」编译
// 按较低 ES 版本做语法校验，直接报 `SyntaxError: Unexpected token .`（白屏 / 上传失败）。
// 用 esbuild 把语法降到 ES2018（与 tdesign 的 esm-to-cjs 一致，微信基础库支持）。
//
// ⚠️ 关键：esbuild 转 CJS 时会注入一组运行时辅助（__defProp / __publicField / __copyProps 等），
// 这些名字采用 `__` 前缀，**和 swc helper 命名约定高度撞车**。微信开发者工具的「增强编译」
// 用 swc 再次处理代码时，会把这些 esbuild 风格辅助误识别为 swc helper 调用，插入
// `require('@swc/helpers/_/_wrap_reg_exp')` 等引用，运行时找不到模块 → 首页白屏 → 审核驳回 3.3。
// 修复：esbuild 转换完成后做后处理，把所有 esbuild 注入的辅助重命名为 `__marked_*` 前缀
// （前缀 + 业务包名组合），与 swc helper 命名空间彻底隔离，swc 增强编译不再误插 require。
//
// 注意：`.at(-1)` / `Object.hasOwn` 是【API 不是语法】，esbuild 不 polyfill；
// 但真机基础库（3.17+）已支持，且真机预览一直正常，故这里只处理语法、不处理 API。
// 若未来有旧基础库设备报 `.at is not a function`，应改为降级 marked 版本（如 marked@4.x）而非继续转译。

const esbuild = require('esbuild');
const fs = require('fs').promises;
const path = require('path');

// 需要语法降级的依赖（相对 dist/miniprogram_npm 的路径）。dayjs/tinycolor2/tslib 已是 ES5，无需处理。
const TARGETS = [
  'marked/index.js',
];

// esbuild 注入的辅助函数名（来自 esbuild docs "Helper Functions"）。
// 命名空间加 `marked_` 前缀避免与 swc helper 命名（__wrap_reg_exp / __class_private_method_get 等）冲突。
const ESBUILD_HELPERS = [
  '__defProp', '__defNormalProp', '__defProps',
  '__publicField', '__privateMethod', '__privateGet', '__privateSet',
  '__privateIn', '__publicMethod', '__accessError', '__throw',
  '__getOwnPropDesc', '__getOwnPropNames', '__getOwnPropSymbols',
  '__propKey', '__objRest', '__copyProps', '__values', '__spreadValues',
  '__spreadProps', '__read', '__runInitializers', '__superGet', '__superSet',
  '__addDisposableResource', '__disposeResources', '__using',
  '__decorate', '__exportStar', '__reExport', '__setFunctionName',
];

(async () => {
  for (const rel of TARGETS) {
    const file = path.resolve(__dirname, '../dist/miniprogram_npm', rel);
    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch (e) {
      console.warn(`[transpile-deps] 跳过（文件不存在）: ${rel}`);
      continue;
    }
    const { code } = esbuild.transformSync(content, {
      loader: 'js',
      format: 'cjs',      // marked 是 UMD（CJS 分支），转成纯 CJS 供 require 使用
      target: 'es2018',   // 降到 ES2018：去掉 ?. / ?? / class 字段，保留 class/箭头函数（微信支持）
      charset: 'utf8',
      legalComments: 'none',
      minify: false,
    });
    // 后处理：把 esbuild 注入的 `__*` 辅助重命名为 `__marked_*`，避免与 swc helper 命名撞车
    let renamed = code;
    for (const name of ESBUILD_HELPERS) {
      const renamedName = name.replace(/^__/, '__marked_');
      // 仅在单词边界（前后非标识符字符）替换，避免误伤业务代码里同名字符串
      renamed = renamed.replace(new RegExp(`\\b${name}\\b`, 'g'), renamedName);
    }
    if (renamed !== code) {
      console.log(`[transpile-deps] 已重命名 esbuild 辅助为 __marked_*: ${rel}（${ESBUILD_HELPERS.length} 个）`);
    }
    await fs.writeFile(file, renamed, 'utf8');
    console.log(`[transpile-deps] 已降级语法: ${rel}`);
  }
})().catch((e) => {
  console.error('[transpile-deps] 失败:', e);
  process.exit(1);
});
