import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './officialMarkdown.generated.css';

/**
 * 「开场白」Markdown 预览：让后台看到的排版 = 小程序真机的排版。
 *
 * 背景：小程序侧开场白已经改走 TDesign 官方 `t-chat-markdown`（真机是
 * marked 的 Lexer + chat-markdown-node.wxml 的 wx:elif 分发表 + 官方 wxss）。
 * 官方组件是 WXML，React 后台跑不了，所以这里**按同一张分发表**把
 * react-markdown 的标准标签映射成官方那套 class，再套官方 wxss（由
 * scripts/gen-official-markdown-style.mjs 生成、作用域 .official-md）。
 *
 * 两处必须与真机对齐的细节（不对齐预览就在骗人）：
 *  1. **单行回车**：真机 options 传的是 `breaks: false`，软换行以 `\n` 留在
 *     text 节点里，微信 `<text>` 会正常折行；而 HTML 会把 `\n` 折叠成空格。
 *     所以这里主动把文本里的 `\n` 换成 `<br>`，否则预览显示「挤成一段」、
 *     真机却是分行。
 *  2. 官方 wxss 里**没有** `.t-chat-markdown-br` / `-space` 规则，所以不要在
 *     预览里给这两个节点加样式 —— 真机上它们就是 0 高度、看不见。
 */

/** 官方节点的 class 前缀（与真机一致，便于对着 DOM 排查） */
const P = 't-chat-markdown';

/**
 * 「扁平」上下文：真机上列表项 / 引用块 / 表格单元格里的内容**没有段落这一层** ——
 * marked 给这些容器的 tokens 是 `text`，不是 `paragraph`；而 remark（react-markdown）
 * 会把松散列表项的内容包进 `<p>`。不抹掉这一层，预览会凭空多出 `.t-chat-markdown-p`
 * 的上下外边距，列表行距看起来比真机大一倍。
 */
const FlatContext = React.createContext(false);

/** 把字符串子节点里的 \n 换成 <br>，模拟微信 <text> 的折行行为 */
function withBreaks(children) {
  const out = [];
  let seq = 0;
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string' && child.includes('\n')) {
      child.split('\n').forEach((part, index) => {
        if (index) out.push(<br key={`br-${seq++}`} />);
        if (part) out.push(part);
      });
      return;
    }
    out.push(child);
  });
  return out;
}

/**
 * 块级容器：承接 children 并做折行处理。
 * ⚠️ `className` 必须从 rest 里摘出来单独合并 —— react-markdown 会给代码块的
 * `<code>` 塞 `language-xx`，如果让 `{...rest}` 排在 className 之后，它会把
 * 我们写的官方 class 整个覆盖掉（样式凭空消失，且很难查）。
 */
function block(cls, Tag = 'div') {
  return function Block({ children, node, className, ...rest }) {
    void node;
    return <Tag className={`${cls}${className ? ` ${className}` : ''}`} {...rest}>{withBreaks(children)}</Tag>;
  };
}

/** 行内容器（官方都是 `<view class="…-xx …-inline">`） */
function inline(cls) {
  return function Inline({ children, node, className, ...rest }) {
    void node;
    return <span className={`${cls} ${P}-inline${className ? ` ${className}` : ''}`} {...rest}>{withBreaks(children)}</span>;
  };
}

/** 容器型块：把内部切成「扁平」模式（真机这些容器里没有 -p 层） */
function flatBlock(cls) {
  const Base = block(cls);
  return function FlatBlock(props) {
    return (
      <Base {...props}>
        <FlatContext.Provider value={true}>{props.children}</FlatContext.Provider>
      </Base>
    );
  };
}

/** 代码块里的纯文本（react-markdown 给的是 <code> 元素，把它的 children 抽出来） */
function extractText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && node.props) return extractText(node.props.children);
  return '';
}

const alignOf = (node) => (node && node.properties && node.properties.align) || 'left';

