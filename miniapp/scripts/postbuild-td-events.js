/**
 * postbuild-td-events.js
 *
 * 修正 TDesign 官方组件 triggerEvent 的事件名，使其与 Taro 编译产物的事件绑定对得上。
 *
 * 背景：Taro 4 会把 React 侧的 onXxxYyy 编译成 bind:xxx-yyy（连字符）。
 * 证据见 node_modules/@tarojs/shared/dist/template.js buildThirdPartyAttr：
 *     let value = toKebabCase(attr.slice(2));
 *     if (value.indexOf('-') > -1) value = `:${value}`;   // 多词 → bind:xxx-yyy
 *     return str + ` bind${value}="eh"`;                  // 单词 → bindxxx
 * 而 tdesign-miniprogram 组件内部用的是驼峰 triggerEvent('fileSelect') /
 * triggerEvent('updateVisible')（见 chat-sender.js），两者对不上 →
 * 页面收不到事件（＋加号弹层选图、附件删除全部静默失效，不报错、极难排查）。
 *
 * 本脚本把 chat-sender 里的事件名改成连字符（与 Taro 产物一致）：
 *   fileSelect→file-select  fileChange→file-change  fileDelete→file-delete
 *   fileClick→file-click    uploadClick→upload-click
 *   updatevisible / updateVisible → update-visible
 *
 * ⚠️ 只改 chat-sender：它的事件是「页面侧」绑定的。
 *    attachments.js 的 fileClick / remove 是 chat-sender 自己的 wxml 用
 *    bind:fileClick / bind:remove 绑的（原生绑定，驼峰能对上），改了反而会断链。
 *
 * 落点（双写）：
 *   - node_modules 源（下次 taro build 拷贝进 dist 时即为正确产物）
 *   - dist/miniprogram_npm 产物（本次构建立即生效）
 *
 * 幂等：可重复执行。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 需要改写的事件名（组件内驼峰/小写 → Taro 产物连字符） */
const EVENT_RENAMES = [
  ['updatevisible', 'update-visible'],
  ['updateVisible', 'update-visible'],
  ['fileSelect', 'file-select'],
  ['fileChange', 'file-change'],
  ['fileDelete', 'file-delete'],
  ['fileClick', 'file-click'],
  ['uploadClick', 'upload-click'],
];

const REL_FILES = ['chat-sender/chat-sender.js'];

const ROOTS = [
  path.join(ROOT, 'node_modules/tdesign-miniprogram/miniprogram_dist'),
  path.join(ROOT, 'dist/miniprogram_npm/tdesign-miniprogram'),
];

let changed = 0;

for (const base of ROOTS) {
  for (const rel of REL_FILES) {
    const file = path.join(base, rel);
    if (!fs.existsSync(file)) {
      console.warn('[postbuild] 跳过（文件不存在）:', path.relative(ROOT, file));
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    let next = source;
    for (const [from, to] of EVENT_RENAMES) {
      next = next.split(`"${from}"`).join(`"${to}"`);
      next = next.split(`'${from}'`).join(`'${to}'`);
    }
    if (next === source) {
      console.log('[postbuild] 事件名已是最新:', path.relative(ROOT, file));
      continue;
    }
    fs.writeFileSync(file, next);
    changed += 1;
    console.log('[postbuild] 已修正组件事件名:', path.relative(ROOT, file));
  }
}

console.log(`[postbuild] tdesign 事件名修正完成（${changed} 个文件有改动）`);
