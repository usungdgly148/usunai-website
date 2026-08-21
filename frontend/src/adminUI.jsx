import { useState } from 'react';
import { Link } from 'react-router-dom';
import { tryUploadToBlob } from './blobUpload.js';
import { compressImage } from './imageCompress.js';
import {
  LayoutDashboard, Box, Tag, Users, Zap, Receipt, Settings, Sparkles, Grid3X3, Upload, FileText, X,
  Video, Radio, BookOpen, Target, Handshake, Mic, Crown, UserCircle, Lightbulb,
  Flame, Copy, MessageCircle, Search, Image, Clapperboard, ShoppingBag, Home,
  Hammer, Boxes, DoorOpen, Archive, Layers, Square, Droplets, Sofa, PenTool,
  HardHat, FileCheck, BadgeCheck, CalendarDays, LayoutTemplate, KeyRound, Megaphone,
} from 'lucide-react';

/* ============================================================
 * 后台统一设计系统 —— 品牌蓝 #2563eb
 * 卡片 / 按钮 / 表格 / 导航 全部以本文件为单一来源
 * ========================================================== */

// 左侧导航三大组（与规划文档完全一致）
export const ADMIN_NAV = [
  {
    label: '工作台',
    items: [
      { label: '概览', icon: LayoutDashboard, href: '/admin' },
    ],
  },
  {
    label: '内容管理',
    items: [
      { label: '授权中心', icon: KeyRound, href: '/admin/auth-providers' },
      { label: '知识库', icon: BookOpen, href: '/admin/knowledge-bases' },
      { label: '项目管理', icon: Box, href: '/admin/agents' },
      { label: '分类管理', icon: Tag, href: '/admin/categories' },
      { label: '推荐配置', icon: Sparkles, href: '/admin/recommend' },
      { label: '公告通知', icon: Megaphone, href: '/admin/announcements' },
      { label: '首页内容', icon: LayoutTemplate, href: '/admin/landing' },
      { label: '政策协议', icon: FileText, href: '/admin/legal-agreements' },
    ],
  },
  {
    label: '用户与运营',
    items: [
      { label: '用户管理', icon: Users, href: '/admin/users' },
      { label: '资产管理', icon: Archive, href: '/admin/assets' },
      { label: '算力中心', icon: Zap, href: '/admin/compute' },
      { label: '订单财务', icon: Receipt, href: '/admin/orders' },
      { label: '系统设置', icon: Settings, href: '/admin/settings' },
    ],
  },
];

// 根据当前路径反查「分组 / 页面名」，用于顶栏面包屑
export function findNavMeta(pathname) {
  for (const g of ADMIN_NAV) {
    for (const it of g.items) {
      const active = it.href === '/admin'
        ? pathname === '/admin'
        : pathname.startsWith(it.href);
      if (active) return { group: g.label, item: it.label };
    }
  }
  return { group: '工作台', item: '概览' };
}

// 页面标题区：标题 + 副标题 + 右侧操作
export function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}

// 主按钮（品牌蓝）
export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 hover:shadow-md transition active:scale-[0.98] ${className}`}
      {...props}
    >{children}</button>
  );
}

// 次按钮（白底描边）
export function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-700 text-sm font-medium border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition ${className}`}
      {...props}
    >{children}</button>
  );
}

// 主按钮（链接版）
export function PrimaryLink({ to, children, className = '' }) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-sm hover:bg-blue-700 hover:shadow-md transition active:scale-[0.98] ${className}`}
    >{children}</Link>
  );
}

// 基础卡片
export function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
      {...props}
    >{children}</div>
  );
}

export function AdminPagination({ page, total, pageSize = 10, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50/40 text-sm">
      <span className="text-slate-500">共 {total} 条，当前 {start}-{end} 条</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={current <= 1} onClick={() => onPageChange(current - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">上一页</button>
        <span className="min-w-20 text-center text-slate-600">第 {current} / {totalPages} 页</span>
        <button type="button" disabled={current >= totalPages} onClick={() => onPageChange(current + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">下一页</button>
      </div>
    </div>
  );
}

// 数据指标卡
export function StatCard({ label, value, icon: Icon, tint = 'blue', delta, suffix }) {
  const tints = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <Card className="p-5 hover:shadow-soft transition">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-500">{label}</div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">
            {value}
            {suffix && <span className="text-base font-semibold text-slate-400 ml-1">{suffix}</span>}
          </div>
          {delta && (
            <div className={`mt-1.5 text-xs font-medium ${delta.up ? 'text-emerald-600' : 'text-rose-600'}`}>
              {delta.up ? '↑' : '↓'} {delta.text}
            </div>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tints[tint]}`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );
}

