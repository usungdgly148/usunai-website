import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { AdminPageHeader, PrimaryButton, SecondaryButton, Card, Modal, StatusBadge } from '../adminUI.jsx';
import { Plus, Search, Pencil, Trash2, Megaphone, Eye, EyeOff, Calendar } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 更新类型 → 中文 + 徽章样式
const TYPE_META = {
  feature: { label: '新增功能', cls: 'bg-emerald-50 text-emerald-700' },
  optimize: { label: '功能优化', cls: 'bg-blue-50 text-blue-700' },
  fix: { label: '问题修复', cls: 'bg-amber-50 text-amber-700' },
  other: { label: '其他', cls: 'bg-slate-100 text-slate-600' },
};
const TYPE_OPTIONS = [
  { value: 'feature', label: '新增功能' },
  { value: 'optimize', label: '功能优化' },
  { value: 'fix', label: '问题修复' },
  { value: 'other', label: '其他' },
];

const fmtDate = (iso) => {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
};

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-500 flex items-center justify-center mb-4">
        <Megaphone size={26} />
      </div>
      <p className="text-slate-500 text-sm">还没有发布任何公告</p>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
        <Plus size={16} /> 发布第一条公告
      </button>
    </div>
  );
}

export default function AdminAnnouncements() {
  const { announcements, addAnnouncement, updateAnnouncement, deleteAnnouncement, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null=新建
  const [showPreview, setShowPreview] = useState(false);
  const [form, setForm] = useState({ version: '', type: 'feature', title: '', content: '' });

  // 列表按发布时间倒序（最新在上）
  const sorted = useMemo(
    () => [...announcements].sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0)),
    [announcements]
  );
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return sorted;
    return sorted.filter((a) => (a.version || '').toLowerCase().includes(k) || (a.title || '').toLowerCase().includes(k));
  }, [sorted, keyword]);

  const openNew = () => {
    setEditingId(null);
    setForm({ version: '', type: 'feature', title: '', content: '' });
    setShowPreview(false);
    setModalOpen(true);
  };
  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({ version: item.version || '', type: item.type || 'feature', title: item.title || '', content: item.content || '' });
    setShowPreview(false);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    const v = form.version.trim();
    const t = form.title.trim();
    if (!v) { alert('请填写版本号'); return; }
    if (!t) { alert('请填写更新标题'); return; }
    if (editingId) {
      updateAnnouncement(editingId, { version: v, type: form.type, title: t, content: form.content });
    } else {
      addAnnouncement({ version: v, type: form.type, title: t, content: form.content });
    }
    setModalOpen(false);
  };

  const handleDelete = (item) => {
    if (window.confirm(`确定删除公告「${item.version} ${item.title}」吗？此操作不可撤销。`)) {
      deleteAnnouncement(item.id);
    }
  };

  // 快捷键：Esc 关闭弹窗
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  return (
    <div className="max-w-5xl mx-auto">
      <AdminPageHeader
        title="版本更新公告"
        subtitle="向所有用户发布产品更新动态，用户可在前台右上角铃铛图标处查看。"
        actions={
          <PrimaryButton onClick={openNew}>
            <Plus size={16} /> 发布新版本
          </PrimaryButton>
        }
      />

      <Card className="p-0 overflow-hidden">
        {/* 搜索栏 */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索版本号或更新标题"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 bg-slate-50/50"
            />
          </div>
          <div className="text-xs text-slate-400 ml-auto">共 {filtered.length} 条</div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState onAdd={openNew} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50/60">
                  <th className="px-5 py-3 font-medium">版本号</th>
                  <th className="px-5 py-3 font-medium w-24">更新类型</th>
                  <th className="px-5 py-3 font-medium">更新标题</th>
                  <th className="px-5 py-3 font-medium w-40">发布时间</th>
                  <th className="px-5 py-3 font-medium w-28 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => {
                  const meta = TYPE_META[a.type] || TYPE_META.other;
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-mono text-slate-700">{a.version}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-800 max-w-xs truncate" title={a.title}>{a.title}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-1"><Calendar size={13} />{fmtDate(a.publishedAt)}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(a)} title="编辑" className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-blue-600 flex items-center justify-center">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => handleDelete(a)} title="删除" className="w-8 h-8 rounded-lg hover:bg-rose-50 text-slate-500 hover:text-rose-600 flex items-center justify-center">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 发布 / 编辑 对话框 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑公告' : '发布新版本'}
        footer={
          <>
            <SecondaryButton onClick={() => setModalOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={handleSubmit}>{editingId ? '保存修改' : '提交'}</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">版本号 <span className="text-rose-500">*</span></label>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="如 v2.3.1"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">更新类型</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
              >
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">更新标题 <span className="text-rose-500">*</span></label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="一句话说明本次更新"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs text-slate-500">更新内容（支持 Markdown，可图文）</label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                {showPreview ? <><EyeOff size={13} /> 收起预览</> : <><Eye size={13} /> 预览</>}
              </button>
            </div>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={showPreview ? 8 : 12}
              placeholder={'支持 Markdown 语法，例如：\n\n## 本次更新\n- 新增 **AI 文案生成** 功能\n- 修复已知问题\n\n![示意图](图片链接)'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-blue-500 resize-y"
            />
            {showPreview && (
              <div className="mt-3 border border-slate-200 rounded-lg px-4 py-3 bg-slate-50/50 max-h-72 overflow-y-auto">
                {form.content.trim() ? (
                  <div className="md-render text-sm text-slate-700">
                    <Markdown remarkPlugins={[remarkGfm]}>{form.content}</Markdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">暂无内容可预览</p>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
