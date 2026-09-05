import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { Zap, BarChart3, Coins, RefreshCw, Sparkles, Target, Shield, Rocket, Plus, Trash2, RotateCcw, ShieldCheck, Users, ThumbsUp, Headphones, Lock } from 'lucide-react';
import { AdminPageHeader, PrimaryButton, SecondaryButton, Card } from '../adminUI.jsx';
import { tryUploadToBlob } from '../blobUpload.js';

const FEATURE_ICONS = [
  { name: 'Zap', Icon: Zap },
  { name: 'BarChart3', Icon: BarChart3 },
  { name: 'Coins', Icon: Coins },
  { name: 'RefreshCw', Icon: RefreshCw },
  { name: 'Sparkles', Icon: Sparkles },
  { name: 'Target', Icon: Target },
  { name: 'Shield', Icon: Shield },
  { name: 'Rocket', Icon: Rocket },
];

const BADGE_ICON_OPTIONS = [
  { name: 'ShieldCheck', Icon: ShieldCheck },
  { name: 'Users', Icon: Users },
  { name: 'ThumbsUp', Icon: ThumbsUp },
  { name: 'Headphones', Icon: Headphones },
  { name: 'Lock', Icon: Lock },
];
const BADGE_ICON_NAMES = BADGE_ICON_OPTIONS.map(o => o.name);

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500';
const textareaCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 min-h-[80px] resize-y';