// 轻量柱状图（SVG-free，纯 div 实现，hover 高亮）
export function MiniBarChart({ data, unit = '' }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-2 sm:gap-3 h-44">
      {data.map((d, i) => {
        const pct = Math.max(5, Math.round((d.value / max) * 100));
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-2 h-full group">
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{d.value}{unit}</span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-lg bg-gradient-to-t from-blue-500 to-blue-400 group-hover:from-blue-600 group-hover:to-blue-500 transition-all duration-300"
                style={{ height: `${pct}%` }}
                title={`${d.label}: ${d.value}${unit}`}
              />
            </div>
            <span className="text-[11px] text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// 占位页（功能建设中）
export function AdminPlaceholder({ title, desc, icon: Icon = Sparkles, phase }) {
  return (
    <div className="space-y-6">
      <AdminPageHeader title={title} subtitle={desc} />
      <Card className="p-16 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-50 text-slate-300 flex items-center justify-center mb-4">
          <Icon size={28} />
        </div>
        <h3 className="text-lg font-semibold text-slate-700">功能建设中</h3>
        <p className="text-sm text-slate-400 mt-1.5 max-w-sm">{desc}</p>
        {phase && (
          <span className="mt-5 text-xs text-slate-400 px-3 py-1 rounded-full bg-slate-50 border border-slate-100">
            阶段 {phase} 上线
          </span>
        )}
      </Card>
    </div>
  );
}

// 开关组件（分类的 侧栏/标签/首页/上架 四态使用）
export function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-200'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// 字段徽章（用于表格内标签化展示）
export function FieldBadge({ children, active = true, onClick }) {
  const base = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition';
  const cls = active
    ? 'bg-blue-50 text-blue-600'
    : 'bg-slate-100 text-slate-400';
  if (onClick) {
    return <button onClick={onClick} className={`${base} ${cls} hover:opacity-80`}>{children}</button>;
  }
  return <span className={`${base} ${cls}`}>{children}</span>;
}

/* ============================================================
 * 30 个内置自媒体相关图标池（支持本地上传 + 内置选择）
 * ========================================================== */
export const ICON_POOL = [
  { name: 'Video', label: '短视频', Icon: Video },
  { name: 'Radio', label: '直播', Icon: Radio },
  { name: 'BookOpen', label: '小红书', Icon: BookOpen },
  { name: 'Users', label: '朋友圈', Icon: Users },
  { name: 'FileText', label: '文案', Icon: FileText },
  { name: 'Target', label: '获客', Icon: Target },
  { name: 'Handshake', label: '成交', Icon: Handshake },
  { name: 'Mic', label: '口播', Icon: Mic },
  { name: 'Crown', label: 'IP', Icon: Crown },
  { name: 'UserCircle', label: '人设', Icon: UserCircle },
  { name: 'Lightbulb', label: '选题', Icon: Lightbulb },
  { name: 'Flame', label: '爆款', Icon: Flame },
  { name: 'Copy', label: '复刻', Icon: Copy },
  { name: 'MessageCircle', label: '私域', Icon: MessageCircle },
  { name: 'Search', label: 'GEO', Icon: Search },
  { name: 'Image', label: 'AI生图', Icon: Image },
  { name: 'Clapperboard', label: 'AI生视频', Icon: Clapperboard },
  { name: 'ShoppingBag', label: '电商', Icon: ShoppingBag },
  { name: 'Home', label: '家居', Icon: Home },
  { name: 'Hammer', label: '装修', Icon: Hammer },
  { name: 'Boxes', label: '建材', Icon: Boxes },
  { name: 'DoorOpen', label: '门窗', Icon: DoorOpen },
  { name: 'Archive', label: '橱柜', Icon: Archive },
  { name: 'Layers', label: '地板', Icon: Layers },
  { name: 'Square', label: '瓷砖', Icon: Square },
  { name: 'Droplets', label: '卫浴', Icon: Droplets },
  { name: 'Sofa', label: '软装', Icon: Sofa },
  { name: 'PenTool', label: '设计', Icon: PenTool },
  { name: 'HardHat', label: '施工', Icon: HardHat },
  { name: 'FileCheck', label: '案例', Icon: FileCheck },
  { name: 'BadgeCheck', label: '品牌', Icon: BadgeCheck },
  { name: 'CalendarDays', label: '活动', Icon: CalendarDays },
];

// 根据图标名渲染（找不到回退 Grid3X3）
export function renderIcon(name, size = 18, className = '') {
  const found = ICON_POOL.find(i => i.name === name);
  const Icon = found ? found.Icon : Grid3X3;
  return <Icon size={size} className={className} />;
}

// 图标选择器：上传图标 + 30 内置图标
export function AdminIconPicker({ icon, avatar, onIconChange, onAvatarChange, color = 'bg-blue-600' }) {
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blobUrl = await tryUploadToBlob(file, { admin: true });
      if (blobUrl) { onAvatarChange(blobUrl); return; }
    } catch (err) { /* fallthrough to base64 */ }
    const reader = new FileReader();
    reader.onload = () => onAvatarChange(reader.result);
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-2xl ${color} text-white flex items-center justify-center shadow-sm overflow-hidden`}>
          {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : renderIcon(icon, 28)}
        </div>
        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
            <Upload size={14} /> 上传图标
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
          {avatar && (
            <button type="button" onClick={() => onAvatarChange('')} className="block text-xs text-slate-400 hover:text-slate-600">清除图标</button>
          )}
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500 mb-2">或选择内置图标（点击应用）</div>
        <div className="grid grid-cols-8 gap-1.5">
          {ICON_POOL.map(it => (
            <button
              key={it.name}
              type="button"
              title={it.label}
              onClick={() => { onIconChange(it.name); onAvatarChange(''); }}
              className={`aspect-square rounded-xl flex items-center justify-center border transition ${icon === it.name && !avatar ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              <it.Icon size={18} />
            </button>
          )          )}
        </div>
      </div>
    </div>
  );
}

