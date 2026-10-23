// Shared, read-only snapshot contract. Nothing outside this allowlist is sent.
export function redactSecrets(value, max = 600) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[보호된 키]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[보호된 토큰]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[보호된 토큰]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, 'Bearer [보호된 토큰]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|비밀번호)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[보호된 값]')
    .slice(0, max);
}
const text = (v, max = 160) => redactSecrets(typeof v === 'string' ? v : '', max);
const count = (v) => Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), 1000000) : 0;
const allowed = (v, values, fallback = '') => values.includes(v) ? v : fallback;
const fields = ['request-name', 'request-category', 'request-priority', 'request-note', 'request-consent'];

export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) throw new Error('INVALID_SNAPSHOT');
  const inputValuesIncluded = raw.inputValuesIncluded === true;
  return {
    schemaVersion: 1,
    capturedAt: text(raw.capturedAt, 40),
    route: /^#(?:lab|scenarios|pages|guide|record\/REQ-\d+)$/.test(raw.route) ? raw.route : '#lab',
    heading: text(raw.heading), inputValuesIncluded,
    summary: { totalRequests: count(raw.summary?.totalRequests), completedScenarios: Math.min(count(raw.summary?.completedScenarios), 6) },
    form: (Array.isArray(raw.form) ? raw.form : []).filter(f => f && fields.includes(f.id)).slice(0, 5).map(f => ({
      id: f.id, label: text(f.label, 40), type: allowed(f.type, ['text', 'textarea', 'select-one', 'checkbox']),
      enabled: f.enabled === true,
      value: f.type === 'checkbox' ? f.value === true :
        ['request-category', 'request-priority'].includes(f.id) ? text(f.value, 30) : inputValuesIncluded ? text(f.value, 300) : null,
      options: (Array.isArray(f.options) ? f.options : []).slice(0, 5).map(o => ({ value: text(o?.value, 30), label: text(o?.label, 40) }))
    })),
    table: {
      page: text(raw.table?.page, 30), range: text(raw.table?.range, 60),
      statusFilter: allowed(raw.table?.statusFilter, ['all', 'pending', 'running', 'done'], 'all'),
      sort: allowed(raw.table?.sort, ['none', 'ascending', 'descending'], 'none'),
      search: inputValuesIncluded ? text(raw.table?.search, 60) : null,
      rows: (Array.isArray(raw.table?.rows) ? raw.table.rows : []).slice(0, 4).filter(r => /^REQ-\d+$/.test(r?.id)).map(r => ({
        id: r.id, name: inputValuesIncluded ? text(r.name, 60) : null,
        status: allowed(r.status, ['pending', 'running', 'done']), selected: r.selected === true
      }))
    },
    modal: { open: raw.modal?.open === true, title: text(raw.modal?.title, 80) },
    async: { state: allowed(raw.async?.state, ['idle', 'loading', 'success', 'error'], 'idle'), result: text(raw.async?.result, 150) },
    errors: (Array.isArray(raw.errors) ? raw.errors : []).slice(0, 3).map(e => text(e, 120)),
    recentEvents: (Array.isArray(raw.recentEvents) ? raw.recentEvents : []).slice(0, 10).filter(e => typeof e === 'string' && /^[a-z_]+\.[a-z_]+$/.test(e))
  };
}

export function captureSnapshot(doc, { includeInputValues = false } = {}) {
  const $ = s => doc.querySelector(s);
  const visible = el => !!el && !el.closest('[hidden]');
  const value = s => $(s)?.textContent?.trim() || '';
  const form = visible($('#request-form')) ? fields.map(id => {
    const el = doc.getElementById(id);
    return { id, label: el?.labels?.[0]?.textContent?.trim() || id,
      type: el?.tagName === 'TEXTAREA' ? 'textarea' : el?.type || 'text', enabled: !el?.disabled,
      value: el?.type === 'checkbox' ? el.checked : el?.value,
      options: el?.options ? [...el.options].map(o => ({ value: o.value, label: o.textContent })) : [] };
  }) : [];
  const rows = visible($('#request-table')) ? [...doc.querySelectorAll('#table-body tr[data-testid]')].map(r => ({
    id: r.dataset.testid.slice(4), name: r.querySelector('strong')?.textContent,
    status: ['pending', 'running', 'done'].find(s => r.querySelector(`.status-chip.${s}`)) || '',
    selected: !!r.querySelector('input[type=checkbox]')?.checked
  })) : [];
  return sanitizeSnapshot({
    schemaVersion: 1, capturedAt: new Date().toISOString(), route: doc.defaultView?.location.hash || '#lab',
    heading: value('#page-title'), inputValuesIncluded: includeInputValues,
    summary: { totalRequests: value('#total-count'), completedScenarios: value('#completed-count') }, form,
    table: { rows, page: visible($('#request-table')) ? value('#page-number') : '', range: visible($('#request-table')) ? value('#table-range') : '',
      statusFilter: $('#table-status')?.value, sort: $('#name-header')?.getAttribute('aria-sort'), search: $('#table-search')?.value },
    modal: { open: !!$('#confirm-dialog')?.open, title: $('#confirm-dialog')?.open ? value('#dialog-title') : '' },
    async: { state: $('#async-result')?.dataset.state, result: value('#async-result') },
    errors: ['name-error', 'consent-error'].map(id => doc.getElementById(id)).filter(visible).map(e => e.textContent).filter(Boolean),
    recentEvents: [...doc.querySelectorAll('#event-log [data-event]')].map(e => e.dataset.event)
  });
}
