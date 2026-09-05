import { useStore } from '../store.jsx';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Eye, Ban, CheckCircle, ArrowLeftRight, ChevronRight, Zap, ShoppingBag, ArrowDownRight, ArrowUpRight, Trash2, AlertTriangle, Phone, MessageCircle, Copy, Key } from 'lucide-react';
import { AdminPageHeader, AdminPagination, Card, Modal, StatusBadge, PrimaryButton, SecondaryButton } from '../adminUI.jsx';

export default function AdminUsers() {
  const { adminUsers, computeRecords, orders, rechargeUserPoints, toggleUserStatus, deleteUser, adminResetUserPassword, allAssets, history, adminUser, computePackages, refreshAdminUsersFromServer, refreshAllAssets } = useStore();
  const navigate = useNavigate();
  // 2026-08-04：SaaS 标准行为——进入「用户管理」即从服务端拉最新 adminUsers，避免列表停留在初次加载快照。
  useEffect(() => { refreshAdminUsersFromServer(); }, [refreshAdminUsersFromServer]);
  // 2026-08-05 拆表后：用户详情里的资产数改读全量 allAssets（admin 专用接口拉取）
  useEffect(() => { refreshAllAssets(); }, [refreshAllAssets]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustPackageId, setAdjustPackageId] = useState('');   // 选中的算力套餐 id（快捷选项）
  const [adjustValidDays, setAdjustValidDays] = useState(''); // 不使用套餐时的有效期天数（可选）：空=保留现有，0=永久，N=今天+N 天
  const [adjustMode, setAdjustMode] = useState('package');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetPwdTarget, setResetPwdTarget] = useState(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [resetPwdMsg, setResetPwdMsg] = useState('');

  const filtered = adminUsers.filter(u => {
    const matchSearch = u.id?.includes(search) || u.name?.includes(search) || u.phone?.includes(search) || u.email?.includes(search) || u.wechat?.includes(search);
    const matchStatus = status === 'all' || u.status === status;
    return matchSearch && matchStatus;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedUsers = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, status]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const wechatCount = adminUsers.filter(u => u.wechatOpenid || u.provider === 'wechat').length;
  const phoneCount = adminUsers.filter(u => u.provider === 'phone' || (u.phone && !u.email && !u.wechatOpenid && u.provider !== 'wechat')).length;

  const handleResetPassword = async (u) => {
    setResetPwdTarget(u);
    setResetPwdValue('');
    setResetPwdMsg('');
  };
  const doResetPassword = async () => {
    if (resetPwdValue.length < 6) { setResetPwdMsg('新密码至少 6 位'); return; }
    const r = await adminResetUserPassword(resetPwdTarget.id, resetPwdValue);
    if (r.ok) { setResetPwdMsg('密码已重置：' + resetPwdValue); setResetPwdValue(''); }
    else setResetPwdMsg(r.msg || '重置失败');
  };

  const openDetail = (u) => {
    setSelected(u);
  };

  const openAdjust = (u) => {
    setSelected(u);
    setAdjustOpen(true);
    setAdjustAmount('');
    setAdjustReason('');
    const firstPackage = computePackages.find(p => p.published !== false);
    setAdjustMode(firstPackage ? 'package' : 'manual');
    setAdjustPackageId(firstPackage?.id || '');
    setAdjustAmount(firstPackage ? String(firstPackage.points) : '');
    setAdjustValidDays('');
    setAdjustError('');
  };

  // 选中套餐时自动填入点数 + 默认备注（但仍允许管理员手动覆盖），并清空手动有效期（套餐自带）
  const handleSelectPackage = (pkgId) => {
    setAdjustPackageId(pkgId);
    const pkg = computePackages.find(p => p.id === pkgId);
    if (pkg) {
      setAdjustAmount(String(pkg.points));
      if (!adjustReason) setAdjustReason(`套餐「${pkg.name}」`);
    }
  };

  const submitAdjust = async () => {
    if (!selected) return;
    const selectedPackage = adjustMode === 'package' ? computePackages.find(p => p.id === adjustPackageId && p.published !== false) : null;
    const amt = selectedPackage ? Number(selectedPackage.points) : Number(adjustAmount);
    if (!Number.isFinite(amt) || amt === 0) { setAdjustError('请输入非 0 的调整点数'); return; }
    let packageInfo = selectedPackage || { id: '__manual__', name: adjustReason.trim() || '手动调整点数' };
    if (!selectedPackage && adjustValidDays !== '') {
      packageInfo = {
        ...packageInfo,
        validDays: Math.max(0, Number(adjustValidDays) || 0),
        validFrom: new Date().toISOString().slice(0, 10),
      };
    }
    setAdjustBusy(true);
    setAdjustError('');
    const result = await rechargeUserPoints(selected.id, amt, adminUser?.name, packageInfo);
    setAdjustBusy(false);
    if (!result.ok) { setAdjustError(result.msg || '调整失败'); return; }
    setAdjustOpen(false);
    setSelected(null);
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustPackageId('');
  };

  const userRecords = (userId) => computeRecords.filter(r => r.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const userOrders = (userId) => orders.filter(o => o.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const userAssets = (userId) => allAssets.filter(a => a.userId === userId);
  const userHistory = (userId) => history.filter(h => h.userId === userId);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteUser(deleteTarget.id, adminUser?.name);
    if (!result?.ok) return;
    setDeleteTarget(null);
    // 若正在查看该用户详情，关闭抽屉
    setSelected(prev => (prev && prev.id === deleteTarget.id ? null : prev));
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="用户管理"
        subtitle="查看前台注册用户、手动调整余额与禁用/启用账号"
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">共 <b className="text-slate-900">{adminUsers.length}</b> 位用户</span>
            <span className="text-sm text-slate-500 flex items-center gap-1"><MessageCircle size={13} className="text-green-600" /> 微信 <b className="text-slate-900">{wechatCount}</b></span>
            <span className="text-sm text-slate-500 flex items-center gap-1"><Phone size={13} className="text-blue-600" /> 手机号 <b className="text-slate-900">{phoneCount}</b></span>
          </div>
        }
      />

      {/* 筛选 */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-wrap">
        <div className="flex bg-white border border-slate-200 rounded-lg p-1">
          {['all', 'active', 'banned'].map(key => (
            <button key={key} onClick={() => setStatus(key)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition ${status === key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {key === 'all' ? '全部' : key === 'active' ? '正常' : '已禁用'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="搜索 ID / 姓名 / 手机号 / 邮箱 / 微信昵称" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      {/* 列表 */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-5 py-3 font-medium">用户 ID</th>
              <th className="text-left px-5 py-3 font-medium">用户</th>
              <th className="text-left px-5 py-3 font-medium">联系方式</th>
              <th className="text-left px-5 py-3 font-medium">来源</th>
              <th className="text-left px-5 py-3 font-medium">算力余额</th>
              <th className="text-left px-5 py-3 font-medium">状态</th>
              <th className="text-left px-5 py-3 font-medium">注册时间</th>
              <th className="text-left px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {pagedUsers.map(u => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-slate-500 select-all" title="用户ID">{u.id}</span>
                    <button onClick={() => { try { navigator.clipboard.writeText(u.id || ''); } catch {} }} className="p-1 rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600" title="复制ID">
                      <Copy size={12} />
                    </button>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    {u.avatar ? (
                      <img src={u.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 bg-slate-100" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-bold shrink-0">{u.name?.[0] || 'U'}</div>
                    )}
                    <div className="font-medium text-slate-900 truncate">{u.name}</div>
                  </div>
                </td>
                <td className="px-5 py-3 text-slate-600">
                  <div>{u.phone}</div>
                  <div className="text-xs text-slate-400">{u.email}</div>
                </td>
                <td className="px-5 py-3">
                  {u.wechatOpenid || u.provider === 'wechat' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-xs font-medium"><MessageCircle size={12} /> 微信</span>
                  ) : u.provider === 'phone' || (u.phone && !u.email && !u.wechatOpenid) ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium"><Phone size={12} /> 手机号</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">手机号/邮箱</span>
                  )}
                </td>
                <td className="px-5 py-3 font-semibold text-slate-900">{u.points || 0} 点</td>
                <td className="px-5 py-3"><StatusBadge status={u.status} /></td>
                <td className="px-5 py-3 text-slate-500 text-xs">{u.createdAt?.slice(0, 10)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openDetail(u)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="详情"><Eye size={15} /></button>
                    <button onClick={() => openAdjust(u)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="调整余额"><ArrowLeftRight size={15} /></button>
                    <button onClick={() => toggleUserStatus(u.id)} className={`p-1.5 rounded-lg hover:bg-slate-100 ${u.status === 'active' ? 'text-rose-500' : 'text-emerald-500'}`} title={u.status === 'active' ? '禁用' : '启用'}>
                      {u.status === 'active' ? <Ban size={15} /> : <CheckCircle size={15} />}
                    </button>
                    <button onClick={() => setDeleteTarget(u)} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="删除用户"><Trash2 size={15} /></button>
                    <button onClick={() => handleResetPassword(u)} className="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600" title="重置密码"><Key size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-400 text-sm">没有符合条件的用户</td></tr>
            )}
          </tbody>
        </table>
        <AdminPagination page={page} total={filtered.length} pageSize={pageSize} onPageChange={setPage} />
      </Card>

      {/* 详情抽屉 */}
      <Modal open={!!selected && !adjustOpen} onClose={() => setSelected(null)} title="用户详情"
        footer={
          <>
            <SecondaryButton onClick={() => setSelected(null)}>关闭</SecondaryButton>
            <PrimaryButton onClick={() => { setSelected(null); setAdjustOpen(false); navigate('/admin/compute'); }}>去算力中心</PrimaryButton>
          </>
        }
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              {selected.avatar ? (
                <img src={selected.avatar} alt="" className="w-16 h-16 rounded-full object-cover shrink-0 bg-slate-100" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-2xl font-bold shrink-0">{selected.name?.[0] || 'U'}</div>
              )}
              <div>
                <div className="text-lg font-bold text-slate-900">{selected.name}</div>
                <div className="text-sm text-slate-500 flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1"><User size={14} /> {selected.phone}</span>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500 mb-1">当前余额</div>
                <div className="text-2xl font-bold text-slate-900">{selected.points || 0} <span className="text-sm font-normal text-slate-400">点</span></div>
              </div>
              <div className="p-4 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500 mb-1">累计消耗</div>
                <div className="text-2xl font-bold text-slate-900">
                  {userRecords(selected.id).filter(r => r.type === 'consume').reduce((s, r) => s + r.amount, 0)}
                  <span className="text-sm font-normal text-slate-400"> 点</span>
                </div>
              </div>
            </div>

            {selected.wechatOpenid && (
              <div className="p-4 rounded-xl bg-green-50 border border-green-100 flex items-center gap-4">
                {selected.wechatAvatar ? (
                  <img src={selected.wechatAvatar} alt={selected.wechat} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center"><MessageCircle size={22} /></div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{selected.wechat}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-600 text-white text-xs font-medium"><MessageCircle size={11} /> 已绑定微信</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono truncate">openid: {selected.wechatOpenid}</div>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-3 font-semibold text-slate-900"><ArrowDownRight size={16} className="text-rose-500" /> 最近消耗</div>
              <div className="space-y-2">
                {userRecords(selected.id).filter(r => r.type === 'consume').slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 text-sm">
                    <span className="text-slate-600 truncate">{r.title || r.reason}</span>
                    <span className="text-rose-600 font-medium">-{r.amount} 点</span>
                  </div>
                ))}
                {userRecords(selected.id).filter(r => r.type === 'consume').length === 0 && <div className="text-sm text-slate-400">暂无消耗记录</div>}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3 font-semibold text-slate-900"><ShoppingBag size={16} className="text-blue-500" /> 最近订单</div>
              <div className="space-y-2">
                {userOrders(selected.id).slice(0, 5).map(o => (
                  <div key={o.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 text-sm">
                    <span className="text-slate-600">{o.name}</span>
                    <span className={`font-medium ${o.status === 'paid' ? 'text-emerald-600' : 'text-slate-500'}`}>¥{o.amount}</span>
                  </div>
                ))}
                {userOrders(selected.id).length === 0 && <div className="text-sm text-slate-400">暂无订单</div>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 调整余额弹窗 */}
      <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="调整余额"
        footer={
          <>
            <SecondaryButton onClick={() => setAdjustOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={submitAdjust} disabled={adjustBusy}>{adjustBusy ? '提交中…' : '确认调整'}</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-50 flex items-center gap-3">
            {selected?.avatar ? (
              <img src={selected.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 bg-white" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white text-blue-600 flex items-center justify-center font-bold shrink-0">{selected?.name?.[0] || 'U'}</div>
            )}
            <div>
              <div className="font-semibold text-slate-900">{selected?.name}</div>
              <div className="text-xs text-slate-500">当前余额 {selected?.points || 0} 点</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
            <button type="button" onClick={() => setAdjustMode('package')} className={`py-2 rounded-lg text-sm font-medium transition ${adjustMode === 'package' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>算力套餐</button>
            <button type="button" onClick={() => { setAdjustMode('manual'); setAdjustPackageId(''); setAdjustAmount(''); setAdjustReason(''); }} className={`py-2 rounded-lg text-sm font-medium transition ${adjustMode === 'manual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>手动调整点数</button>
          </div>

          {adjustMode === 'package' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                算力套餐
                <span className="text-xs text-slate-400 font-normal ml-1">点数和有效期以服务器套餐配置为准</span>
              </label>
              <select
                value={adjustPackageId}
                onChange={e => handleSelectPackage(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white"
              >
                <option value="">请选择已上架套餐</option>
                {computePackages.filter(p => p.published !== false).map(pkg => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name}（{pkg.points.toLocaleString()} 点 · ¥{pkg.price}）
                  </option>
                ))}
              </select>
              {adjustPackageId && (
                <p className="mt-2 text-xs text-slate-500">
                  本次增加 {Number(computePackages.find(p => p.id === adjustPackageId)?.points || 0).toLocaleString()} 点；有效期按套餐配置计算，并与现有截止日取较晚者。
                </p>
              )}
            </div>
          )}

          {adjustMode === 'manual' && <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">调整点数（正数为充值，负数为扣减）</label>
            <div className="flex items-center gap-2">
              <input type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)}
                placeholder="如：500 或 -100"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
              <span className="text-sm text-slate-500">点</span>
            </div>
          </div>}
          {adjustMode === 'manual' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                有效期（天）<span className="text-xs text-slate-400 font-normal ml-1">（可选）</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={adjustValidDays}
                  onChange={e => setAdjustValidDays(e.target.value)}
                  placeholder="不填则保留用户现有计划（0 = 永久）"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
                <span className="text-sm text-slate-500">天</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                不填：保留该用户现有套餐有效期（与历史判定一致）；填 0：长期有效；填 N：从今天起 N 天有效。
              </p>
            </div>
          )}
          {adjustMode === 'manual' && <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">备注（可选）</label>
            <input type="text" value={adjustReason} onChange={e => setAdjustReason(e.target.value)}
              placeholder="活动赠送 / 补偿 / 测试"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
          </div>}
          {adjustError && <p className="text-sm text-rose-600">{adjustError}</p>}
          <div className="text-xs text-slate-400">
            确认后将自动生成一条算力记录（任务名 = 套餐名）+ 一条订单记录（商品名 = 套餐名），并写入操作日志。
          </div>
        </div>
      </Modal>

      {/* 删除用户确认弹窗 */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="删除用户"
        footer={
          <>
            <SecondaryButton onClick={() => setDeleteTarget(null)}>取消</SecondaryButton>
            <button onClick={confirmDelete}
              className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 transition">
              确认删除
            </button>
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-50 border border-rose-100">
              <AlertTriangle size={20} className="text-rose-500 mt-0.5 shrink-0" />
              <div className="text-sm text-rose-700">
                删除后，该用户的所有关联数据将被<b>永久清除</b>，且不可恢复。请谨慎操作。
              </div>
            </div>
            <div className="flex items-center gap-3">
              {deleteTarget.avatar ? (
                <img src={deleteTarget.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 bg-blue-50" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">{deleteTarget.name?.[0] || 'U'}</div>
              )}
              <div>
                <div className="font-semibold text-slate-900">{deleteTarget.name}</div>
                <div className="text-xs text-slate-500">{deleteTarget.phone}{deleteTarget.email ? ` · ${deleteTarget.email}` : ''}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <div className="text-2xl font-bold text-slate-900">{userRecords(deleteTarget.id).length}</div>
                <div className="text-xs text-slate-500 mt-1">算力记录</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <div className="text-2xl font-bold text-slate-900">{userOrders(deleteTarget.id).length}</div>
                <div className="text-xs text-slate-500 mt-1">订单</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <div className="text-2xl font-bold text-slate-900">{userHistory(deleteTarget.id).length}</div>
                <div className="text-xs text-slate-500 mt-1">对话历史</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <div className="text-2xl font-bold text-slate-900">{userAssets(deleteTarget.id).length}</div>
                <div className="text-xs text-slate-500 mt-1">资产库</div>
              </div>
            </div>
            <div className="text-xs text-slate-400">提示：余额、注册信息等账号本体也将一并删除。</div>
          </div>
        )}
      </Modal>

      {/* 重置密码弹窗 */}
      <Modal open={!!resetPwdTarget} onClose={() => { setResetPwdTarget(null); setResetPwdMsg(''); }} title="重置用户密码"
        footer={
          <>
            <SecondaryButton onClick={() => { setResetPwdTarget(null); setResetPwdMsg(''); }}>关闭</SecondaryButton>
            {!resetPwdMsg.startsWith('密码已重置') && (
              <button onClick={doResetPassword} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition">
                确认重置
              </button>
            )}
          </>
        }
      >
        {resetPwdTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {resetPwdTarget.avatar ? (
                <img src={resetPwdTarget.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold">{resetPwdTarget.name?.[0] || 'U'}</div>
              )}
              <div>
                <div className="font-semibold text-slate-900">{resetPwdTarget.name}</div>
                <div className="text-xs text-slate-500">{resetPwdTarget.email || resetPwdTarget.phone || resetPwdTarget.id}</div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">新密码</label>
              <input type="text" value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)}
                placeholder="至少 6 位"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1">重置后请将新密码告知用户，用户登录后建议立即修改</p>
            </div>
            {resetPwdMsg && (
              <div className={`p-3 rounded-lg text-sm ${resetPwdMsg.startsWith('密码已重置') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {resetPwdMsg}
              </div>
            )}
          </div>
        )}
      </Modal>

    </div>
  );
}
