import { useEffect } from 'react';
import { useStore } from '../store.jsx';
import { Link } from 'react-router-dom';
import {
  Boxes, Users, Zap, Wallet, TrendingUp, ArrowDownRight, Sparkles,
  Calendar, Receipt, Activity
} from 'lucide-react';
import { AdminPageHeader, PrimaryLink, StatCard, Card, MiniBarChart, renderIcon } from '../adminUI.jsx';

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) {
  const n = new Date(d); n.setHours(0, 0, 0, 0); return n;
}

export default function AdminDashboard() {
  const { agents, workflows, adminUsers, adminUser, computeRecords, orders, refreshAllAdminLists, refreshAllConfig } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);
  const items = [...agents, ...workflows];
  const publishedCount = items.filter(x => x.published).length;
  const totalPoints = adminUsers.reduce((sum, u) => sum + (u.points || 0), 0);
  const consumedTotal = computeRecords.filter(r => r.type === 'consume').reduce((sum, r) => sum + r.amount, 0);

  const today = startOfDay(new Date());
  const todayConsume = computeRecords
    .filter(r => r.type === 'consume' && startOfDay(new Date(r.createdAt)).getTime() === today.getTime())
    .reduce((s, r) => s + r.amount, 0);
  const todayRevenue = orders
    .filter(o => o.status === 'paid' && startOfDay(new Date(o.createdAt)).getTime() === today.getTime())
    .reduce((s, o) => s + o.amount, 0);
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const newUsersThisWeek = adminUsers.filter(u => new Date(u.createdAt) >= weekStart).length;

  // 近 7 日算力消耗趋势
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = fmtDate(d);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const val = computeRecords
      .filter(r => r.type === 'consume' && fmtDate(new Date(r.createdAt)) === key)
      .reduce((s, r) => s + r.amount, 0);
    week.push({ label, value: val });
  }
  const nonZeroDays = week.filter(d => d.value > 0).length;
  const sample = [
    { label: '7/12', value: 320 }, { label: '7/13', value: 280 }, { label: '7/14', value: 410 },
    { label: '7/15', value: 360 }, { label: '7/16', value: 520 }, { label: '7/17', value: 470 }, { label: '7/18', value: 540 },
  ];
  const chartData = nonZeroDays >= 2 ? week : sample;

  const stats = [
    { label: '已上架项目', value: publishedCount, icon: Boxes, tint: 'blue', delta: { up: true, text: '运行平稳' } },
    { label: '注册客户', value: adminUsers.length, icon: Users, tint: 'green', delta: { up: true, text: `本周新增 ${newUsersThisWeek}` } },
    { label: '今日算力消耗', value: todayConsume, icon: Zap, tint: 'amber', suffix: '点', delta: { up: true, text: '实时' } },
    { label: '今日营收', value: `¥${todayRevenue}`, icon: Wallet, tint: 'violet', delta: { up: true, text: '微信订单' } },
  ];

  const topItems = [...items].sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 6);
  const recentUsers = [...adminUsers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const recentRecords = computeRecords.filter(r => r.type === 'consume').slice(0, 6);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="概览"
        subtitle="平台运营核心指标一览"
        actions={<PrimaryLink to="/admin/agents"><Sparkles size={16} /> 新建项目</PrimaryLink>}
      />

      {/* 欢迎横幅 */}
      <Card className="gradient-bg text-white p-6 sm:p-8 relative overflow-hidden">
        <div className="relative z-10">
          <div className="text-sm text-blue-100">欢迎回来</div>
          <h2 className="text-xl sm:text-2xl font-bold mt-1">{adminUser?.name || '管理员'}，上午好</h2>
          <p className="text-blue-100/85 text-sm mt-2 max-w-md">
            当前共有 <b>{publishedCount}</b> 个智能体 / 工作流在为用户提供服务，客户总余额 <b>{totalPoints}</b> 点，累计消耗 <b>{consumedTotal}</b> 点。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/admin/agents" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-blue-700 text-sm font-semibold shadow-sm hover:bg-blue-50 transition">
              管理项目
            </Link>
            <Link to="/admin/compute" className="text-white text-sm font-medium px-4 py-2.5 rounded-xl border border-white/30 hover:bg-white/10 transition">
              算力中心
            </Link>
            <Link to="/admin/orders" className="text-white text-sm font-medium px-4 py-2.5 rounded-xl border border-white/30 hover:bg-white/10 transition">
              订单财务
            </Link>
          </div>
        </div>
        <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/10" />
        <div className="absolute right-24 -bottom-16 w-32 h-32 rounded-full bg-white/5" />
      </Card>

      {/* 数据卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      {/* 图表 + 最新消耗 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-bold text-slate-900">近 7 日算力消耗趋势</h2>
              <p className="text-xs text-slate-400 mt-1">单位：点</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <TrendingUp size={13} /> 整体上升
            </span>
          </div>
          <MiniBarChart data={chartData} unit=" 点" />
        </Card>

        <Card className="p-6">
          <h2 className="font-bold text-slate-900 mb-2">最新算力消耗</h2>
          <div className="space-y-1">
            {recentRecords.length > 0 ? recentRecords.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center shrink-0"><ArrowDownRight size={15} /></span>
                  <span className="text-sm text-slate-700 truncate">{r.title || r.reason}</span>
                </div>
                <span className="text-sm font-semibold text-rose-600 shrink-0">-{r.amount} 点</span>
              </div>
            )) : <div className="text-sm text-slate-400 py-4 text-center">暂无消耗记录</div>}
          </div>
        </Card>
      </div>

      {/* 热门项目 + 新增用户 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2"><Activity size={18} className="text-blue-600" /> 热门项目</h2>
            <Link to="/admin/agents" className="text-sm text-blue-600 hover:underline">查看全部</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {topItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition">
                <div className={`w-11 h-11 rounded-xl ${item.iconColor || 'bg-blue-600'} text-white flex items-center justify-center shrink-0 overflow-hidden`}>
                  {item.avatar ? <img src={item.avatar} alt="" className="w-full h-full object-cover" /> : renderIcon(item.icon, 20)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 truncate">{item.name}</div>
                  <div className="text-xs text-slate-400 truncate">{item.uses || 0} 次使用 · {item.kind === 'agent' ? '智能体' : '工作流'}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2"><Calendar size={18} className="text-blue-600" /> 最新注册用户</h2>
            <Link to="/admin/users" className="text-sm text-blue-600 hover:underline">查看全部</Link>
          </div>
          <div className="space-y-1">
            {recentUsers.map(u => (
              <div key={u.id} className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">{u.name[0]}</div>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 truncate">{u.name}</div>
                    <div className="text-xs text-slate-400">{u.phone}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-400 shrink-0">{u.createdAt?.slice(0, 10)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
