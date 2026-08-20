import { useStore, formatPlanDate } from '../store.jsx';
import { useState, useEffect, useRef } from 'react';
import { ArrowUpRight, ArrowDownRight, Package, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, User, Check } from 'lucide-react';
import { AdminPageHeader, Card, Modal, PrimaryButton, SecondaryButton, Toggle } from '../adminUI.jsx';

export default function AdminCompute() {
  const { computeRecords, computePackages, adminUsers, addComputePackage, updateComputePackage, deleteComputePackage, togglePackagePublished, rechargeUserPoints, adminUser, rechargeInfo, setRechargeInfo, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const totalRecharge = computeRecords.filter(r => r.type === 'recharge').reduce((s, r) => s + r.amount, 0);
  const totalConsume = computeRecords.filter(r => r.type === 'consume').reduce((s, r) => s + r.amount, 0);
  const net = totalRecharge - totalConsume;
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [pkgOpen, setPkgOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState(null);
  const [pkgForm, setPkgForm] = useState({ name: '', points: '', price: '', validDays: '', validFrom: '' });
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeUserId, setRechargeUserId] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeReason, setRechargeReason] = useState('');

  // 「提示信息」显式保存：本地草稿与已落库值分离，点保存才同步
  const [infoDraft, setInfoDraft] = useState(rechargeInfo || '');
  const [infoSavedAt, setInfoSavedAt] = useState(null);
  const infoSavedTimerRef = useRef(null);
  // hydrate 后或外部 setRechargeInfo 触发的远端变更，回灌到草稿
  useEffect(() => {
    if (infoDraft === rechargeInfo) return; // 避免自己刚保存又把时间戳刷新掉
    // 远端拉到了新值，且当前没有未保存修改 → 静默同步
    setInfoDraft(rechargeInfo || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rechargeInfo]);
  const infoDirty = (infoDraft || '') !== (rechargeInfo || '');
  const saveRechargeInfo = () => {
    if (!infoDirty) return;
    setRechargeInfo(infoDraft);
    setInfoSavedAt(Date.now());
    if (infoSavedTimerRef.current) clearTimeout(infoSavedTimerRef.current);
    infoSavedTimerRef.current = setTimeout(() => setInfoSavedAt(null), 2500);
  };
  useEffect(() => () => { if (infoSavedTimerRef.current) clearTimeout(infoSavedTimerRef.current); }, []);

  const filteredRecords = computeRecords.filter(r => {
    const matchSearch = r.title?.includes(search) || r.reason?.includes(search) || r.userId?.includes(search);
    const matchType = filterType === 'all' || r.type === filterType;
    return matchSearch && matchType;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openPkgAdd = () => { setEditingPkg(null); setPkgForm({ name: '', points: '', price: '', validDays: '', validFrom: '' }); setPkgOpen(true); };
  const openPkgEdit = (pkg) => { setEditingPkg(pkg); setPkgForm({ name: pkg.name, points: pkg.points, price: pkg.price, validDays: pkg.validDays ?? '', validFrom: pkg.validFrom || '' }); setPkgOpen(true); };
  const submitPkg = () => {
    const points = Number(pkgForm.points);
    const price = Number(pkgForm.price);
    if (!pkgForm.name || !points || !price) return;
    const validDays = pkgForm.validDays ? Number(pkgForm.validDays) : 0; // 0 = 永久有效
    const validFrom = pkgForm.validFrom ? pkgForm.validFrom : null;       // 留空 = 购买当天起算
    const payload = { name: pkgForm.name, points, price, validDays, validFrom };
    if (editingPkg) updateComputePackage(editingPkg.id, payload);
    else addComputePackage(payload);
    setPkgOpen(false);
  };
  // 套餐有效期文案 + 结束日期（后台展示用）
  const pkgEndDate = (from, days) => {
    const base = from ? new Date(from) : new Date();
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    return formatPlanDate(d);
  };
  const pkgValidityText = (pkg) => {
    const days = Number(pkg.validDays) || 0;
    if (days > 0 && pkg.validFrom) return `有效期至 ${pkgEndDate(pkg.validFrom, days)}`;
    if (days > 0) return `购买后 ${days} 天到期`;
    if (pkg.validFrom) return `长期有效（${pkg.validFrom} 起）`;
    return '长期有效';
  };

  const submitRecharge = () => {
    const amt = Number(rechargeAmount);
    if (!rechargeUserId || !amt) return;
    rechargeUserPoints(rechargeUserId, amt, adminUser?.name);
    setRechargeOpen(false);
    setRechargeAmount('');
    setRechargeReason('');
  };

  const Stat = ({ label, value, sub, icon: Icon, color }) => (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500">{label}</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
          <div className="text-xs text-slate-400 mt-1">{sub}</div>
        </div>
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center text-white`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="算力中心"
        subtitle="管理算力套餐、查看消耗记录与为用户手动充值"
        actions={<PrimaryButton onClick={() => setRechargeOpen(true)}><User size={16} /> 手动充值</PrimaryButton>}
      />

      {/* 概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="累计充值" value={`${totalRecharge.toLocaleString()} 点`} sub="历史总充值" icon={ArrowUpRight} color="bg-emerald-500" />
        <Stat label="累计消耗" value={`${totalConsume.toLocaleString()} 点`} sub="历史总消耗" icon={ArrowDownRight} color="bg-rose-500" />
        <Stat label="平台净算力" value={`${net.toLocaleString()} 点`} sub="充值 - 消耗" icon={Package} color="bg-blue-500" />
      </div>

      {/* 套餐管理 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-900">算力套餐</h2>
          <PrimaryButton onClick={openPkgAdd} className="gap-1"><Plus size={16} /> 新建套餐</PrimaryButton>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {computePackages.map(pkg => (
            <div key={pkg.id} className="rounded-xl border border-slate-200 p-4 hover:border-blue-300 transition">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-slate-900">{pkg.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{pkg.points.toLocaleString()} 点</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{pkgValidityText(pkg)}</div>
                </div>
                <div className="text-blue-600 font-bold">¥{pkg.price}</div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <span className={`text-xs px-2 py-0.5 rounded ${pkg.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{pkg.published ? '上架中' : '已下架'}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => openPkgEdit(pkg)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => togglePackagePublished(pkg.id)} className={`p-1.5 rounded-lg hover:bg-slate-100 ${pkg.published ? 'text-emerald-600' : 'text-slate-400'}`}>{pkg.published ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button>
                  <button onClick={() => { if (window.confirm(`删除套餐「${pkg.name}」？`)) deleteComputePackage(pkg.id); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 提示信息模块：展示在用户「算力充值」弹窗中，说明充值方式/注意事项等；显式保存后才会同步到前台 */}
        <div className="mt-6 pt-6 border-t border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-slate-900">提示信息</h3>
            <span className="text-xs text-slate-400">展示于前台「算力充值」弹窗</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">用于向前台用户说明充值方式、注意事项等。支持多行，编辑后请点击「保存」同步到前台。</p>
          <textarea
            value={infoDraft}
            onChange={e => setInfoDraft(e.target.value)}
            rows={3}
            placeholder="例如：算力仅支持人工充值，请扫码添加客服微信办理；充值后一般 5 分钟内到账。"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none resize-y transition-colors ${infoDirty ? 'border-amber-400 bg-amber-50/30 focus:border-amber-500' : 'border-slate-300 focus:border-blue-500'}`}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-slate-500 min-h-[1.25rem]">
              {infoSavedAt ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check size={14} /> 已保存，前台「算力充值」弹窗已更新
                </span>
              ) : infoDirty ? (
                <span className="text-amber-600">内容已修改，尚未保存</span>
              ) : (
                <span className="text-slate-400">无未保存修改</span>
              )}
            </div>
            <button
              type="button"
              onClick={saveRechargeInfo}
              disabled={!infoDirty}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${infoDirty ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
            >
              保存
            </button>
          </div>
        </div>
      </Card>

      {/* 消耗记录 */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="font-bold text-slate-900">算力明细</h2>
          <div className="flex items-center gap-2 flex-1 justify-end">
            <div className="flex bg-slate-50 rounded-lg p-1">
              {['all', 'recharge', 'consume'].map(key => (
                <button key={key} onClick={() => setFilterType(key)} className={`px-3 py-1 rounded text-xs font-medium transition ${filterType === key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
                  {key === 'all' ? '全部' : key === 'recharge' ? '充值' : '消耗'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索用户/说明" className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-5 py-3 font-medium">类型</th>
              <th className="text-left px-5 py-3 font-medium">用户</th>
              <th className="text-left px-5 py-3 font-medium">说明</th>
              <th className="text-left px-5 py-3 font-medium">点数</th>
              <th className="text-left px-5 py-3 font-medium">时间</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.map(r => {
              const user = adminUsers.find(u => u.id === r.userId);
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${r.type === 'consume' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {r.type === 'consume' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                      {r.type === 'consume' ? '消耗' : '充值'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{user?.name || r.userId}</td>
                  <td className="px-5 py-3 text-slate-700">{r.title || r.reason}{r.meta?.totalTokens != null ? ` · ${r.meta.totalTokens} token（估）` : ''}</td>
                  <td className={`px-5 py-3 font-semibold ${r.type === 'consume' ? 'text-rose-600' : 'text-emerald-600'}`}>{r.type === 'consume' ? '-' : '+'}{r.amount} 点</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 套餐编辑弹窗 */}
      <Modal open={pkgOpen} onClose={() => setPkgOpen(false)} title={editingPkg ? '编辑套餐' : '新建套餐'}
        footer={
          <>
            <SecondaryButton onClick={() => setPkgOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={submitPkg}>保存</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">套餐名称</label>
            <input type="text" value={pkgForm.name} onChange={e => setPkgForm({ ...pkgForm, name: e.target.value })} placeholder="如：专业版月付" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">算力点数</label>
              <input type="number" value={pkgForm.points} onChange={e => setPkgForm({ ...pkgForm, points: e.target.value })} placeholder="500" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">价格（元）</label>
              <input type="number" value={pkgForm.price} onChange={e => setPkgForm({ ...pkgForm, price: e.target.value })} placeholder="99" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">有效期（天）</label>
              <input type="number" min="0" value={pkgForm.validDays} onChange={e => setPkgForm({ ...pkgForm, validDays: e.target.value })} placeholder="0 = 永久" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">生效日期（可选）</label>
              <input type="date" value={pkgForm.validFrom} onChange={e => setPkgForm({ ...pkgForm, validFrom: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <p className="text-xs text-slate-400 -mt-1">
            {pkgForm.validDays && Number(pkgForm.validDays) > 0
              ? `结束日期：${pkgForm.validFrom || '购买当天'} 起 ${pkgForm.validDays} 天${pkgForm.validFrom ? `（至 ${pkgEndDate(pkgForm.validFrom, Number(pkgForm.validDays))}）` : ''}`
              : '留空或填 0 表示长期有效（不限定到期日）'}
          </p>
        </div>
      </Modal>

      {/* 手动充值弹窗 */}
      <Modal open={rechargeOpen} onClose={() => setRechargeOpen(false)} title="手动为用户充值"
        footer={
          <>
            <SecondaryButton onClick={() => setRechargeOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={submitRecharge}>确认充值</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">选择用户</label>
            <select value={rechargeUserId} onChange={e => setRechargeUserId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white">
              <option value="">请选择</option>
              {adminUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}（{u.phone}）— 余额 {u.points || 0} 点</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">充值点数</label>
            <input type="number" value={rechargeAmount} onChange={e => setRechargeAmount(e.target.value)} placeholder="正数" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">备注</label>
            <input type="text" value={rechargeReason} onChange={e => setRechargeReason(e.target.value)} placeholder="活动赠送 / 补偿" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
