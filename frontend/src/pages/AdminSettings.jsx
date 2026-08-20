import { useStore } from '../store.jsx';
import { useState, useRef, useEffect } from 'react';
import { Settings, Users, Shield, Building2, FileText, Clock, Pencil, Ban, CheckCircle, Plus, Trash2, Upload, X, Image as ImageIcon } from 'lucide-react';
import { AdminPageHeader, Card, Modal, PrimaryButton, SecondaryButton, StatusBadge } from '../adminUI.jsx';
import { tryUploadToBlob } from '../blobUpload.js';

const ROLE_LABEL = { super: '超级管理员', operator: '运营', customer_service: '客服' };

export default function AdminSettings() {
  const { adminAccounts, operationLogs, toggleAdminAccountStatus, addAdminAccount, updateAdminAccount, deleteAdminAccount, logo, setLogo, siteConfig, updateSiteConfig, persistAdminKey, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const [tab, setTab] = useState('account');
  const [form, setForm] = useState({ name: '', account: '', role: 'operator' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // 租户信息草稿（与 siteConfig 解耦，保存时再合并写回，避免每次按键都打服务端）
  const [tenantDraft, setTenantDraft] = useState({ name: siteConfig.name, domain: siteConfig.domain, icp: siteConfig.icp });
  const [tenantDirty, setTenantDirty] = useState(false);
  const [seoDraft, setSeoDraft] = useState({ slogan: siteConfig.slogan });
  const [seoDirty, setSeoDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 水合完成前 / 服务端数据回来后，自动用最新 siteConfig 刷新草稿（仅当用户未在本页改动，避免覆盖未保存编辑）
  useEffect(() => {
    if (!tenantDirty) setTenantDraft({ name: siteConfig.name, domain: siteConfig.domain, icp: siteConfig.icp });
  }, [siteConfig, tenantDirty]);
  useEffect(() => {
    if (!seoDirty) setSeoDraft({ slogan: siteConfig.slogan });
  }, [siteConfig, seoDirty]);
  const logofileRef = useRef(null);

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { window.alert('请上传图片文件'); return; }
    try {
      const blobUrl = await tryUploadToBlob(file);
      if (blobUrl) { setLogo(blobUrl); persistAdminKey('logo', blobUrl); return; }
    } catch (err) { /* fallthrough to base64 */ }
    const reader = new FileReader();
    reader.onload = () => { const data = reader.result; setLogo(data); persistAdminKey('logo', data); };
    reader.readAsDataURL(file);
  };

  const openAdd = () => { setEditing(null); setForm({ name: '', account: '', role: 'operator' }); setModalOpen(true); };
  const openEdit = (acc) => { setEditing(acc); setForm({ name: acc.name, account: acc.account, role: acc.role }); setModalOpen(true); };
  const submit = () => {
    if (!form.name || !form.account) return;
    if (editing) updateAdminAccount(editing.id, form);
    else addAdminAccount(form);
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="系统设置"
        subtitle="管理员账号、角色权限、租户信息与操作日志"
      />

      {/* Tab */}
      <div className="flex bg-white border border-slate-200 rounded-lg p-1 w-fit">
        {[
          { key: 'account', label: '管理员账号', icon: Users },
          { key: 'tenant', label: '租户信息', icon: Building2 },
          { key: 'seo', label: '前台 SEO', icon: FileText },
          { key: 'logs', label: '操作日志', icon: Clock },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">管理员账号</h2>
            <PrimaryButton onClick={openAdd} className="gap-1"><Plus size={16} /> 新增账号</PrimaryButton>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-5 py-3 font-medium">账号</th>
                <th className="text-left px-5 py-3 font-medium">姓名</th>
                <th className="text-left px-5 py-3 font-medium">角色</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">最近登录</th>
                <th className="text-left px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {adminAccounts.map(acc => (
                <tr key={acc.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{acc.account}</td>
                  <td className="px-5 py-3 text-slate-600">{acc.name}</td>
                  <td className="px-5 py-3"><span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{ROLE_LABEL[acc.role]}</span></td>
                  <td className="px-5 py-3"><StatusBadge status={acc.status} /></td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{acc.lastLoginAt ? acc.lastLoginAt.slice(0, 16).replace('T', ' ') : '从未登录'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(acc)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600"><Pencil size={15} /></button>
                      <button onClick={() => toggleAdminAccountStatus(acc.id)} className={`p-1.5 rounded-lg hover:bg-slate-100 ${acc.status === 'active' ? 'text-rose-500' : 'text-emerald-500'}`} title={acc.status === 'active' ? '禁用' : '启用'}>
                        {acc.status === 'active' ? <Ban size={15} /> : <CheckCircle size={15} />}
                      </button>
                      <button onClick={() => { if (window.confirm(`删除账号「${acc.name}」？`)) deleteAdminAccount(acc.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'tenant' && (
        <Card className="p-6 max-w-2xl">
          <h2 className="font-bold text-slate-900 mb-5 flex items-center gap-2"><Building2 size={18} className="text-blue-600" /> 租户信息</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">网站名称</label>
              <input type="text" value={tenantDraft.name} onChange={e => { setTenantDraft({ ...tenantDraft, name: e.target.value }); setTenantDirty(true); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">租户标识</label>
              <input type="text" value={tenantDraft.domain} onChange={e => { setTenantDraft({ ...tenantDraft, domain: e.target.value }); setTenantDirty(true); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">备案信息</label>
              <input type="text" value={tenantDraft.icp} onChange={e => { setTenantDraft({ ...tenantDraft, icp: e.target.value }); setTenantDirty(true); }} placeholder="如：浙ICP备12345678号" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div className="pt-2 flex items-center gap-3">
              <PrimaryButton
                disabled={saving || !tenantDirty}
                onClick={async () => {
                  setSaving(true);
                  const r = await updateSiteConfig({ name: tenantDraft.name, domain: tenantDraft.domain, icp: tenantDraft.icp });
                  setTenantDirty(false);
                  setSaving(false);
                  if (r && r.ok === false) window.alert('保存失败：' + (r.msg || '请重试'));
                }}
              >{saving ? '保存中…' : '保存设置'}</PrimaryButton>
              {tenantDirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
            </div>
          </div>
        </Card>
      )}

      {tab === 'seo' && (
        <Card className="p-6 max-w-2xl">
          <h2 className="font-bold text-slate-900 mb-5 flex items-center gap-2"><FileText size={18} className="text-blue-600" /> 前台 SEO / 品牌</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">网站标语</label>
              <p className="text-xs text-slate-400 mb-2">显示在浏览器标题与品牌区，例如「AI 智能体平台 · 让获客更简单」</p>
              <input type="text" value={seoDraft.slogan} onChange={e => { setSeoDraft({ slogan: e.target.value }); setSeoDirty(true); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">品牌 Logo</label>
              <p className="text-xs text-slate-400 mb-2">上传后将替换前台侧边栏和底部的品牌图标，支持 JPG / PNG / GIF。留空则使用默认图标。</p>
              <input ref={logofileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              <div className="flex gap-3 items-start">
                <button
                  type="button"
                  onClick={() => logofileRef.current?.click()}
                  className={`relative w-32 h-32 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition overflow-hidden ${logo ? 'border-blue-300 bg-blue-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
                >
                  {logo ? (
                    <>
                      <img src={logo} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition flex items-center justify-center rounded-2xl">
                        <span className="text-white text-xs font-medium flex items-center gap-1"><Upload size={14} /> 更换</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500"><Upload size={16} /></div>
                      <span className="text-xs text-slate-500">点击上传</span>
                    </>
                  )}
                </button>
                {logo && (
                  <button type="button" onClick={() => { setLogo(null); persistAdminKey('logo', null); }}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="恢复默认 Logo">
                    <X size={18} />
                  </button>
                )}
              </div>
            </div>
            <div className="pt-2 flex items-center gap-3">
              <PrimaryButton
                disabled={saving || !seoDirty}
                onClick={async () => {
                  setSaving(true);
                  const r = await updateSiteConfig({ slogan: seoDraft.slogan });
                  setSeoDirty(false);
                  setSaving(false);
                  if (r && r.ok === false) window.alert('保存失败：' + (r.msg || '请重试'));
                }}
              >{saving ? '保存中…' : '保存配置'}</PrimaryButton>
              {seoDirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
            </div>
          </div>
        </Card>
      )}

      {tab === 'logs' && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-slate-100 font-bold text-slate-900">操作日志</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-5 py-3 font-medium">时间</th>
                <th className="text-left px-5 py-3 font-medium">操作人</th>
                <th className="text-left px-5 py-3 font-medium">操作</th>
                <th className="text-left px-5 py-3 font-medium">对象</th>
              </tr>
            </thead>
            <tbody>
              {operationLogs.map(log => (
                <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-500 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-900 font-medium">{log.adminName}</td>
                  <td className="px-5 py-3 text-slate-600">{log.action}</td>
                  <td className="px-5 py-3 text-slate-600">{log.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '编辑管理员' : '新增管理员'}
        footer={
          <>
            <SecondaryButton onClick={() => setModalOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={submit}>保存</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">姓名</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">登录账号</label>
            <input type="text" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">角色</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white">
              <option value="super">超级管理员</option>
              <option value="operator">运营</option>
              <option value="customer_service">客服</option>
            </select>
          </div>
          <div className="text-xs text-slate-400">初始密码默认为 123456，首次登录后需强制修改。</div>
        </div>
      </Modal>
    </div>
  );
}
