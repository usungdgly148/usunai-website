import React, { useState } from 'react';
import { useApp } from '../store';
import { AppShell, NavItem, Card, Badge, Button, Input } from '../components';

export default function Customer({ setRoute }) {
  const { state, currentUser } = useApp();
  const me = currentUser();
  const [q, setQ] = useState('');
  const published = state.agents.filter((a) => a.published);
  const list = published.filter((a) => a.name.includes(q) || a.desc.includes(q));
  const go = (a) => setRoute({ name: a.type === 'bot' ? 'chat' : 'workflow', id: a.id });

  return (
    <AppShell
      title="工作台"
      right={
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">点数</span>
          <span className="font-semibold text-amber-600">{me?.points ?? 0}</span>
          <Button variant="outline" onClick={() => setRoute({ name: 'me' })}>
            我的
          </Button>
          <Button variant="ghost" onClick={() => setRoute({ name: 'history' })}>
            历史
          </Button>
        </div>
      }
      nav={
        <>
          <NavItem active onClick={() => setRoute({ name: 'home' })}>
            🏠 工作台
          </NavItem>
          <NavItem onClick={() => setRoute({ name: 'history' })}>🕘 对话历史</NavItem>
          <NavItem onClick={() => setRoute({ name: 'me' })}>👤 我的 / 点数</NavItem>
        </>
      }
    >
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">你好，{me?.name || '客户'} 👋</h1>
        <p className="text-sm text-slate-500 mt-1">
          当前点数余额 <b className="text-amber-600">{me?.points}</b> · 每次使用按算力扣点
        </p>
      </div>
      <Input placeholder="搜索智能体 / 工作流…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm mb-5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((a) => (
          <Card key={a.id} className="p-5 hover:shadow-md transition cursor-pointer" onClick={() => go(a)}>
            <div className="flex items-start justify-between">
              <div className="text-3xl">{a.emoji}</div>
              <Badge color={a.type === 'bot' ? 'blue' : 'green'}>{a.type === 'bot' ? '对话智能体' : '工作流'}</Badge>
            </div>
            <div className="font-semibold text-slate-800 mt-3">{a.name}</div>
            <div className="text-sm text-slate-500 mt-1 line-clamp-2">{a.desc}</div>
            <div className="text-xs text-slate-400 mt-3">
              消耗：{a.type === 'bot' ? `${a.rate} 点 / 千 token` : `${a.rate} 点 / 次`}
            </div>
          </Card>
        ))}
        {list.length === 0 && <div className="text-slate-400 col-span-full">没有匹配的结果。</div>}
      </div>
    </AppShell>
  );
}
