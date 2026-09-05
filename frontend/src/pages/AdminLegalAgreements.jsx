import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useStore } from '../store.jsx';
import { AdminPageHeader, Card, PrimaryButton } from '../adminUI.jsx';

const EMPTY = {
  privacy: { title: '隐私政策', content: '' },
  terms: { title: '服务条款', content: '' },
};

export default function AdminLegalAgreements() {
  const { legalAgreements, saveLegalAgreements, refreshAllConfig } = useStore();
  const [active, setActive] = useState('privacy');
  const [draft, setDraft] = useState(() => legalAgreements || EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => { refreshAllConfig(); }, [refreshAllConfig]);
  useEffect(() => {
    setDraft({
      privacy: { ...EMPTY.privacy, ...((legalAgreements && legalAgreements.privacy) || {}) },
      terms: { ...EMPTY.terms, ...((legalAgreements && legalAgreements.terms) || {}) },
    });
  }, [legalAgreements]);

  const current = draft[active];
  const updateCurrent = (patch) => {
    setDraft(prev => ({ ...prev, [active]: { ...prev[active], ...patch } }));
    setMessage(null);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await saveLegalAgreements(draft);
    setBusy(false);
    setMessage(result.ok
      ? { ok: true, text: '配置已保存并同步到前端。' }
      : { ok: false, text: result.msg || '保存失败，请重试。' });
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="政策协议"
        subtitle="配置站点的隐私政策和服务条款，保存后前端页脚弹窗立即使用服务器最新内容。"
      />
      <Card className="p-5 md:p-7">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 max-w-md mb-5">
          {[
            ['privacy', '隐私政策'],
            ['terms', '服务条款'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setActive(key); setMessage(null); }}
              className={`py-2 rounded-lg text-sm font-medium transition ${active === key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">协议标题</label>
            <input
              value={current.title}
              onChange={e => updateCurrent({ title: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">协议内容（Markdown）</label>
            <textarea
              value={current.content}
              onChange={e => updateCurrent({ content: e.target.value })}
              rows={20}
              className="w-full px-3 py-3 border border-slate-300 rounded-xl text-sm leading-6 font-mono focus:outline-none focus:border-blue-500 resize-y"
              placeholder={`# ${current.title}\n\n请输入协议正文...`}
            />
            <p className="text-xs text-slate-400 mt-2">支持 Markdown 标题、列表、链接和加粗格式。</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <PrimaryButton onClick={save} disabled={busy}>
              <Save size={16} /> {busy ? '保存中…' : '保存配置'}
            </PrimaryButton>
            {message && <span className={`text-sm ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
