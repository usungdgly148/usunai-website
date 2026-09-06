// 把 dist/miniprogram_npm/tdesign-miniprogram/ 下所有 .js 的 ESM 语法转成 CommonJS。
// 背景：Taro 4 的 copy 是纯物理复制，不编译。TDesign 1.16 源码全是 ESM。
// 手机基础库 3.17+ 可 ESM 化加载，但微信开发者工具模拟器按 CommonJS 加载会报错。
//
// 为什么用 esbuild 而非 babel：
//   - babel 的 modules:commonjs（尤其 loose:true）会生成 `exports.__esModule = true` 赋值。
//     微信 IDE 增强编译（enhance:true）把 dist 内 JS 打包进主包 bundle 时，会先
//     `Object.defineProperty(exports,'__esModule',{value:true})`（只读），
//     此时业务代码再 `exports.__esModule = true` 就会抛
//     "Cannot assign to read only property '__esModule'"。
//   - esbuild 转 CJS 输出 `module.exports = __toCommonJS(stdin_exports)`，
//     其中 __toCommonJS 是 `__defProp({}, '__esModule', {value:true})`（作用在新建对象上），
//     整体替换 module.exports 引用，绝不触碰 IDE 预定义的只读属性 → 无冲突。
const esbuild = require('esbuild');
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.resolve(__dirname, '../dist/miniprogram_npm/tdesign-miniprogram');
let converted = 0;
let scanned = 0;

async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(fp);
    } else if (e.name.endsWith('.js')) {
      scanned++;
      const content = await fs.readFile(fp, 'utf8');
      // 仅当包含真正的 ESM 导出时才转换（避免重复处理已经是 CJS 的文件）。
      // 精确匹配：export 前面不能是 字母/数字/_/./$（排除 __export、module.exports、
      // .export()、exports），后面是 {、*、或 空格+关键字。
      // TDesign 有 `export{}`（type.js 空导出）、`export*from"..."`、
      // `export{default as X}` 等无空格形式，普通 `export\s+(default|const|...)` 会漏掉。
      const esmExportRe = /(?<![A-Za-z0-9_$.])export(?:\s+(?:default|const|let|var|function|class|async|type|interface|namespace)\b|\s*[{}*])/;
      if (!esmExportRe.test(content)) continue;
      const { code } = esbuild.transformSync(content, {
        loader: 'js',
        format: 'cjs',
        target: 'es2018',     // 只转模块系统，保留 class/const/arrow 等（微信基础库支持）
        platform: 'neutral',  // 小程序运行时不是 node，避免注入 node polyfill
        sourcefile: e.name,   // 用真实文件名，生成可读的 __name 变量
        charset: 'utf8',
        legalComments: 'none',
        minify: false,
      });
      await fs.writeFile(fp, code, 'utf8');
      converted++;
    }
  }
}

(async () => {
  try {
    await walk(ROOT);
    console.log(`[esm-to-cjs] 扫描 ${scanned} 个文件，esbuild 转换 ${converted} 个 ESM 文件 → CJS`);
  } catch (e) {
    console.error('[esm-to-cjs] 失败:', e);
    process.exit(1);
  }
})();
