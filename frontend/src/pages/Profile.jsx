import { useState, useRef } from 'react';
import { useStore } from '../store.jsx';
import { User, Mail, Phone, MessageCircle, Lock, Camera, LogOut, Trash2, Copy, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal, PrimaryButton, SecondaryButton } from '../adminUI.jsx';
import { WechatQrPanel } from '../components.jsx';
import { tryUploadToBlob } from '../blobUpload.js';
import { copyText } from '../clipboard.js';
import { apiFetch } from '../authFetch.js';

export default function Profile() {
  const { user, logout, updateUserProfile, changePassword, cancelAccount, registeredUsers, bindWechat, unbindWechat, bindPhone } = useStore();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [nickname, setNickname] = useState(user?.name || '');
  const [copied, setCopied] = useState(false);
  const [wechatOpen, setWechatOpen] = useState(false);

  // 绑定/更换手机号
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [bindPhoneInput, setBindPhoneInput] = useState('');
  const [bindCode, setBindCode] = useState('');
  const [bindMsg, setBindMsg] = useState('');
  const [bindSending, setBindSending] = useState(false);
  const [bindSent, setBindSent] = useState(false);
  const [bindCooldown, setBindCooldown] = useState(0);

  // 修改密码
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdErr, setPwdErr] = useState('');
  const [pwdOk, setPwdOk] = useState('');
  const hasPassword = !!user?.hasPassword;

  if (!user) return <div className="text-center text-slate-500 py-20">请先登录</div>;

  const openPwd = () => {
    setOldPwd(''); setNewPwd(''); setConfirmPwd(''); setPwdErr(''); setPwdOk('');
    setPwdOpen(true);
  };

  const submitPwd = async () => {
    setPwdErr(''); setPwdOk('');
    if (newPwd.length < 6) { setPwdErr('新密码至少 6 位'); return; }
    if (newPwd !== confirmPwd) { setPwdErr('两次输入的密码不一致'); return; }
    if (hasPassword && !oldPwd) { setPwdErr('请输入原密码'); return; }
    const res = await changePassword({ oldPassword: oldPwd, newPassword: newPwd });
    if (res.ok) {
      setPwdOk(res.msg || '密码修改成功');
      setTimeout(() => setPwdOpen(false), 1200);
    } else {
      setPwdErr(res.msg || '修改失败');
    }
  };

  const handleCancel = () => {
    if (window.confirm('确定要注销账号吗？账号及关联信息将被永久删除，且无法恢复。')) {
      cancelAccount();
      navigate('/');
    }
  };

  const handleAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blobUrl = await tryUploadToBlob(file);
      if (blobUrl) { updateUserProfile({ avatar: blobUrl }); return; }
    } catch (err) { /* fallthrough to base64 */ }
    const reader = new FileReader();
    reader.onload = () => updateUserProfile({ avatar: reader.result });
    reader.readAsDataURL(file);
  };

  const saveNickname = () => updateUserProfile({ name: nickname });

  // 绑定手机号 — 发送验证码
  const sendBindCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(bindPhoneInput)) { setBindMsg('请输入有效的手机号'); return; }
    setBindSending(true); setBindMsg('');
    try {
      const r = await apiFetch('/api/auth/phone-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: bindPhoneInput }) });
      const j = await r.json();
      if (j && j.ok) { setBindSent(true); setBindMsg('验证码已发送'); setBindCooldown(j.cooldown || 60); }
      else setBindMsg(j?.msg || '发送失败');
    } catch { setBindMsg('网络异常'); }
    finally { setBindSending(false); }
  };
  // 绑定手机号 — 提交验证
  const doBindPhone = async () => {
    if (!bindCode) { setBindMsg('请输入验证码'); return; }
    const r = await bindPhone(bindPhoneInput, bindCode);
    if (r.ok) { setBindMsg('绑定成功！'); setTimeout(() => { setPhoneOpen(false); setBindMsg(''); }, 1500); }
    else setBindMsg(r.msg || '绑定失败');
  };

  const maskPhone = (phone) => {
    if (!phone) return '';
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  };

  const copyId = async () => {
    const ok = await copyText(user.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      alert('复制失败，请手动复制');
    }
  };

  const SectionTitle = ({ title, subtitle }) => (
    <div className="mb-6">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  );

  const Row = ({ icon: Icon, label, value, placeholder, action, actionText, danger }) => (
    <div className="flex items-center justify-between py-4 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
          <Icon size={18} />
        </div>
        <div>
          <div className="text-sm font-medium text-slate-900">{label}</div>
          <div className={`text-xs mt-0.5 ${value ? 'text-slate-600' : 'text-slate-400'}`}>{value || placeholder}</div>
        </div>
      </div>
      {action && (
        <button onClick={action} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${danger ? 'border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200' : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
          {actionText}
        </button>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">个人中心</h1>
        <p className="text-slate-500 text-sm">管理您的个人资料与账号安全</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 基本信息 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <SectionTitle title="基本信息" subtitle="管理您的个人资料" />
          <div className="flex flex-col items-center mb-6">
            <div className="relative mb-3">
              <div className="w-24 h-24 rounded-full bg-orange-500 text-white flex items-center justify-center text-3xl font-bold overflow-hidden">
                {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.name?.[0] || 'U'}
              </div>
              <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition">
                <Camera size={14} />
              </button>
              <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={handleAvatar} />
            </div>
            <button onClick={() => fileRef.current?.click()} className="text-sm text-slate-600 hover:text-blue-600 font-medium">更换头像</button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">昵称</label>
              <div className="flex gap-3">
                <input value={nickname} onChange={e => setNickname(e.target.value)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" placeholder="请输入昵称" />
                <button onClick={saveNickname} className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">保存</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">用户 ID</label>
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-50 text-sm text-slate-500">
                <span className="flex-1 font-mono">{user.id}</span>
                <button onClick={copyId} className="text-slate-400 hover:text-blue-600 transition">
                  {copied ? <CheckCircle size={16} className="text-emerald-500" /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 账号安全 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <SectionTitle title="账号安全" subtitle="管理您的账号绑定与密码" />
          <div className="space-y-1">
            <Row icon={Mail} label="邮箱" value={user.email} placeholder="未绑定" />
            <Row icon={Phone} label="手机号" value={maskPhone(user.phone)} placeholder="未绑定" actionText={user.phone ? '修改' : '绑定'} action={() => { setBindPhoneInput(''); setBindCode(''); setBindMsg(''); setBindSent(false); setBindCooldown(0); setPhoneOpen(true); }} />
            <Row
              icon={MessageCircle}
              label="微信"
              value={user.wechatOpenid ? user.wechat : '功能待开放'}
              placeholder="未绑定"
              actionText={user.wechatOpenid ? '解绑' : '功能待开放'}
              action={() => user.wechatOpenid ? unbindWechat() : alert('微信登录功能待开放，敬请期待')}
            />
            <Row icon={Lock} label="登录密码" value={hasPassword ? '已设置' : '未设置'} placeholder="未设置" actionText="修改" action={openPwd} />
          </div>

          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
            <button onClick={() => { logout(); navigate('/'); }} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
              <LogOut size={16} /> 退出登录
            </button>
            <button onClick={handleCancel} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50 transition">
              <Trash2 size={16} /> 注销账号
            </button>
          </div>
        </div>
      </div>

      {/* 修改密码弹窗 */}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改登录密码"
        footer={
          <>
            <SecondaryButton onClick={() => setPwdOpen(false)}>取消</SecondaryButton>
            <PrimaryButton onClick={submitPwd}>确认修改</PrimaryButton>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">密码需至少 6 位，修改后请使用新密码登录。</p>
          {hasPassword && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">原密码</label>
              <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="请输入当前密码" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">新密码</label>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="请输入新密码（至少 6 位）" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">确认新密码</label>
            <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder="请再次输入新密码" className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition text-sm" />
          </div>
          {pwdErr && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{pwdErr}</div>}
          {pwdOk && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{pwdOk}</div>}
        </div>
      </Modal>

      {/* 绑定微信弹窗 */}
      <Modal
        open={wechatOpen}
        onClose={() => setWechatOpen(false)}
        title="绑定微信"
        footer={<SecondaryButton onClick={() => setWechatOpen(false)}>关闭</SecondaryButton>}
      >
        <WechatQrPanel
          tip="扫码将微信账号绑定到当前登录账号"
          onSuccess={(w) => { bindWechat(w); setWechatOpen(false); }}
        />
      </Modal>

      {/* 绑定/修改手机号 */}
      <Modal open={phoneOpen} onClose={() => { setPhoneOpen(false); setBindMsg(''); }} title={user.phone ? '修改手机号' : '绑定手机号'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">手机号</label>
            <input type="text" value={bindPhoneInput} onChange={e => setBindPhoneInput(e.target.value)} placeholder="输入手机号"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">验证码</label>
            <div className="flex gap-2">
              <input type="text" value={bindCode} onChange={e => setBindCode(e.target.value)} placeholder="6 位验证码" maxLength={6}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button onClick={sendBindCode} disabled={bindSending || bindCooldown > 0}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                {bindSending ? '发送中...' : bindSent ? `重新发送(${bindCooldown}s)` : '发送验证码'}
              </button>
            </div>
          </div>
          {bindMsg && (
            <div className={`p-3 rounded-lg text-sm ${bindMsg.startsWith('绑定成功') ? 'bg-emerald-50 text-emerald-700' : bindMsg === '验证码已发送' ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700'}`}>
              {bindMsg}
            </div>
          )}
          {bindSent && !bindMsg.startsWith('绑定成功') && (
            <button onClick={doBindPhone} className="w-full py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition">
              确认绑定
            </button>
          )}
        </div>
      </Modal>

    </div>
  );
}
