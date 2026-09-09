/**
 * postbuild-chat-selectable.js
 *
 * 让 TDesign t-chat-message 渲染的 markdown 文本支持长按选择/复制。
 *
 * 背景：微信小程序里只有 <text selectable> 组件内的文字才支持长按选择，
 * 而 tdesign-miniprogram 的 chat-markdown-node 把所有文本叶子都渲染成
 * <view>{{插值}}</view> —— view 内文本天然不可选，导致 AI 生成结果和
 * 历史记录内容都无法长按选中复制。
 *
 * 本脚本把两类文本叶子包上 <text selectable>（行内组件，不改布局/样式）：
 *   1. chat-markdown-node.wxml —— 普通段落/加粗/斜体/删除线/行内代码等文本叶子
 *   2. chat-markdown-code.wxml —— 代码块正文 <text> 加 selectable 属性
 *
 * 落点（双写）：
 *   - node_modules 源（下次 taro build 拷贝进 dist 时即为正确产物）
 *   - dist/miniprogram_npm 产物（本次构建立即生效，无需重新 build）
 *
 * 幂等：newString 已存在则跳过，可重复执行。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REL = (p) => path.relative(ROOT, p);

const TARGETS = [
  // node_modules 源
  'node_modules/tdesign-miniprogram/miniprogram_dist/chat-markdown',
  // dist 构建产物
  'dist/miniprogram_npm/tdesign-miniprogram/chat-markdown',
];

const NODE_FILE = 'chat-markdown-node/chat-markdown-node.wxml';
const CODE_FILE = 'chat-markdown-code/chat-markdown-code.wxml';

/**
 * 对文件做一组「精确子串 → 替换」；每项若 new 已存在则跳过（幂等）。
 * @param {string} filePath
 * @param {Array<{old:string, next:string, note:string}>} rules
 */
function patchFile(filePath, rules) {
  if (!fs.existsSync(filePath)) {
    console.log(`[chat-selectable] 跳过（不存在）: ${REL(filePath)}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = 0;
  for (const { old, next, note } of rules) {
    if (content.includes(next)) {
      console.log(`[chat-selectable] 幂等跳过: ${note}`);
      continue;
    }
    if (!content.includes(old)) {
      console.warn(`[chat-selectable] 未命中（可能已手动改过）: ${note}`);
      continue;
    }
    content = content.split(old).join(next);
    changed += 1;
  }
  if (changed > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[chat-selectable] 已更新 ${changed} 条规则: ${REL(filePath)}`);
  } else {
    console.log(`[chat-selectable] 无变更: ${REL(filePath)}`);
  }
}

/** 规则：chat-markdown-node.wxml 文本叶子包 <text selectable> */
function nodeRules() {
  return [
    {
      // type='text' 叶子：有子 tokens 时递归，否则渲染 raw（streaming 光标紧随其后）
      old: `<block wx:else>{{''+item.raw+''}}<tail-component`,
      next: `<block wx:else><text selectable>{{''+item.raw+''}}</text><tail-component`,
      note: 'text 叶子(raw)',
    },
    {
      // strong / em / del 叶子（三处同构：view > block wx:else > 文本）
      old: `<block wx:else>{{''+item.text+''}}</block>`,
      next: `<block wx:else><text selectable>{{''+item.text+''}}</text></block>`,
      note: 'strong/em/del 叶子(text)',
    },
    {
      // list 项无子 tokens 时的文本
      old: `<block wx:else>{{''+li.text+''}}</block>`,
      next: `<block wx:else><text selectable>{{''+li.text+''}}</text></block>`,
      note: 'list 叶子(li.text)',
    },
    {
      // codespan / 兜底 raw：view 内直接文本
      old: `bindtap="nodeClick">{{''+(item.text||item.raw)+''}}</view>`,
      next: `bindtap="nodeClick"><text selectable>{{''+(item.text||item.raw)+''}}</text></view>`,
      note: 'codespan / 兜底 raw',
    },
    {
      // ref 引用：原本就是 <text>，直接补 selectable 属性
      old: `<text class="{{classPrefix}}-ref-txt">{{''+item.text+''}}</text>`,
      next: `<text class="{{classPrefix}}-ref-txt" selectable>{{''+item.text+''}}</text>`,
      note: 'ref 引用 text 补 selectable',
    },
  ];
}

/** 规则：chat-markdown-code.wxml 代码块正文 text 加 selectable */
function codeRules() {
  return [
    {
      old: `<text class="{{classPrefix}}__text" decode="{{true}}">{{node.text}}</text>`,
      next: `<text class="{{classPrefix}}__text" decode="{{true}}" selectable>{{node.text}}</text>`,
      note: '代码块正文 selectable',
    },
  ];
}

for (const base of TARGETS) {
  const basePath = path.join(ROOT, base);
  patchFile(path.join(basePath, NODE_FILE), nodeRules());
  patchFile(path.join(basePath, CODE_FILE), codeRules());
}

console.log('[chat-selectable] 完成。请在微信开发者工具重新编译验证：长按 AI 回复/历史记录文字应弹出选择菜单。');
