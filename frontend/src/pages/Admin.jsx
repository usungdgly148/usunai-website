import React from 'react';
import { useApp } from '../store';
import { AppShell, NavItem, Card, Button } from '../components';

export default function Admin({ setRoute }) {
  const { state } = useApp();
  const published = state.agents.filter((a) => a.published).length;
  const users = state.users.length;
  const totalUsed = state.transactions.filter((t) => t.delta < 0).reduce((s, t) => s - t.delta, 0);
  return (
    <AppShell
      title="管理概览"
      right={<Button variant="outline" onClick={() => setRoute({ name: 'home' })}>查看前台</Button>}
      nav={
        <>
          <NavItem active onClick={() => setRoute({ name: 'admin' })}>
            📊 概览
          </NavItem>
          <NavItem onClick={() => setRoute({ name: 'agents' })}>🤖 智能体 / 工作流</NavItem>
          <NavItem onClick={() => setRoute({ name: 'users' })}>👥 客户管理</NavItem>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="text-sm text-slate-500">已上架</div>
          <div className="text-3xl font-bold text-indigo-600">{published}</div>
          <div className="text-xs text-slate-400">共 {state.agents.length} 个</div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-slate-500">客户数</div>
          <div className="text-3xl font-bold text-slate-800">{users}</div>
        </Card>
        <Card className="p-5">
          <div className="text-sm text-slate-500">累计消耗点数</div>
          <div className="text-3xl font-bold text-amber-600">{totalUsed}</div>
        </Card>
      </div>
      <Card className="p-6">
        <div className="font-semibold text-slate-800 mb-2">总管理员操作台</div>
        <p className="text-sm text-slate-500">
          从「智能体 / 工作流」管理扣子后台所有智能体与工作流的上架与算力定价；从「客户管理」给客户增减点数。原型数据均模拟。
        </p>
        <div className="mt-4 flex gap-3">
          <Button onClick={() => setRoute({ name: 'agents' })}>去管理智能体</Button>
          <Button variant="outline" onClick={() => setRoute({ name: 'users' })}>
            去管理客户
          </Button>
        </div>
      </Card>
    </AppShell>
  );
}