// 读取本地图片并压缩为 JPEG dataURL，避免 localStorage 被撑爆
function fileToCompressedDataUrl(file, maxDim = 900, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function AdminLanding() {
  const {
    landing,
    updateLanding, updateLandingFeature, updateLandingCta,
    updateLandingFooter, updateLandingFooterColumn, updateLandingFooterLink,
    addLandingFooterLink, removeLandingFooterLink,
    updateLandingFooterLegalLink, addLandingFooterLegalLink, removeLandingFooterLegalLink,
    addLandingFooterColumn, removeLandingFooterColumn,
    resetLanding,
    customerService, updateCustomerService,
    refreshAllAdminLists, refreshAllConfig,
  } = useStore();
  useEffect(() => { refreshAllAdminLists(); refreshAllConfig(); }, [refreshAllAdminLists, refreshAllConfig]);

  const [saved, setSaved] = useState(false);

  const onSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="首页内容"
        subtitle="编辑前台首页的价值卖点、CTA 行动号召、页脚等内容。修改后实时生效。"
        actions={
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-emerald-600 font-medium">已保存</span>}
            <SecondaryButton onClick={() => { if (window.confirm('确定恢复默认？当前自定义内容将丢失。')) resetLanding(); }} className="gap-1.5"><RotateCcw size={15} /> 恢复默认</SecondaryButton>
            <PrimaryButton onClick={onSave}>保存</PrimaryButton>
          </div>
        }
      />

      {/* 价值卖点区 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-5">价值卖点区</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <Field label="标签文案" hint="如：为什么选择友尚AI">
            <input value={landing.heroTag} onChange={e => updateLanding({ heroTag: e.target.value })} className={inputCls} />
          </Field>
          <Field label="主标题">
            <input value={landing.heroTitle} onChange={e => updateLanding({ heroTitle: e.target.value })} className={inputCls} />
          </Field>
          <Field label="副标题" className="md:col-span-2">
            <textarea value={landing.heroSubtitle} onChange={e => updateLanding({ heroSubtitle: e.target.value })} className={textareaCls} />
          </Field>
        </div>

        <h3 className="text-sm font-medium text-slate-700 mb-3">卖点卡片</h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {landing.features.map((f, i) => (
            <div key={i} className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="卡片标题">
                  <input value={f.title} onChange={e => updateLandingFeature(i, { title: e.target.value })} className={inputCls} />
                </Field>
                <Field label="小标签">
                  <input value={f.label || ''} onChange={e => updateLandingFeature(i, { label: e.target.value })} className={inputCls} placeholder="如：AI 工具" />
                </Field>
                <Field label="描述" className="md:col-span-2">
                  <input value={f.desc} onChange={e => updateLandingFeature(i, { desc: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <Field label="卡片图片（本地上传或填 URL）">
                <div className="flex items-center gap-3 flex-wrap">
                  <input value={f.image || ''} onChange={e => updateLandingFeature(i, { image: e.target.value })} className={inputCls} placeholder="可粘贴图片链接，或点击右侧上传本地图片" />
                  <label className="shrink-0 cursor-pointer px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">
                    上传图片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const blobUrl = await tryUploadToBlob(file, { admin: true });
                          if (blobUrl) { updateLandingFeature(i, { image: blobUrl }); }
                          else { const dataUrl = await fileToCompressedDataUrl(file); updateLandingFeature(i, { image: dataUrl }); }
                        } catch (err) {
                          window.alert('图片读取失败，请换一张试试');
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {f.image && (
                    <button
                      type="button"
                      onClick={() => updateLandingFeature(i, { image: '' })}
                      className="shrink-0 text-xs text-slate-400 hover:text-red-500 transition"
                    >
                      清除
                    </button>
                  )}
                  {f.image && (
                    <div className="w-16 h-10 rounded-lg border border-slate-200 overflow-hidden bg-slate-100 shrink-0">
                      <img src={f.image} alt="preview" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="链接文案">
                  <input value={f.linkText || ''} onChange={e => updateLandingFeature(i, { linkText: e.target.value })} className={inputCls} placeholder="如：了解更多 →" />
                </Field>
                <Field label="链接地址">
                  <input value={f.linkHref || ''} onChange={e => updateLandingFeature(i, { linkHref: e.target.value })} className={inputCls} placeholder="如：/agents" />
                </Field>
              </div>
              <Field label="备用图标（无图片时显示）">
                <div className="flex flex-wrap gap-2">
                  {FEATURE_ICONS.map(({ name, Icon }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => updateLandingFeature(i, { icon: name })}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center border ${f.icon === name ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                      title={name}
                    >
                      <Icon size={18} />
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ))}
        </div>
      </Card>

      {/* CTA 行动号召区 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-5">CTA 行动号召区</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="标题">
            <input value={landing.cta.title} onChange={e => updateLandingCta({ title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="副标题">
            <input value={landing.cta.subtitle} onChange={e => updateLandingCta({ subtitle: e.target.value })} className={inputCls} />
          </Field>
          <Field label="主按钮文案">
            <input value={landing.cta.primaryText} onChange={e => updateLandingCta({ primaryText: e.target.value })} className={inputCls} />
          </Field>
          <Field label="主按钮链接">
            <input value={landing.cta.primaryLink} onChange={e => updateLandingCta({ primaryLink: e.target.value })} className={inputCls} />
          </Field>
          <Field label="次按钮文案">
            <input value={landing.cta.secondaryText} onChange={e => updateLandingCta({ secondaryText: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </Card>

      {/* 信任数据条（社会证明）：主标题 + 副标题 + 数字 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-1">信任数据条</h2>
        <p className="text-xs text-slate-400 mb-5">首页首屏 Banner 下方的社会证明数字：「主标题 + 副标题 + 数字」，数字进入视口时滚动计数。</p>
        <div className="space-y-3 mb-5">
          <input value={landing.statsTitle || ''} onChange={e => updateLanding({ statsTitle: e.target.value })} className={inputCls} placeholder="主标题，如 AI智能创作引擎" />
          <textarea value={landing.statsSubtitle || ''} onChange={e => updateLanding({ statsSubtitle: e.target.value })} className={textareaCls} placeholder="副标题，如 内置多场景文案、图片、视频智能体和工作流…" />
        </div>
        <div className="space-y-3">
          {(landing.stats || []).map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <input value={s.value} onChange={e => updateLanding({ stats: (landing.stats || []).map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} className={inputCls} placeholder="数字，如 40+ / 20w+" />
              <input value={s.label} onChange={e => updateLanding({ stats: (landing.stats || []).map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} className={inputCls} placeholder="标签，如 智能体 / 使用次数" />
              <button onClick={() => updateLanding({ stats: (landing.stats || []).filter((_, j) => j !== i) })} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
            </div>
          ))}
          <button onClick={() => updateLanding({ stats: [...(landing.stats || []), { value: '', label: '' }] })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加数据</button>
        </div>
      </Card>

      {/* 客户成功案例 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-1">客户成功案例</h2>
        <p className="text-xs text-slate-400 mb-5">以「品牌 / 成效 / 标签 / 描述」呈现真实获客结果。</p>
        <div className="space-y-4">
          {(landing.cases || []).map((c, i) => (
            <div key={i} className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">案例 {i + 1}</span>
                <button onClick={() => updateLanding({ cases: (landing.cases || []).filter((_, j) => j !== i) })} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={c.brand} onChange={e => updateLanding({ cases: (landing.cases || []).map((x, j) => j === i ? { ...x, brand: e.target.value } : x) })} className={inputCls} placeholder="品牌 / 客户，如 佛山瓷砖批发 · 李总" />
                <input value={c.metric} onChange={e => updateLanding({ cases: (landing.cases || []).map((x, j) => j === i ? { ...x, metric: e.target.value } : x) })} className={inputCls} placeholder="成效，如 到店咨询 +300%" />
                <input value={c.tag} onChange={e => updateLanding({ cases: (landing.cases || []).map((x, j) => j === i ? { ...x, tag: e.target.value } : x) })} className={inputCls} placeholder="标签，如 瓷砖 / 建材" />
              </div>
              <textarea value={c.desc} onChange={e => updateLanding({ cases: (landing.cases || []).map((x, j) => j === i ? { ...x, desc: e.target.value } : x) })} className={textareaCls} placeholder="案例描述" />
            </div>
          ))}
          <button onClick={() => updateLanding({ cases: [...(landing.cases || []), { brand: '', metric: '', tag: '', desc: '' }] })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加案例</button>
        </div>
      </Card>

      {/* 信任背书 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-1">信任背书图标条</h2>
        <p className="text-xs text-slate-400 mb-5">CTA 上方的资质 / 服务保障图标条，强化转化前信任。</p>
        <div className="space-y-3">
          {(landing.badges || []).map((b, i) => (
            <div key={i} className="flex items-center gap-3">
              <select value={b.icon} onChange={e => updateLanding({ badges: (landing.badges || []).map((x, j) => j === i ? { ...x, icon: e.target.value } : x) })} className={inputCls + ' w-44'}>
                {BADGE_ICON_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <input value={b.text} onChange={e => updateLanding({ badges: (landing.badges || []).map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} className={inputCls} placeholder="文案，如 50+ 品牌在用" />
              <button onClick={() => updateLanding({ badges: (landing.badges || []).filter((_, j) => j !== i) })} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
            </div>
          ))}
          <button onClick={() => updateLanding({ badges: [...(landing.badges || []), { icon: 'ShieldCheck', text: '' }] })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加背书</button>
        </div>
      </Card>

      {/* 客户口碑 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-1">客户口碑评价</h2>
        <p className="text-xs text-slate-400 mb-5">CTA 之前的真实用户评价，临门一脚促转化。</p>
        <div className="space-y-4">
          {(landing.testimonials || []).map((t, i) => (
            <div key={i} className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">评价 {i + 1}</span>
                <button onClick={() => updateLanding({ testimonials: (landing.testimonials || []).filter((_, j) => j !== i) })} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
              </div>
              <textarea value={t.quote} onChange={e => updateLanding({ testimonials: (landing.testimonials || []).map((x, j) => j === i ? { ...x, quote: e.target.value } : x) })} className={textareaCls} placeholder="评价内容" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={t.author} onChange={e => updateLanding({ testimonials: (landing.testimonials || []).map((x, j) => j === i ? { ...x, author: e.target.value } : x) })} className={inputCls} placeholder="称呼，如 李总" />
                <input value={t.role} onChange={e => updateLanding({ testimonials: (landing.testimonials || []).map((x, j) => j === i ? { ...x, role: e.target.value } : x) })} className={inputCls} placeholder="身份，如 佛山瓷砖批发 · 门店老板" />
              </div>
            </div>
          ))}
          <button onClick={() => updateLanding({ testimonials: [...(landing.testimonials || []), { quote: '', author: '', role: '' }] })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加评价</button>
        </div>
      </Card>

      {/* 客服悬浮窗 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-5">客服悬浮窗</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <Field label="是否启用" className="md:col-span-2">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={customerService.enabled}
                onChange={e => updateCustomerService({ enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700">在前台右下角显示客服入口</span>
            </label>
          </Field>

          <Field label="客服二维码" className="md:col-span-2">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                value={customerService.qr || ''}
                onChange={e => updateCustomerService({ qr: e.target.value })}
                className={inputCls}
                placeholder="可粘贴图片链接，或点击右侧上传本地图片"
              />
              <label className="shrink-0 cursor-pointer px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition">
                上传二维码
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const blobUrl = await tryUploadToBlob(file, { admin: true });
                      if (blobUrl) { updateCustomerService({ qr: blobUrl }); }
                      else { const dataUrl = await fileToCompressedDataUrl(file); updateCustomerService({ qr: dataUrl }); }
                    } catch (err) {
                      window.alert('二维码读取失败，请换一张试试');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              {customerService.qr && (
                <button
                  type="button"
                  onClick={() => updateCustomerService({ qr: '' })}
                  className="shrink-0 text-xs text-slate-400 hover:text-red-500 transition"
                >
                  清除
                </button>
              )}
              {customerService.qr && (
                <div className="w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-slate-100 shrink-0">
                  <img src={customerService.qr} alt="qr" className="w-full h-full object-contain" />
                </div>
              )}
            </div>
          </Field>

          <Field label="第一行文字">
            <input
              value={customerService.lines[0] || ''}
              onChange={e => updateCustomerService({ lines: [e.target.value, customerService.lines[1] || '', customerService.lines[2] || ''] })}
              className={inputCls}
              placeholder="如：微信扫码联系客服"
            />
          </Field>
          <Field label="第二行文字">
            <input
              value={customerService.lines[1] || ''}
              onChange={e => updateCustomerService({ lines: [customerService.lines[0] || '', e.target.value, customerService.lines[2] || ''] })}
              className={inputCls}
              placeholder="如：工作日 9:00-18:00 在线"
            />
          </Field>
          <Field label="第三行文字" className="md:col-span-2">
            <input
              value={customerService.lines[2] || ''}
              onChange={e => updateCustomerService({ lines: [customerService.lines[0] || '', customerService.lines[1] || '', e.target.value] })}
              className={inputCls}
              placeholder="如：为您解答产品与使用问题"
            />
          </Field>
        </div>
      </Card>

      {/* 页脚 */}
      <Card className="p-6">
        <h2 className="font-semibold text-slate-900 mb-5">页脚</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <Field label="品牌标语">
            <input value={landing.footer.tagline} onChange={e => updateLandingFooter({ tagline: e.target.value })} className={inputCls} />
          </Field>
          <Field label="版权信息">
            <input value={landing.footer.copyright} onChange={e => updateLandingFooter({ copyright: e.target.value })} className={inputCls} />
          </Field>
        </div>

        <h3 className="text-sm font-medium text-slate-700 mb-3">法律链接</h3>
        <div className="space-y-3 mb-6">
          {landing.footer.legalLinks.map((l, i) => (
            <div key={i} className="flex items-center gap-3">
              <input value={l.label} onChange={e => updateLandingFooterLegalLink(i, { label: e.target.value })} className={inputCls} placeholder="链接文字" />
              <input value={l.href} onChange={e => updateLandingFooterLegalLink(i, { href: e.target.value })} className={inputCls} placeholder="链接地址" />
              <button onClick={() => removeLandingFooterLegalLink(i)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
            </div>
          ))}
          <button onClick={() => addLandingFooterLegalLink({ label: '新链接', href: '#' })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加法律链接</button>
        </div>

        <h3 className="text-sm font-medium text-slate-700 mb-3">链接栏目</h3>
        <div className="space-y-6">
          {landing.footer.columns.map((col, ci) => (
            <div key={ci} className="p-4 rounded-xl border border-slate-200/80">
              <div className="flex items-center gap-3 mb-4">
                <input value={col.title} onChange={e => updateLandingFooterColumn(ci, { title: e.target.value })} className={inputCls} placeholder="栏目名称" />
                <button onClick={() => removeLandingFooterColumn(ci)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
              </div>
              <div className="space-y-3 pl-2">
                {col.links.map((l, li) => (
                  <div key={li} className="flex items-center gap-3">
                    <input value={l.label} onChange={e => updateLandingFooterLink(ci, li, { label: e.target.value })} className={inputCls} placeholder="链接文字" />
                    <input value={l.href} onChange={e => updateLandingFooterLink(ci, li, { href: e.target.value })} className={inputCls} placeholder="链接地址" />
                    <button onClick={() => removeLandingFooterLink(ci, li)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
                  </div>
                ))}
                <button onClick={() => addLandingFooterLink(ci, { label: '新链接', href: '#' })} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-2"><Plus size={14} /> 添加链接</button>
              </div>
            </div>
          ))}
          <SecondaryButton onClick={addLandingFooterColumn} className="gap-1.5"><Plus size={15} /> 添加栏目</SecondaryButton>
        </div>
      </Card>
    </div>
  );
}
