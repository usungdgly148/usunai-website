(() => {
  const CONFIG_KEY = 'legalAgreements';
  const DEFAULTS = {
    privacy: {
      title: '隐私政策',
      content: `# 隐私政策

**生效日期：**【2026-03-26】

我们重视您的隐私。本隐私政策说明本平台如何收集、使用、存储和保护您的信息。

## 1. 我们收集的信息

- **账户信息：**您注册或使用服务时提供的昵称、手机号、邮箱等。
- **使用数据：**您的 IP 地址、浏览器类型、访问页面及服务使用记录等。

## 2. 信息的使用

我们会将相关信息用于提供、维护和优化服务，保障账户与平台安全，以及向您发送必要的服务通知。

## 3. 信息共享

除法律法规要求或为保护平台及用户合法权益外，我们不会向无关第三方出售或共享您的个人信息。

## 4. 联系我们

如您对本隐私政策有任何疑问，请通过平台“联系我们”入口与我们联系。`
    },
    terms: {
      title: '服务条款',
      content: `# 服务条款

**生效日期：**【2026-03-26】

欢迎使用本平台。访问或使用本服务，即表示您已阅读、理解并同意遵守本服务条款。

## 1. 接受条款

您应遵守适用的法律法规及本平台公布的规则；如不同意本条款，请停止使用服务。

## 2. 账户责任

您应妥善保管账户信息，并对账户下发生的活动负责。发现异常使用时，请及时联系我们。

## 3. 禁止行为

- 违反法律法规或侵害他人合法权益；
- 绕过平台技术措施、干扰服务正常运行；
- 传播恶意软件、病毒或其他有害内容。

## 4. 条款修改

我们可能根据业务或法律要求更新本条款；更新后的内容将在本页面公布并自公布或载明日期起生效。

## 5. 服务终止

在法律法规允许的范围内，我们可因合理原因暂停或终止服务，并依法处理相关事项。`
    }
  };

  const getConfig = async () => {
    try {
      const response = await fetch('/api/data/get-config', { credentials: 'same-origin' });
      const json = await response.json();
      return json && json.data && json.data[CONFIG_KEY] && typeof json.data[CONFIG_KEY] === 'object'
        ? json.data[CONFIG_KEY] : {};
    } catch { return {}; }
  };

  const adminFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    try {
      const token = localStorage.getItem('clone_admin_token') || '';
      if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    } catch { /* 未登录时由服务端返回无权限 */ }
    return fetch(url, { ...options, headers, credentials: 'same-origin' });
  };

  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const inline = value => escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const markdown = value => String(value || '').split('\n').map(line => {
    if (/^#\s+/.test(line)) return `<h1>${inline(line.slice(2))}</h1>`;
    if (/^##\s+/.test(line)) return `<h2>${inline(line.slice(3))}</h2>`;
    if (/^-\s+/.test(line)) return `<li>${inline(line.slice(2))}</li>`;
    if (!line.trim()) return '';
    return `<p>${inline(line)}</p>`;
  }).join('').replace(/(<li>.*?<\/li>)(?!(<li>))/g, '$1');

  const policyTypeFromHref = href => /privacy-policy|privacy-policy-modal/.test(href || '') ? 'privacy' : /terms-of-service|terms-of-service-modal/.test(href || '') ? 'terms' : null;

  async function openPolicyModal(type) {
    const config = await getConfig();
    const policy = { ...DEFAULTS[type], ...(config[type] || {}) };
    document.querySelector('.usun-policy-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'usun-policy-modal';
    modal.innerHTML = `<div class="usun-policy-modal__backdrop"></div><section class="usun-policy-modal__panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(policy.title)}"><button class="usun-policy-modal__close" type="button" aria-label="关闭">×</button><h1>${escapeHtml(policy.title)}</h1><div class="usun-legal-content">${markdown(policy.content)}</div></section>`;
    const close = () => modal.remove();
    modal.querySelector('.usun-policy-modal__close').addEventListener('click', close);
    modal.querySelector('.usun-policy-modal__backdrop').addEventListener('click', close);
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.appendChild(modal);
    modal.querySelector('.usun-policy-modal__close').focus();
  }

  function bindPolicyFooterLinks() {
    document.querySelectorAll('footer a').forEach(link => {
      const type = policyTypeFromHref(link.getAttribute('href'));
      if (!type || link.dataset.usunPolicyBound) return;
      link.dataset.usunPolicyBound = 'true';
      link.addEventListener('click', event => { event.preventDefault(); openPolicyModal(type); });
    });
  }

  async function renderAdminPage() {
    if (location.pathname !== '/admin/legal-agreements') return false;
    const config = await getConfig();
    const privacy = { ...DEFAULTS.privacy, ...(config.privacy || {}) };
    const terms = { ...DEFAULTS.terms, ...(config.terms || {}) };
    const root = document.getElementById('root');
    if (!root) return true;
    root.innerHTML = `<main class="usun-admin-legal"><a class="usun-legal-back" href="/admin/landing">← 返回首页内容</a><section><h1>政策协议</h1><p>配置站点的隐私政策和服务条款；保存后会立即同步至前台页脚链接。</p><div class="usun-policy-tabs"><button data-type="privacy" class="active">隐私政策</button><button data-type="terms">服务条款</button></div><label>协议标题<input id="usun-legal-title" value="${escapeHtml(privacy.title)}" /></label><label>协议内容（Markdown）<textarea id="usun-legal-content">${escapeHtml(privacy.content)}</textarea></label><div class="usun-legal-actions"><span id="usun-legal-status"></span><button id="usun-legal-save">保存配置</button></div></section></main>`;
    const drafts = { privacy, terms };
    let active = 'privacy';
    const title = document.getElementById('usun-legal-title');
    const content = document.getElementById('usun-legal-content');
    const status = document.getElementById('usun-legal-status');
    const switchTab = type => {
      drafts[active] = { title: title.value.trim() || DEFAULTS[active].title, content: content.value };
      active = type;
      title.value = drafts[type].title;
      content.value = drafts[type].content;
      root.querySelectorAll('[data-type]').forEach(button => button.classList.toggle('active', button.dataset.type === type));
    };
    root.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.type)));
    document.getElementById('usun-legal-save').addEventListener('click', async () => {
      drafts[active] = { title: title.value.trim() || DEFAULTS[active].title, content: content.value };
      status.textContent = '保存中…';
      try {
        const response = await adminFetch('/api/data/put-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: CONFIG_KEY, value: drafts }) });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error((json && json.msg) || '保存失败');
        status.textContent = '已保存，前台内容已同步。';
      } catch (error) { status.textContent = `保存失败：${error.message || '请确认管理员登录状态'}`; }
    });
    return true;
  }

  function addAdminEntry() {
    if (!location.pathname.startsWith('/admin/') || location.pathname === '/admin/legal-agreements') return;
    const landingLink = [...document.querySelectorAll('a')].find(link => /首页内容/.test(link.textContent || ''));
    if (!landingLink || document.querySelector('[data-usun-legal-entry]')) return;
    const link = document.createElement('a');
    link.href = '/admin/legal-agreements';
    link.dataset.usunLegalEntry = 'true';
    link.className = landingLink.className;
    link.textContent = '政策协议';
    link.addEventListener('click', event => {
      event.preventDefault();
      history.pushState({}, '', link.href);
      renderAdminPage();
    });
    landingLink.insertAdjacentElement('afterend', link);
  }

  const style = document.createElement('style');
  style.textContent = `.usun-legal-content h1{font-size:24px;border:0;padding:0}.usun-legal-content h2{font-size:18px;margin:26px 0 12px}.usun-legal-content p,.usun-legal-content li{line-height:1.8;color:#475569}.usun-legal-content li{margin:6px 0}.usun-policy-modal{position:fixed;z-index:9999;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}.usun-policy-modal__backdrop{position:absolute;inset:0;background:#0f172a8c}.usun-policy-modal__panel{position:relative;z-index:1;width:min(820px,100%);max-height:min(780px,calc(100vh - 48px));overflow:auto;background:#fff;border-radius:18px;padding:34px 38px;box-shadow:0 24px 70px #0f172a55}.usun-policy-modal__panel>h1{font-size:28px;margin:0 36px 26px 0;color:#0f172a}.usun-policy-modal__close{position:absolute;right:18px;top:16px;border:0;background:#f1f5f9;color:#475569;border-radius:50%;width:32px;height:32px;font-size:24px;line-height:28px;cursor:pointer}.usun-policy-modal__close:hover{background:#e2e8f0}.usun-legal-back{display:inline-block;margin-bottom:18px;color:#2563eb;text-decoration:none}.usun-admin-legal{max-width:1000px;margin:0 auto;padding:36px 24px 72px;color:#0f172a}.usun-admin-legal section{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:38px;box-shadow:0 8px 30px #0f172a0d}.usun-admin-legal h1{margin:0 0 8px;font-size:26px}.usun-admin-legal p{color:#64748b;margin:0 0 24px}.usun-policy-tabs{display:flex;background:#f1f5f9;border-radius:10px;padding:4px;max-width:400px;margin:22px 0}.usun-policy-tabs button{flex:1;border:0;border-radius:7px;padding:10px;background:transparent;cursor:pointer}.usun-policy-tabs button.active{background:#fff;box-shadow:0 1px 4px #0f172a22}.usun-admin-legal label{display:block;font-weight:600;margin:18px 0 8px}.usun-admin-legal input,.usun-admin-legal textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:11px;margin-top:8px;font:inherit}.usun-admin-legal textarea{min-height:420px;line-height:1.65;resize:vertical}.usun-legal-actions{margin-top:20px;display:flex;align-items:center;gap:16px}.usun-legal-actions button{border:0;border-radius:8px;background:#2563eb;color:#fff;padding:11px 18px;font-weight:600;cursor:pointer}.usun-legal-actions span{color:#64748b;font-size:14px}`;
  document.head.appendChild(style);

  const init = async () => {
    if (await renderAdminPage()) return;
    bindPolicyFooterLinks();
    addAdminEntry();
    new MutationObserver(() => { bindPolicyFooterLinks(); addAdminEntry(); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
