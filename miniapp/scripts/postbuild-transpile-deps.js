// 把顶层 miniprogram_npm 下的第三方依赖的「现代 JS 语法」降级到 ES2018（按需）。
// 背景：Taro 4 的 copy 是纯物理复制，不编译。若某依赖的 UMD 用了 ES2020/ES2022 语法
// （?. 可选链、?? 空值合并、class 字段），微信开发者工具的「预览」编译按较低 ES 版本
// 做语法校验会直接报 `SyntaxError: Unexpected token .`（白屏 / 上传失败）。
//
// ⚠️ 重要（P22 白屏修复记录，务必保留）：
// 本脚本一度对 marked@18 做「ES2018 降级 + esbuild 注入辅助重命名为 __marked_*」。
// 但该方向是【错的】。真实根因：marked@18 源码里含「命名捕获组」正则
//   (?<a>`+)[^`]+\k<a>(?!`)  与  (?<b>`+)[^`]+\k<b>(?!`)
// 微信开发者工具「增强编译」用 swc 再次处理代码时，会把命名捕获组降级为
//   require('@swc/helpers/_/_wrap_reg_exp')
// 运行时找不到该模块 → 首页白屏 → 审核驳回 3.3。命名捕获组是 ES2018 语法，
// esbuild target=es2018 不会转它，所以「重命名 esbuild 辅助」完全没命中根因。
//
// 最终修复：把 marked 从 18.x 降级到 4.3.0。其 UMD 是纯 ES5（无命名捕获组、无 ?. /??、
// 无 class 字段），物理复制即可，swc 增强编译不会再注入任何 @swc/helpers 引用。
// 因此 marked 已从 TARGETS 移除；也不要对 marked 再跑 esbuild——esbuild 的 format:cjs
// 会把 UMD 工厂的 `exports` 形参重命名为 exports2，导致 module.exports 挂不上导出。
//
// 若未来有其它新依赖需要语法降级，往 TARGETS 里加路径即可（保持 UMD 纯 CJS 兼容优先）。

const esbuild = require('esbuild');
const fs = require('fs').promises;
const path = require('path');

// 需要语法降级的依赖（相对 dist/miniprogram_npm 的路径）。
// dayjs / tinycolor2 / tslib / marked@4 均已是 ES5，无需处理。
const TARGETS = [];

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
      format: 'cjs',
      target: 'es2018',
      charset: 'utf8',
      legalComments: 'none',
      minify: false,
    });
    await fs.writeFile(file, code, 'utf8');
    console.log(`[transpile-deps] 已降级语法: ${rel}`);
  }
  if (TARGETS.length === 0) {
    console.log('[transpile-deps] 无需要语法降级的依赖（marked 已降级到 4.x ES5），跳过。');
  }
})().catch((e) => {
  console.error('[transpile-deps] 失败:', e);
  process.exit(1);
});
