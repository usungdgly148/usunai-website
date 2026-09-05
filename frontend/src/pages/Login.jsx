import React, { useState } from 'react';
import { useApp } from '../store';
import { Button, Input, Field, Card } from '../components';

export default function Login({ onGo }) {
  const { login } = useApp();
  const [role, setRole] = useState('customer');
  const [contact, setContact] = useState('');
  const [pwd, setPwd] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (role === 'admin') {
      login('admin', 'admin');
      onGo({ name: 'admin' });
      return;
    }
    const c = contact.trim() || 'demo@coze.ai';
    login(c, 'customer');
    onGo({ name: 'home' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-900 p-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-slate-800">AI 应用中心</div>
          <div className="text-sm text-slate-400 mt-1">装修家居建材 · 智能体算力平台（原型）</div>
        </div>
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setRole('customer')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium ${
              role === 'customer' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            客户登录
          </button>
          <button
            onClick={() => setRole('admin')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium ${
              role === 'admin' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            管理员入口
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {role === 'customer' && (
            <Field label="邮箱或手机号">
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="如 138****001 或 you@mail.com" />
            </Field>
          )}
          <Field label="密码">
            <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder={role === 'admin' ? '演示环境任意密码' : '请输入密码'} />
          </Field>
          <Button className="w-full" type="submit">
            {role === 'admin' ? '进入管理后台' : '登录 / 注册'}
          </Button>
        </form>
        <p className="text-xs text-slate-400 mt-4 text-center">
          原型演示：客户首次登录自动创建账号（不赠送算力）；管理员任意密码进入。
        </p>
      </Card>
    </div>
  );
}