// 智能体 / 工作流共用的新手教程配置。仅保存图片地址、跳转地址和标题。
export function TutorialSettings({ image, url, title, onChange }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      let processed = file;
      try { processed = await compressImage(file); } catch { /* 压缩失败时保留原图 */ }
      let nextImage = await tryUploadToBlob(processed, { admin: true });
      if (!nextImage) {
        nextImage = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(processed);
        });
      }
      onChange({ tutorialImage: nextImage || '' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-sm font-medium text-slate-700">新手教程链接图</div>
      <div className="aspect-[21/9] overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white">
        {image ? (
          <img src={image} alt="教程链接图预览" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">建议尺寸 1400 × 600（21:9）</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          <Upload size={14} /> {uploading ? '上传中…' : '上传图片'}
          <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleFile} />
        </label>
        {image && <button type="button" onClick={() => onChange({ tutorialImage: '' })} className="text-xs text-slate-400 hover:text-rose-500">清除图片</button>}
      </div>
      <input value={title || ''} onChange={e => onChange({ tutorialTitle: e.target.value })} placeholder="标题，如：3 分钟快速上手" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      <input value={url || ''} onChange={e => onChange({ tutorialUrl: e.target.value })} placeholder="跳转链接，如：https://..." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
      <p className="text-xs leading-5 text-slate-400">前台仅在图片和有效链接都已填写时显示，点击后在新窗口打开。</p>
    </div>
  );
}

// 通用弹窗
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 z-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

// 状态徽章
export function StatusBadge({ status, activeText = '正常', inactiveText = '禁用' }) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
      {status === 'active' ? activeText : inactiveText}
    </span>
  );
}
