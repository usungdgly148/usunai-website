import { useMemo, useRef, useState } from 'react';
import {
  Bold, Braces, ChevronDown, Code, ImagePlus, Italic, Link2,
  List, ListOrdered, Loader2, Maximize2, Minimize2, Strikethrough,
} from 'lucide-react';
import { tryUploadToBlob } from '../blobUpload.js';
import { OfficialMarkdown } from '../officialMarkdown.jsx';

/**
 * 开场白 Markdown 编辑器（照 Coze「开场白文案」的形态做）。
 *
 * 为什么是「工具栏 + Markdown 源码 + 实时预览」而不是所见即所得：
 *   开场白的最终消费者是小程序的**官方 `t-chat-markdown`**，它吃的是 Markdown 源码。
 *   所见即所得编辑器里那份 HTML 终究要反序列化成 Markdown，来回转换是这个功能最容易
 *   出 bug 的地方（嵌套列表、代码块、表格的往返几乎必错）。
 *   所以编辑面就是 Markdown 本身，右侧/下方用官方样式做等价预览 ——
 *   运营看到的就是真机排版，改的也是真机吃的那份源码，中间没有翻译层。
 *
 * 与真机对齐的两个约定（改这里前先看 miniapp/src/pages/chat/index.tsx 的注释）：
 *   · options 用 `breaks:false`：单行回车靠 `<text>` 的 `\n` 折行，所以预览也把 `\n` 当换行；
 *   · 硬换行（行尾两个空格）在真机是**看不见**的（官方没有 `.t-chat-markdown-br` 规则），
 *     别用它排版，用空行分段。
 */

const STYLE_OPTIONS = [
  { key: 'p', label: '正文', prefix: '' },
  { key: 'h1', label: '标题 1', prefix: '# ' },
  { key: 'h2', label: '标题 2', prefix: '## ' },
  { key: 'h3', label: '标题 3', prefix: '### ' },
];

