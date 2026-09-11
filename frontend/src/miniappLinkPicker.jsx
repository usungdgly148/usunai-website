import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * 小程序布局的「点击链接」选择器。
 *
 * 设计要点：
 *  1. 存的是**对象**（{kind, id|path|key|url}），不再让人手敲 `/pages/xxx`。
 *     老配置里的裸字符串照样能读能显示（normalizeLink 会认出来），保存时按对象重写，
 *     所以「不迁移数据」也能平滑过渡。
 *  2. 目标下架/未选择时**当场标红**。以前是配了一个已下架的智能体，后台毫无提示、
 *     小程序里点了没反应 —— 这正是要消灭的「配了没反应」。
 *  3. 「小程序页面」只能从服务端下发的白名单里挑（服务端保存时还会再校验一次）。
 */

const FIELD = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';

export const LINK_KINDS = [
  ['none', '不跳转（沿用页面默认行为）'],
  ['agent', '智能体'],
  ['workflow', '工作流'],
  ['page', '小程序页面'],
  ['category', '分类'],
  ['external', '外部链接'],
];

export const categoryRef = (category) => String(category?.key || category?.id || '');
export const isAllCategory = (category) => categoryRef(category) === 'all' || String(category?.name || '').trim() === '全部';

const pathnameOf = (path) => String(path || '').split('?')[0];

/** 把任意历史值收敛成对象形态，供下拉回显。识别不了的一律当「不跳转」。 */
export function normalizeLink(value) {
  if (!value) return { kind: 'none' };
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return { kind: 'none' };
    if (/^https:\/\//i.test(raw)) return { kind: 'external', url: raw };
    if (raw.startsWith('/pages/')) return { kind: 'page', path: raw };
    return { kind: 'none' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'none' };
  const kind = String(value.kind || 'none');
  if (kind === 'agent' || kind === 'workflow') return { kind, id: String(value.id || '') };
  if (kind === 'page') return { kind, path: String(value.path || '') };
  if (kind === 'category') return { kind, key: String(value.key || '') };
  if (kind === 'external') return { kind, url: String(value.url || '') };
  return { kind: 'none' };
}

export default function LinkPicker({ label = '点击链接', hint = '', value, onChange, content, pages = [], compact = false }) {
  const form = useMemo(() => normalizeLink(value), [value]);
  const choices = useMemo(() => ({
    agent: (content?.agents || []).map((item) => [String(item.id || ''), String(item.name || item.id || '')]),
    workflow: (content?.workflows || []).map((item) => [String(item.id || ''), String(item.name || item.id || '')]),
    category: (content?.categories || []).filter((item) => !isAllCategory(item))
      .map((item) => [categoryRef(item), String(item.label || item.name || categoryRef(item))]),
  }), [content]);

  const pagePaths = useMemo(() => new Set((pages || []).map((item) => String(item.path || ''))), [pages]);
  const pageChoices = useMemo(() => {
    const list = (pages || []).map((item) => ({ path: String(item.path || ''), label: String(item.label || item.path || '') }));
    // 历史值里的页面（带 query、或已从白名单移除）也要能显示出来，不能被静默清空
    if (form.kind === 'page' && form.path && !list.some((item) => item.path === form.path)) {
      list.unshift({ path: form.path, label: `历史值：${form.path}` });
    }
    return list;
  }, [pages, form.kind, form.path]);

  const emit = (next) => onChange(next.kind === 'none' ? '' : next);

  let warning = '';
  if (form.kind === 'agent' || form.kind === 'workflow') {
    if (!form.id) warning = '还没选具体目标';
    else if (!choices[form.kind].some(([id]) => id === form.id)) warning = '链接目标已下架';
  } else if (form.kind === 'page') {
    if (form.path && !pagePaths.has(pathnameOf(form.path))) warning = '不是已注册页面，保存会被拒';
  } else if (form.kind === 'category') {
    if (!form.key) warning = '还没选分类';
    else if (!choices.category.some(([key]) => key === form.key)) warning = '分类已删除';
  } else if (form.kind === 'external' && form.url && !/^https:\/\//i.test(form.url)) {
    warning = '只允许 https://';
  }

  let summary = hint || '点击后不跳转，沿用页面默认行为';
  if (form.kind === 'agent') summary = `点击后打开智能体「${choices.agent.find(([id]) => id === form.id)?.[1] || '未选择'}」`;
  else if (form.kind === 'workflow') summary = `点击后打开工作流「${choices.workflow.find(([id]) => id === form.id)?.[1] || '未选择'}」`;
  else if (form.kind === 'page') summary = `点击后打开小程序页面 ${form.path || '（未选择）'}`;
  else if (form.kind === 'category') summary = `点击后进入「${choices.category.find(([key]) => key === form.key)?.[1] || '未选择'}」分类列表`;
  else if (form.kind === 'external') summary = '点击后在小程序内置浏览器打开该网址';

  return <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {warning && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600"><AlertTriangle size={12} />{warning}</span>}
    </div>

    <select value={form.kind} onChange={(event) => {
      const kind = event.target.value;
      if (kind === 'agent' || kind === 'workflow') emit({ kind, id: '' });
      else if (kind === 'page') emit({ kind, path: '' });
      else if (kind === 'category') emit({ kind, key: '' });
      else if (kind === 'external') emit({ kind, url: '' });
      else emit({ kind: 'none' });
    }} className={FIELD}>
      {LINK_KINDS.map(([kind, text]) => <option key={kind} value={kind}>{text}</option>)}
    </select>

    {(form.kind === 'agent' || form.kind === 'workflow') && <select
      value={form.id}
      onChange={(event) => emit({ kind: form.kind, id: event.target.value })}
      className={FIELD}>
      <option value="">请选择{form.kind === 'agent' ? '智能体' : '工作流'}</option>
      {choices[form.kind].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      {form.id && !choices[form.kind].some(([id]) => id === form.id) && <option value={form.id}>已下架：{form.id}</option>}
    </select>}

    {form.kind === 'page' && <select
      value={form.path}
      onChange={(event) => emit({ kind: 'page', path: event.target.value })}
      className={FIELD}>
      <option value="">请选择小程序页面</option>
      {pageChoices.map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}
    </select>}

    {form.kind === 'category' && <select
      value={form.key}
      onChange={(event) => emit({ kind: 'category', key: event.target.value })}
      className={FIELD}>
      <option value="">请选择分类</option>
      {choices.category.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      {form.key && !choices.category.some(([key]) => key === form.key) && <option value={form.key}>已删除：{form.key}</option>}
    </select>}

    {form.kind === 'external' && <input value={form.url} onChange={(event) => emit({ kind: 'external', url: event.target.value })} placeholder="https://..." className={FIELD} />}

    <p className={`text-xs ${warning ? 'text-rose-500' : 'text-slate-400'}`}>{summary}</p>
  </div>;
}