const COMPONENTS = {
  h1: block(`${P}-h ${P}-h1`),
  h2: block(`${P}-h ${P}-h2`),
  h3: block(`${P}-h ${P}-h3`),
  h4: block(`${P}-h ${P}-h4`),
  h5: block(`${P}-h ${P}-h5`),
  h6: block(`${P}-h ${P}-h6`),
  // ⚠️ 函数名不能叫 `P` —— 模块级 `const P = 't-chat-markdown'` 会被函数声明遮蔽，
  // 于是模板里的 `${P}-p` 插值出的是**函数源码本身**，class 变成
  // `function P2({children,…}){…}-p`（样式全丢，且 DOM 上看一眼才反应过来）。
  p: function Paragraph({ children, node, className, ...rest }) {
    void node;
    const flat = React.useContext(FlatContext);
    // 容器内（li / blockquote / th / td）真机没有 -p 这一层，直接吐文本
    if (flat) return <>{withBreaks(children)}</>;
    return <div className={`${P}-p${className ? ` ${className}` : ''}`} {...rest}>{withBreaks(children)}</div>;
  },

  strong: inline(`${P}-strong`),
  em: inline(`${P}-em`),
  del: inline(`${P}-del`),
  // 官方 link 节点在真机 DOM 里**不带 href**（点击靠 triggerEvent 抛 node 给业务），
  // 预览里也保持一致：渲染成 span，不生成可点的 <a>，否则会让人误以为后台预览能点。
  a: function Anchor({ children, node, href, title, className, ...rest }) {
    void node; void href; void title;
    return <span className={`${P}-link ${P}-inline${className ? ` ${className}` : ''}`} {...rest}>{withBreaks(children)}</span>;
  },

  // 官方把列表整体也是 view 包 view，`__decimal` 表示有序
  ul: block(`${P}-list`),
  ol: block(`${P}-list ${P}-list__decimal`),
  li: flatBlock(`${P}-list-item`),

  blockquote: flatBlock(`${P}-blockquote`),
  hr: () => <div className={`${P}-hr`} />,

  // 行内代码：官方 codespan
  code: inline(`${P}-codespan`),

  // 代码块：官方结构是 header(lang) + content(text)
  // 这里把 <pre> 吃掉，直接从它的 <code> 子元素里取语言与正文
  pre: function Code({ children }) {
    const first = React.Children.toArray(children)[0];
    const className = (first && first.props && first.props.className) || '';
    const lang = (/language-([\w-]+)/.exec(className) || [])[1] || '';
    const text = extractText(first);
    return (
      <div className={`${P}-code`}>
        {lang ? <div className={`${P}-code__header`}><span className={`${P}-code__lang`}>{lang}</span></div> : null}
        <div className={`${P}-code__content`}><span className={`${P}-code__text`}>{text}</span></div>
      </div>
    );
  },

  img: function Img({ src, alt }) {
    return <div className={`${P}-image`}><img src={src} alt={alt || ''} /></div>;
  },

  table: function Table({ children }) {
    return <div className={`${P}-table`}><div className={`${P}-table__container`}>{children}</div></div>;
  },
  thead: block(`${P}-table__thead`),
  tbody: block(`${P}-table__tbody`),
  tr: block(`${P}-table__tr`),
  th: function Th({ children, node, style, className, ...rest }) {
    return (
      <div className={`${P}-table__th${className ? ` ${className}` : ''}`} style={{ textAlign: alignOf(node), ...style }} {...rest}>
        <FlatContext.Provider value={true}>{withBreaks(children)}</FlatContext.Provider>
      </div>
    );
  },
  td: function Td({ children, node, style, className, ...rest }) {
    return (
      <div className={`${P}-table__td${className ? ` ${className}` : ''}`} style={{ textAlign: alignOf(node), ...style }} {...rest}>
        <FlatContext.Provider value={true}>{withBreaks(children)}</FlatContext.Provider>
      </div>
    );
  },
};

/** 官方 chat-markdown 的等价渲染（GitHub 风格：表格 / 删除线） */
export function OfficialMarkdown({ value, className = '' }) {
  const source = String(value || '');
  if (!source.trim()) return null;
  return (
    <div className={`${P} official-md ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{source}</ReactMarkdown>
    </div>
  );
}

export default OfficialMarkdown;
