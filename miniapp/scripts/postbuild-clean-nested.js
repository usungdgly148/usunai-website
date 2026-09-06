// 构建后清理：
// Taro 4 会自动把 tdesign-miniprogram 包 import 字符串对应的兄弟 npm 包（marked / tslib / dayjs / tinycolor2）
// 递归复制到 dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm/ 子目录。
// 这个嵌套副本是冗余的，且会导致微信开发者工具在增强编译（enhance:true）时去这条嵌套路径注入
// @swc/helpers/_/* 的 require 进而找不到。本脚本构建完成后强制删除该嵌套副本。
//
// 顶层复制：dist/miniprogram_npm/{marked,tslib} 已由 config/index.ts copy.patterns 显式声明，
// 这里只删冗余嵌套产物，安全。

const fs = require('fs/promises');
const path = require('path');

const target = path.resolve(
  __dirname,
  '../dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm'
);

(async () => {
  try {
    await fs.rm(target, { recursive: true, force: true });
    // 尝试把父目录下空 miniprogram_npm 残留名也清掉（Taro 有时会留下空目录占位）
    const parent = path.dirname(target);
    for (const name of await fs.readdir(parent)) {
      const full = path.join(parent, name);
      const stat = await fs.lstat(full);
      if (stat.isDirectory() && name === 'miniprogram_npm') {
        const items = await fs.readdir(full).catch(() => null);
        if (!items || items.length === 0) {
          await fs.rmdir(full).catch(() => {});
        }
      }
    }
    console.log('[postbuild] 已清理嵌套副本:', target);
  } catch (e) {
    console.warn('[postbuild] 跳过（无嵌套副本）:', e.message);
  }
})();