/** 行首的 Markdown 标记（标题 / 列表），用于「切换」而不是无脑叠加 */
const LINE_MARKER = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function ToolButton({ title, onClick, active, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`shrink-0 rounded-md p-1.5 transition-colors ${
        active ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className='mx-1 h-4 w-px shrink-0 bg-slate-200' />;

export default function OpeningEditor({ value = '', onChange, placeholder = '输入正文', maxLength = 1000 }) {
  const areaRef = useRef(null);
  /** 图片 file input：放在最前面声明，pickImage 里要用（避免读在声明前） */
  const fileElRef = useRef(null);
  /** 工具栏点击会先把焦点从 textarea 拿走，selectionStart 就读不到了 → 自己盯住选区 */
  const selRef = useRef({ start: 0, end: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');

  const remember = () => {
    const el = areaRef.current;
    if (!el) return;
    selRef.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  };

  /** 用 text 替换 [start, end)，并把光标/选区设到指定位置（rAF 等受控值回流后再设） */
  const replaceRange = (start, end, text, nextStart, nextEnd) => {
    onChange(value.slice(0, start) + text + value.slice(end));
    const caret = nextStart ?? start + text.length;
    const caretEnd = nextEnd ?? caret;
    selRef.current = { start: caret, end: caretEnd };
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caretEnd);
    });
  };

  /** 当前选区所在行的 [start, end) */
  const currentLineRange = () => {
    const { start, end } = selRef.current;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    return { lineStart, lineEnd, line: value.slice(lineStart, lineEnd) };
  };

  /** 行内包裹：**x** / *x* / ~~x~~ / `x` */
  const wrapInline = (marker) => {
    const { start, end } = selRef.current;
    const picked = value.slice(start, end) || '文字';
    const text = `${marker}${picked}${marker}`;
    replaceRange(start, end, text, start + marker.length, start + marker.length + picked.length);
  };

  /** 逐行加/去前缀（列表）：全部行都已有该标记时视为「再点一次取消」 */
  const prefixLines = (markerOf, removeRe) => {
    const { lineStart, lineEnd, line } = currentLineRange();
    const lines = line.split('\n');
    const filled = lines.filter((item) => item.trim());
    const already = filled.length > 0 && filled.every((item) => removeRe.test(item));
    let seq = 0;
    const next = lines
      .map((item) => {
        const clean = item.replace(LINE_MARKER, '');
        if (already) return clean;
        if (!item.trim()) return item;
        const text = `${markerOf(seq)}${clean}`;
        seq += 1;
        return text;
      })
      .join('\n');
    replaceRange(lineStart, lineEnd, next, lineStart, lineStart + next.length);
  };

  /** 标题：替换当前行的标题级别（不叠加） */
  const applyHeading = (prefix) => {
    const { lineStart, lineEnd, line } = currentLineRange();
    const next = prefix + line.replace(/^\s*#{1,6}\s+/, '');
    replaceRange(lineStart, lineEnd, next, lineStart + next.length, lineStart + next.length);
    setMenuOpen(false);
  };

  /**
   * 链接：把选区当锚文本，插入后**选中 `url` 占位符**，
   * 用户直接打字就替换掉，不用再弹一个输入框去问（少一步、也不会被弹窗打断）。
   */
  const insertLink = () => {
    const { start, end } = selRef.current;
    const label = value.slice(start, end).trim() || '链接文字';
    const text = `[${label}](url)`;
    const urlAt = start + label.length + 3;
    replaceRange(start, end, text, urlAt, urlAt + 3);
  };

  const insertText = (text) => {
    const { start, end } = selRef.current;
    replaceRange(start, end, text, start + text.length, start + text.length);
  };

  const pickImage = async (file) => {
    if (!file) return;
    setUploading(true);
    setNotice('');
    try {
      let url = await tryUploadToBlob(file, { admin: true });
      if (!url) {
        url = await fileToDataUrl(file);
        setNotice('图片存储未配置，已内联为 base64（正文会变长，建议后续接入对象存储）');
      }
      const alt = String(file.name || '图片').replace(/\.[^.]+$/, '') || '图片';
      insertText(`![${alt}](${url})`);
    } catch (error) {
      setNotice(error?.message || '图片上传失败');
    } finally {
      setUploading(false);
      if (fileElRef.current) fileElRef.current.value = '';
    }
  };

  const length = String(value || '').length;
  const over = length > maxLength;

  const styleLabel = useMemo(() => {
    const { line } = currentLineRange();
    const depth = (/^\s*(#{1,6})\s+/.exec(line) || [])[1]?.length || 0;
    return (STYLE_OPTIONS.find((item) => item.key === (depth ? `h${Math.min(depth, 3)}` : 'p')) || STYLE_OPTIONS[0]).label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const toolbar = (
    <>
      <div className='relative shrink-0'>
        <button
          type='button'
          title={`段落样式（当前：${styleLabel}）`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setMenuOpen((open) => !open)}
          className='flex items-center gap-1 rounded-md px-1.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100'
        >
          <span className='text-[15px] font-semibold leading-none'>A</span>
          <span className='text-[11px] text-slate-500'>{styleLabel}</span>
          <ChevronDown size={12} className='text-slate-400' />
        </button>
        {menuOpen && (
          <>
            <div className='fixed inset-0 z-10' onClick={() => setMenuOpen(false)} />
            <div className='absolute left-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg'>
              {STYLE_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyHeading(item.prefix)}
                  className='block w-full px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Divider />
      <ToolButton title='加粗 **文字**' onClick={() => wrapInline('**')}><Bold size={15} /></ToolButton>
      <ToolButton title='斜体 *文字*' onClick={() => wrapInline('*')}><Italic size={15} /></ToolButton>
      <ToolButton title='删除线 ~~文字~~' onClick={() => wrapInline('~~')}><Strikethrough size={15} /></ToolButton>

      <Divider />
      <ToolButton title='无序列表' onClick={() => prefixLines(() => '- ', /^\s*[-*+]\s+/)}><List size={15} /></ToolButton>
      <ToolButton title='有序列表' onClick={() => prefixLines((n) => `${n + 1}. `, /^\s*\d+[.)]\s+/)}><ListOrdered size={15} /></ToolButton>

      <Divider />
      <ToolButton title='行内代码 `代码`' onClick={() => wrapInline('`')}><Code size={15} /></ToolButton>
      <ToolButton title='代码块 ```' onClick={() => {
        const { start, end } = selRef.current;
        const picked = value.slice(start, end) || '代码';
        const text = `\`\`\`\n${picked}\n\`\`\``;
        replaceRange(start, end, text, text.length + start, text.length + start);
      }}><Braces size={15} /></ToolButton>

      <Divider />
      <ToolButton title='插入链接' onClick={insertLink}><Link2 size={15} /></ToolButton>
      <ToolButton title={uploading ? '图片上传中…' : '上传并插入图片'} disabled={uploading} onClick={() => fileElRef.current?.click()}>
        {uploading ? <Loader2 size={15} className='animate-spin' /> : <ImagePlus size={15} />}
      </ToolButton>

      <input
        ref={fileElRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={(event) => void pickImage(event.target.files?.[0])}
      />
    </>
  );

  const area = (heightCls) => (
    <textarea
      ref={areaRef}
      value={value}
      placeholder={placeholder}
      onSelect={remember}
      onBlur={remember}
      onKeyUp={remember}
      onClick={remember}
      onChange={(event) => { onChange(event.target.value); remember(); }}
      className={`w-full resize-none bg-transparent px-3 py-3 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 ${heightCls}`}
    />
  );

  const footer = (
    <div className='flex items-center justify-between gap-3 px-3 pb-2 pt-1'>
      <span className='min-w-0 truncate text-[11px] text-slate-400'>
        支持 Markdown：标题 / 加粗 / 斜体 / 删除线 / 列表 / 代码 / 链接 / 图片
      </span>
      <div className='flex shrink-0 items-center gap-2'>
        <span className={`text-[11px] tabular-nums ${over ? 'font-medium text-rose-500' : 'text-slate-400'}`}>
          {length}/{maxLength}
        </span>
        <button
          type='button'
          title={full ? '退出全屏' : '全屏编辑'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setFull((open) => !open)}
          className='rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        >
          {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );

  const box = (heightCls) => (
    <div className='overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-blue-400'>
      <div className='flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1'>{toolbar}</div>
      {area(heightCls)}
      {footer}
    </div>
  );

  if (full) {
    return (
      <>
        <div className='flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500'>
          <span>开场白 · 全屏编辑（{length}/{maxLength}）</span>
          <button type='button' onClick={() => setFull(false)} className='rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700' title='退出全屏'>
            <Minimize2 size={14} />
          </button>
        </div>
        <div className='fixed inset-0 z-[60] flex flex-col bg-slate-50'>
          <div className='flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3'>
            <div>
              <div className='text-sm font-semibold text-slate-900'>开场白文案 · 全屏编辑</div>
              <div className='mt-0.5 text-[11px] text-slate-400'>左侧写 Markdown，右侧是官方 chat-markdown 的等价预览</div>
            </div>
            <button type='button' onClick={() => setFull(false)} className='inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'>
              <Minimize2 size={13} /> 退出全屏
            </button>
          </div>
          <div className='grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-2'>
            <div className='flex min-h-0 flex-col'>{box('h-full min-h-[50vh] flex-1')}</div>
            <div className='min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-4'>
              <div className='mb-2 text-[11px] text-slate-400'>真机效果（官方 chat-markdown）</div>
              <Preview value={value} />
            </div>
          </div>
        </div>
        {notice ? <p className='text-[11px] text-amber-600'>{notice}</p> : null}
      </>
    );
  }

  return (
    <div className='space-y-2'>
      {box('h-40')}
      {notice ? <p className='text-[11px] text-amber-600'>{notice}</p> : null}
      <details className='rounded-xl border border-slate-200 bg-white' open>
        <summary className='cursor-pointer px-3 py-2 text-xs text-slate-500'>真机效果预览（官方 chat-markdown）</summary>
        <div className='border-t border-slate-100 p-3'>
          <Preview value={value} />
        </div>
      </details>
    </div>
  );
}

/** 预览：空内容时给一句占位，避免运营以为功能坏了 */
function Preview({ value }) {
  if (!String(value || '').trim()) {
    return <p className='text-xs text-slate-300'>（未设置开场白 —— 小程序里不会出现开场白区块）</p>;
  }
  return <OfficialMarkdown value={value} />;
}
