(() => {
  const PAGE_SIZE = 12;
  const state = new Map();
  let scheduled = false;
  const style = document.createElement('style');
  style.textContent = 'table[data-usun-hide-remark="true"] th:nth-child(6),table[data-usun-hide-remark="true"] td:nth-child(6){display:none}';
  document.head.append(style);

  const pageState = (key) => {
    if (!state.has(key)) state.set(key, { page: 1 });
    return state.get(key);
  };

  const findTargetTable = () => {
    const path = window.location.pathname;
    if (path !== '/compute-records' && path !== '/assets') return null;
    for (const table of document.querySelectorAll('table')) {
      const heading = table.querySelector('thead')?.textContent || '';
      if (path === '/compute-records' && heading.includes('流水号') && heading.includes('剩余')) {
        return { key: 'compute-records', table, hideRemark: true };
      }
      if (path === '/assets' && heading.includes('任务名称') && heading.includes('消耗算力')) {
        return { key: 'assets-tasks', table, hideRemark: false };
      }
    }
    return null;
  };

  const render = () => {
    scheduled = false;
    observer.disconnect();
    const target = findTargetTable();
    document.querySelectorAll('[data-usun-list-pagination]').forEach((node) => node.remove());
    if (!target) { observe(); return; }

    const { key, table, hideRemark } = target;
    table.dataset.usunHideRemark = hideRemark ? 'true' : 'false';
    const allRows = [...table.querySelectorAll('tbody > tr')].filter((row) => !row.querySelector('[colspan]'));
    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    const current = pageState(key);
    current.page = Math.min(Math.max(1, current.page), totalPages);
    const first = (current.page - 1) * PAGE_SIZE;
    allRows.forEach((row, index) => {
      row.hidden = index < first || index >= first + PAGE_SIZE;
    });
    if (allRows.length <= PAGE_SIZE) { observe(); return; }

    const pager = document.createElement('div');
    pager.dataset.usunListPagination = key;
    pager.className = 'flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-100 text-sm bg-white';
    pager.innerHTML = `<span class="text-slate-400">共 ${allRows.length} 条，第 ${current.page} / ${totalPages} 页</span>`;
    const controls = document.createElement('div');
    controls.className = 'flex gap-2';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '上一页';
    previous.disabled = current.page <= 1;
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '下一页';
    next.disabled = current.page >= totalPages;
    for (const button of [previous, next]) {
      button.className = 'px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50';
    }
    previous.addEventListener('click', () => { current.page -= 1; schedule(); });
    next.addEventListener('click', () => { current.page += 1; schedule(); });
    controls.append(previous, next);
    pager.append(controls);
    table.parentElement?.after(pager);
    observe();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  };

  const observer = new MutationObserver((records) => {
    if (records.some((record) => !(record.target instanceof Element) || !record.target.closest('[data-usun-list-pagination]'))) schedule();
  });
  const observe = () => observer.observe(document.documentElement, { childList: true, subtree: true });
  observe();

  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      pageState('compute-records').page = 1;
      pageState('assets-tasks').page = 1;
      schedule();
    }
  });
  document.addEventListener('click', () => schedule(), true);
  window.addEventListener('popstate', schedule);
  schedule();
})();
