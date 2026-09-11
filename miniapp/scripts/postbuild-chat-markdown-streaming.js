/**
 * postbuild-chat-markdown-streaming.js
 *
 * 让 TDesign t-chat-message 渲染的助手消息**显示流式光标（▋）**。
 *
 * 背景：官方组件链路是 chat-message → chat-content → chat-markdown，
 * 但 chat-message.wxml 在调用 chat-content 时**只透传了 content / role / status**：
 *
 *   <chat-content content="{{item}}" role="{{role}}" status="{{status}}" catchclick="onContentClick">
 *
 * 而 chat-content 的 props 明明是 `{content, markdownProps, role, status}`。
 * 于是 `chat-markdown` 拿到的 `streaming` 永远是 undefined —— 官方文档里那套
 * `streaming: { hasNextChunk, tail, completeSyntax }` 流式能力**从 chat-message 走不到**。
 *
 * 本脚本只补一句 wxml 透传，不动官方 JS：`chatContentProps` 本来就是 chat-message
 * 自己的一个 Object 属性（原本只喂给 chat-thinking），我们把 markdown 那半边挂上去，
 * 从 chat-content 一路递到 chat-markdown：
 *
 *   chatContentProps={{ markdown: { streaming: { hasNextChunk: true, tail: true } } }}
 *
 * ⚠️ 调用方必须**只在真正流式的最后一条消息**上传这个属性，否则每条消息尾巴上都有光标。
 *
 * 落点（双写，与 postbuild-chat-selectable.js 同一套约定）：
 *   - node_modules 源（下次 taro build 拷贝进 dist 时即为正确产物）
 *   - dist/miniprogram_npm 产物（本次构建立即生效）
 * 幂等：已打过则跳过。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REL = (p) => path.relative(ROOT, p);

const TARGETS = [
  'node_modules/tdesign-miniprogram/miniprogram_dist/chat-message',
  'dist/miniprogram_npm/tdesign-miniprogram/chat-message',
];

const FILE = 'chat-message.wxml';

/** 精确子串替换；已存在 new 则跳过（幂等） */
function patchFile(filePath, rules) {
  if (!fs.existsSync(filePath)) {
    console.log(`[chat-streaming] 跳过（不存在）: ${REL(filePath)}`);
    return false;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = 0;
  for (const { old: from, next, note } of rules) {
    if (content.includes(next)) {
      console.log(`[chat-streaming] 幂等跳过: ${note}`);
      continue;
    }
    if (!content.includes(from)) {
      console.warn(`[chat-streaming] 未命中（TDesign 版本可能变了）: ${note}`);
      continue;
    }
    content = content.split(from).join(next);
    changed += 1;
  }
  if (changed > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[chat-streaming] 已更新 ${changed} 条规则: ${REL(filePath)}`);
  }
  return changed > 0;
}

const RULES = [
  {
    // 原句：<chat-content wx:elif="{{item.type === 'text' || item.type === 'markdown'}}" content="{{item}}" role="{{role}}" status="{{status}}" catchclick="onContentClick">
    old: `content="{{item}}" role="{{role}}" status="{{status}}" catchclick="onContentClick"`,
    next: `content="{{item}}" role="{{role}}" status="{{status}}" markdownProps="{{chatContentProps.markdown}}" catchclick="onContentClick"`,
    note: 'chat-content 透传 markdownProps（→ 流式光标）',
  },
];

let hit = 0;
for (const base of TARGETS) {
  if (patchFile(path.join(ROOT, base, FILE), RULES)) hit += 1;
}

if (hit === 0) {
  console.log('[chat-streaming] 全部幂等或无命中。');
}
console.log('[chat-streaming] 完成。产物校验应能在 dist/.../chat-message.wxml 里 grep 到 markdownProps。');
