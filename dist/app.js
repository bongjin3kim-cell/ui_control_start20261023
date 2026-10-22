'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const storeKey = 'mcp-ui-lab-v1';
  const categories = { ui: 'UI 테스트', api: 'API 테스트', integration: '통합 테스트' };
  const priorities = { normal: '보통', high: '높음', low: '낮음' };
  const statuses = { pending: '대기', running: '진행 중', done: '완료' };
  const seed = () => [
    { id: 'REQ-1042', name: '로그인 폼 자동화', category: 'ui', priority: 'high', status: 'pending', note: '이메일 입력, 비밀번호 입력, 로그인 버튼 클릭을 테스트합니다.' },
    { id: 'REQ-1041', name: '사용자 검색 필터', category: 'ui', priority: 'normal', status: 'running', note: '검색과 필터 조건에 맞는 결과를 확인합니다.' },
    { id: 'REQ-1040', name: '결제 API 응답 확인', category: 'api', priority: 'normal', status: 'done', note: '모의 테스트 데이터입니다. 실제 결제는 발생하지 않습니다.' },
    { id: 'REQ-1039', name: '모달 확인 흐름', category: 'ui', priority: 'low', status: 'pending', note: '모달의 열기, 취소, 확인 동작을 검증합니다.' },
    { id: 'REQ-1038', name: '대시보드 통합 테스트', category: 'integration', priority: 'high', status: 'pending', note: '다양한 UI 요소를 연속으로 조작합니다.' },
    { id: 'REQ-1037', name: '테이블 페이지 이동', category: 'ui', priority: 'normal', status: 'done', note: '페이지를 이동하고 표시되는 행이 달라지는지 확인합니다.' },
    { id: 'REQ-1036', name: '알림 설정 저장', category: 'api', priority: 'low', status: 'running', note: '테스트용 알림 설정입니다.' },
    { id: 'REQ-1035', name: '프로필 수정 화면', category: 'integration', priority: 'normal', status: 'pending', note: '입력값이 저장되고 상세 화면에 반영되는지 확인합니다.' }
  ];
  const defaults = () => ({ rows: seed(), logs: [], completed: [], nextId: 1043, form: { name: '', category: 'ui', priority: 'normal', note: '', consent: false } });
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storeKey)); } catch { /* Empty or unavailable storage */ }
  let state = saved && Array.isArray(saved.rows) && Array.isArray(saved.logs) && Array.isArray(saved.completed) && saved.form && Number.isInteger(saved.nextId) ? saved : defaults();
  let page = 1, sort = '', selected = new Set(), logFilter = 'all', currentRoute = '', detailVisited = false, dialogMode = 'test', returnFocus = null, toastTimer, requestTimer;
  const size = 4;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const persist = () => { try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch { $('#toast').textContent = '브라우저 저장 공간을 사용할 수 없습니다. 현재 탭에서만 유지됩니다.'; $('#toast').hidden = false; } };
  const toast = (message) => { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200); };
  const scenarios = [
    { id: 'form', title: '입력 폼 제출', description: '텍스트 · 선택 상자 · 체크박스', expect: '요청 등록 성공, 목록에 새 요청 추가', prompt: 'UI 실습 화면에서 요청 이름을 "MCP 자동화 테스트"로 입력하고 유형은 "통합 테스트", 우선순위는 "높음"으로 선택해 줘. 메모에 "브라우저 MCP 실습"을 입력하고 저장 동의 체크박스를 체크한 뒤 "요청 등록"을 눌러 줘. 성공 메시지와 목록에 같은 이름의 요청이 추가됐는지 확인해 줘.', route: 'lab' },
    { id: 'validation', title: '입력 오류 검증', description: '필수값 · 오류 메시지 · 재시도', expect: '이름과 동의 오류 표시, 새 요청 없음', prompt: 'UI 실습에서 요청 이름을 비우고 저장 동의 체크박스를 해제한 뒤 "요청 등록"을 눌러 줘. 이름과 동의 항목에 오류 메시지가 나타나는지 확인하고, 새 요청이 추가되지 않았는지 확인해 줘.', route: 'lab' },
    { id: 'modal', title: '모달 확인·취소', description: '대화상자 · 포커스 · 확인', expect: '취소 후 다시 열어 확인하면 달성', prompt: 'UI 실습에서 "확인 모달 열기"를 누르고 대화상자가 보이는지 확인해 줘. "취소"를 누른 뒤 다시 열어 "확인하고 실행"을 눌러 줘. 모달이 닫히고 실행 로그에 modal.confirm 이벤트와 성공 결과가 있는지 확인해 줘.', route: 'lab' },
    { id: 'table', title: '테이블 조작', description: '검색 · 상태 필터 · 일괄 처리', expect: '로그인 요청을 찾아 선택 후 완료 처리', prompt: 'UI 실습의 요청 목록에서 "로그인"을 검색하고 상태 필터를 "모든 상태"로 설정해 줘. "요청 이름"을 눌러 정렬한 뒤 "로그인 폼 자동화" 행의 체크박스를 선택하고 "선택 항목 완료 처리"를 눌러 줘. 해당 행의 상태가 "완료"가 됐는지 확인해 줘. 검색어를 비우고 다음 테이블 페이지도 열어 줘.', route: 'lab' },
    { id: 'navigation', title: '페이지 왕복', description: '링크 · 상세 화면 · 경로', expect: '상세 요청 확인 후 페이지 목록으로 복귀', prompt: '"페이지 이동" 메뉴로 이동해서 "로그인 폼 자동화" 상세를 열어 줘. URL이 #record/REQ-1042로 끝나는지, 제목과 요청 ID가 맞는지 확인해 줘. "목록으로 돌아가기"를 눌러 #pages 화면으로 복귀하고 실행 로그를 확인해 줘.', route: 'pages' },
    { id: 'async', title: '지연 응답 대기', description: '로딩 · 비활성 버튼 · 성공과 실패', expect: '성공·실패 두 응답을 모두 확인하면 달성', prompt: 'UI 실습의 "기다림도 테스트"에서 "성공 응답"을 선택하고 "응답 요청"을 눌러 줘. 로딩 중 버튼이 비활성화되고 약 1.5초 후 성공 결과가 나타나는지 확인해 줘. 이어 "실패 응답"으로 바꿔 다시 요청하고 실패 결과도 확인해 줘. async-result의 data-state가 success, error 순으로 바뀌는지 확인해 줘.', route: 'lab' }
  ];
  let evidence = { modalCancel: false, modalConfirm: false, asyncSuccess: false, asyncError: false, tableSearch: false, tableSort: false, tableComplete: false, tablePage: false };
  function log(type, event, message, detail = '') {
    state.logs.unshift({ id: crypto.randomUUID?.() || `evt-${Date.now()}-${Math.random().toString(36).slice(2,10)}`, timestamp: new Date().toISOString(), type, event, message, detail });
    state.logs = state.logs.slice(0, 200); persist(); renderLogs();
  }
  function complete(id) {
    if (state.completed.includes(id)) return;
    state.completed.push(id); persist(); renderProgress(); renderScenarios();
    log('success', 'scenario.complete', `${scenarios.find(s => s.id === id).title} 시나리오 달성`, id);
    toast('✓ 시나리오 달성: ' + scenarios.find(s => s.id === id).title);
  }
  function renderProgress() {
    $('#completed-count').textContent = state.completed.length;
    $('#progress-fill').style.width = `${state.completed.length / scenarios.length * 100}%`;
    $('#progress-checklist').innerHTML = scenarios.map((s, i) => `<a class="checklist-item ${state.completed.includes(s.id) ? 'complete' : ''}" href="#scenarios" aria-label="${s.title}: ${state.completed.includes(s.id) ? '달성' : '미달성'}"><span class="check-circle">✓</span><span>${s.title}</span><span class="item-no">${String(i + 1).padStart(2, '0')}</span></a>`).join('');
  }
  function renderLogs() {
    const logs = state.logs.filter(e => logFilter === 'all' || e.type === logFilter);
    $('#log-count').textContent = state.logs.length;
    $('#event-log').innerHTML = logs.length ? logs.map(e => `<article class="log-entry ${esc(e.type)}" data-event="${esc(e.event)}"><time datetime="${esc(e.timestamp)}">${new Date(e.timestamp).toLocaleTimeString('ko-KR',{hour12:false})}</time><div class="event-name">${esc(e.event)}</div><p>${esc(e.message)}</p>${e.detail ? `<code>${esc(e.detail)}</code>` : ''}</article>`).join('') : '<div class="log-empty">기록된 로그가 없습니다.<br>UI를 조작하면 여기에 나타납니다.</div>';
  }
  function renderScenarios() {
    $('#scenario-cards').innerHTML = scenarios.map((s, i) => `<article class="card scenario-card" data-testid="scenario-${s.id}"><div class="scenario-top"><span class="scenario-index">SCENARIO ${String(i + 1).padStart(2,'0')}</span><span class="scenario-badge ${state.completed.includes(s.id) ? 'done' : ''}">${state.completed.includes(s.id) ? '✓ 달성' : '시작 전'}</span></div><h3>${s.title}</h3><span class="tiny-label">${s.description}</span><p class="scenario-prompt">${esc(s.prompt)}</p><p class="expected">✓ ${s.expect}</p><div class="scenario-actions"><a href="#${s.route}" class="button outline small">실습으로 이동 ↗</a><button class="button primary small" data-copy-scenario="${s.id}">명령 복사 ⧉</button></div></article>`).join('');
  }
  function readForm() { return { name: $('#request-name').value, category: $('#request-category').value, priority: $('#request-priority').value, note: $('#request-note').value, consent: $('#request-consent').checked }; }
  function hydrateForm() { const f = state.form; $('#request-name').value = f.name || ''; $('#request-category').value = f.category; $('#request-priority').value = f.priority; $('#request-note').value = f.note || ''; $('#request-consent').checked = !!f.consent; }
  function updateFormError(id, errorId, message) { $(id).setAttribute('aria-invalid', message ? 'true' : 'false'); $(errorId).textContent = message; }
  $('#request-form').addEventListener('submit', e => {
    e.preventDefault(); const f = readForm(); state.form = f;
    const noName = !f.name.trim(), noConsent = !f.consent;
    updateFormError('#request-name', '#name-error', noName ? '요청 이름을 입력해 주세요.' : '');
    updateFormError('#request-consent', '#consent-error', noConsent ? '테스트 데이터 저장에 동의해 주세요.' : '');
    $('#form-result').hidden = true;
    if (noName || noConsent) { log('error','form.validation','필수 항목이 입력되지 않았습니다.',[noName && 'request-name',noConsent && 'request-consent'].filter(Boolean).join(', ')); if(noName && noConsent) complete('validation'); (noName ? $('#request-name') : $('#request-consent')).focus(); return; }
    const row = { id: `REQ-${state.nextId++}`, name: f.name.trim(), category: f.category, priority: f.priority, note: f.note.trim(), status: 'pending' };
    state.rows.unshift(row); page = 1; $('#table-search').value = ''; $('#table-status').value = 'all'; sort = ''; selected.clear();
    log('success','form.submit',`“${row.name}” 요청이 등록되었습니다.`, `${row.id} · ${categories[row.category]} · ${priorities[row.priority]}`);
    $('#form-result').hidden = false; $('#form-result').textContent = `✓ ${row.id} 등록 완료 · ${row.name}`; renderTable();
    if (row.name === 'MCP 자동화 테스트' && row.category === 'integration' && row.priority === 'high' && row.note === '브라우저 MCP 실습') complete('form');
  });
  $$('#request-form input, #request-form select, #request-form textarea').forEach(el => {
    el.addEventListener('input', () => { state.form = readForm(); persist(); if (el.id === 'request-name' && el.value.trim()) updateFormError('#request-name','#name-error',''); if (el.id === 'request-consent' && el.checked) updateFormError('#request-consent','#consent-error',''); });
    el.addEventListener('change', () => { state.form = readForm(); log('info', 'form.change', el.type === 'checkbox' ? `저장 동의: ${el.checked ? '체크' : '해제'}` : `${el.labels?.[0]?.textContent.trim() || el.id}: ${el.value}`, `#${el.id}`); });
  });
  function filteredRows() {
    const q = $('#table-search').value.trim().toLowerCase(), filter = $('#table-status').value;
    let rows = state.rows.filter(r => (!q || `${r.name} ${r.id}`.toLowerCase().includes(q)) && (filter === 'all' || r.status === filter));
    if (sort) rows = [...rows].sort((a,b) => a.name.localeCompare(b.name,'ko') * (sort === 'asc' ? 1 : -1));
    return rows;
  }
  function renderTable() {
    const rows = filteredRows(), pages = Math.max(1, Math.ceil(rows.length / size)); page = Math.max(1, Math.min(page, pages)); const visible = rows.slice((page - 1)*size,page*size);
    $('#total-count').textContent = state.rows.length;
    $('#table-body').innerHTML = visible.length ? visible.map(r => `<tr data-testid="row-${r.id}"><td class="check-cell"><input type="checkbox" data-row-select="${r.id}" id="select-${r.id}" data-testid="select-${r.id}" aria-label="${esc(r.name)} 선택" ${selected.has(r.id) ? 'checked' : ''}></td><td><strong>${esc(r.name)}</strong><small>${r.id}</small></td><td>${categories[r.category]}</td><td><span class="status-chip ${r.status}">${statuses[r.status]}</span></td><td><span class="priority ${r.priority}">${priorities[r.priority]}</span></td><td><a href="#record/${r.id}" id="detail-${r.id}" data-testid="detail-${r.id}" class="row-link" aria-label="${esc(r.name)} 상세 보기">↗</a></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell" data-testid="table-empty">검색 결과가 없습니다.</td></tr>';
    $('#table-range').textContent = rows.length ? `전체 ${rows.length}건 중 ${(page - 1)*size + 1}–${Math.min(page*size,rows.length)}` : '검색 결과 0건';
    $('#page-number').textContent = `${page} / ${pages}`; $('#prev-page').disabled = page === 1; $('#next-page').disabled = page === pages;
    $('#select-all').checked = visible.length > 0 && visible.every(r => selected.has(r.id)); $('#select-all').indeterminate = visible.some(r => selected.has(r.id)) && !$('#select-all').checked; $('#select-all').disabled = !visible.length;
    $('#selection-bar').hidden = selected.size === 0; $('#selection-count').textContent = `${selected.size}개 선택됨`;
    $('#name-header').setAttribute('aria-sort',sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'); $('#sort-indicator').textContent = sort === 'asc' ? '↑' : sort === 'desc' ? '↓' : '↕';
  }
  function checkTableScenario() { if(evidence.tableSearch && evidence.tableSort && evidence.tableComplete && evidence.tablePage) complete('table'); }
  $('#table-search').addEventListener('input', () => { page = 1; selected.clear(); if ($('#table-search').value.trim() === '로그인') evidence.tableSearch = true; renderTable(); });
  $('#table-search').addEventListener('change', () => log('info','table.search',`검색: ${$('#table-search').value || '(전체)'}`, `결과 ${filteredRows().length}건`));
  $('#table-status').addEventListener('change', () => { page = 1; selected.clear(); renderTable(); log('info','table.filter',`상태 필터: ${$('#table-status').selectedOptions[0].textContent}`); });
  $('#sort-name').addEventListener('click', () => { sort = sort === 'asc' ? 'desc' : 'asc'; evidence.tableSort = true; page = 1; renderTable(); log('info','table.sort',`요청 이름 ${sort === 'asc' ? '오름차순' : '내림차순'} 정렬`); checkTableScenario(); });
  $('#table-body').addEventListener('change', e => { const id = e.target.dataset.rowSelect; if (!id) return; e.target.checked ? selected.add(id) : selected.delete(id); log('info','table.select',`${id} ${e.target.checked ? '선택' : '해제'}`, `선택 ${selected.size}건`); renderTable(); });
  $('#select-all').addEventListener('change', () => { const checked = $('#select-all').checked; filteredRows().slice((page-1)*size,page*size).forEach(r => checked ? selected.add(r.id) : selected.delete(r.id)); renderTable(); log('info','table.select_all',`현재 페이지 ${checked ? '전체 선택' : '선택 해제'}`,`선택 ${selected.size}건`); });
  $('#complete-selected').addEventListener('click', () => { if(!selected.size) return; const ids=[...selected]; state.rows.forEach(r => { if(selected.has(r.id)) r.status='done'; }); if(selected.has('REQ-1042')) evidence.tableComplete=true; log('success','table.bulk_complete',`${ids.length}개 요청 완료 처리`,ids.join(', ')); selected.clear(); renderTable(); checkTableScenario(); });
  function tablePage(delta) { page+=delta; renderTable(); evidence.tablePage=true; log('info','table.page',`테이블 ${page}페이지 이동`); checkTableScenario(); }
  $('#prev-page').addEventListener('click',() => tablePage(-1)); $('#next-page').addEventListener('click',() => tablePage(1));
  function openDialog(mode, trigger) {
    dialogMode=mode; returnFocus=trigger;
    $('#dialog-kicker').textContent=mode==='reset'?'RESET SESSION':'DIALOG TEST';
    $('#dialog-title').textContent=mode==='reset'?'실습을 처음부터 시작할까요?':'테스트 요청을 실행할까요?';
    $('#dialog-description').textContent=mode==='reset'?'현재 브라우저의 테스트 데이터, 로그, 달성 상태를 지우고 샘플 데이터로 복원합니다.':'확인을 누르면 실행 결과가 로그에 기록됩니다. 취소와 확인을 모두 시험하면 모달 시나리오가 완료됩니다.';
    $('#modal-confirm').textContent=mode==='reset'?'초기화하기':'확인하고 실행';
    $('#confirm-dialog').showModal(); $('#modal-cancel').focus(); if(mode==='test') log('info','modal.open','확인 모달이 열렸습니다.','#confirm-dialog');
  }
  function closeDialog() { $('#confirm-dialog').close(); returnFocus?.focus(); }
  function cancelDialog() { closeDialog(); if(dialogMode==='test') { evidence.modalCancel=true; $('#modal-result').textContent='취소되었습니다. 다시 열어 확인을 시험해 보세요.'; $('#modal-result').className='micro-result'; log('info','modal.cancel','모달이 취소되었습니다.'); if(evidence.modalConfirm) complete('modal'); } }
  $('#open-modal').addEventListener('click',() => openDialog('test',$('#open-modal')));
  $('#reset-session').addEventListener('click',() => openDialog('reset',$('#reset-session')));
  $('#modal-cancel').addEventListener('click',cancelDialog);
  $('#confirm-dialog').addEventListener('cancel',e => { e.preventDefault(); cancelDialog(); });
  $('#modal-confirm').addEventListener('click',() => {
    closeDialog(); if(dialogMode==='reset') { clearTimeout(requestTimer); state=defaults(); logFilter='all'; $$('[data-log-filter]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.logFilter==='all'))); selected.clear(); page=1; sort=''; detailVisited=false; evidence={}; $('#table-search').value=''; $('#table-status').value='all'; hydrateForm(); updateFormError('#request-name','#name-error',''); updateFormError('#request-consent','#consent-error',''); $('#form-result').hidden=true; $('#modal-result').textContent='아직 실행하지 않았습니다'; $('#modal-result').className='micro-result'; $('#async-start').disabled=false; $('#async-start').innerHTML='응답 요청 <span>→</span>'; $('#response-mode').disabled=false; $('#response-mode').value='success'; $('#async-result').textContent='응답 대기 중'; $('#async-result').dataset.state='idle'; $('#async-result').className='micro-result'; renderTable(); renderProgress(); renderScenarios(); log('info','session.reset','실습 데이터가 초기화되었습니다.'); if(location.hash!=='#lab') location.hash='lab'; toast('샘플 데이터로 초기화했습니다.'); return; }
    evidence.modalConfirm=true; $('#modal-result').textContent='✓ 확인 완료 · 테스트 요청이 실행되었습니다.'; $('#modal-result').className='micro-result success'; log('success','modal.confirm','모달 확인이 완료되었습니다.','#modal-confirm'); if(evidence.modalCancel) complete('modal');
  });
  $('#async-start').addEventListener('click',() => {
    const mode=$('#response-mode').value, started=performance.now(); $('#async-start').disabled=true; $('#response-mode').disabled=true; $('#async-start').textContent='응답 대기…'; $('#async-result').textContent='◌ 모의 응답을 불러오는 중…'; $('#async-result').dataset.state='loading'; $('#async-result').className='micro-result'; log('info','async.start',`모의 ${mode==='success'?'성공':'실패'} 응답 요청`,'delay: 1500ms');
    requestTimer=setTimeout(() => { const ok=mode==='success'; $('#async-start').disabled=false; $('#response-mode').disabled=false; $('#async-start').innerHTML='응답 요청 <span>→</span>'; $('#async-result').dataset.state=mode; $('#async-result').className=`micro-result ${mode}`; $('#async-result').textContent=ok?'✓ 200 OK · 응답을 정상적으로 받았습니다.':'✕ 500 ERROR · 모의 요청이 실패했습니다. 다시 시도할 수 있습니다.'; evidence[ok?'asyncSuccess':'asyncError']=true; log(ok?'success':'error',`async.${mode}`,ok?'지연 응답 수신 완료':'의도된 실패 응답 수신',`${Math.round(performance.now()-started)}ms · ${ok?'200 OK':'500 ERROR'}`); if(evidence.asyncSuccess && evidence.asyncError) complete('async'); },1500);
  });
  $('#show-selectors').addEventListener('change',e => document.body.classList.toggle('show-selectors',e.target.checked));
  $$('[data-log-filter]').forEach(button => button.addEventListener('click',() => { logFilter=button.dataset.logFilter; $$('[data-log-filter]').forEach(b => b.setAttribute('aria-pressed',String(b===button))); renderLogs(); }));
  $('#clear-logs').addEventListener('click',() => { state.logs=[]; persist(); renderLogs(); toast('실행 로그를 지웠습니다. 달성 상태는 유지됩니다.'); });
  $('#export-logs').addEventListener('click',() => { const report={ application:'MCP UI Lab', exportedAt:new Date().toISOString(), completedScenarios:state.completed, events:state.logs }; const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`mcp-ui-lab-logs-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('로그를 JSON 파일로 다운로드했습니다.'); });
  async function copy(text) { try { if(navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); } else { const field=document.createElement('textarea'); field.value=text; field.style.position='fixed'; field.style.opacity='0'; document.body.append(field); field.select(); const copied=document.execCommand('copy'); field.remove(); if(!copied) throw new Error('copy unavailable'); } toast('명령을 복사했습니다. 연결된 AI에게 붙여넣으세요.'); } catch { toast('복사 권한이 없습니다. 화면의 명령을 선택해 복사해 주세요.'); } }
  function siteUrl() { return location.origin+location.pathname; }
  $('#scenario-cards').addEventListener('click',e => { const button=e.target.closest('[data-copy-scenario]'); if(!button)return; const scenario=scenarios.find(s => s.id===button.dataset.copyScenario); copy(`${siteUrl()}#${scenario.route} 사이트를 브라우저 MCP로 열고 다음 작업을 실제 UI에서 수행해 줘.\n\n${scenario.prompt}\n\n마지막으로 실제 화면 상태와 실행 로그를 근거로 결과를 보고해 줘.`); });
  $('#copy-starter').addEventListener('click',() => copy($('#starter-prompt').textContent));
  function renderNavigation() { $('#navigation-items').innerHTML=state.rows.slice(0,6).map(r => `<a class="navigation-item" href="#record/${r.id}" data-testid="nav-${r.id}"><div><span class="record-id">${r.id}</span><strong>${esc(r.name)}</strong></div><span class="status-chip ${r.status}">${statuses[r.status]}</span><span class="row-link">↗</span></a>`).join(''); }
  function renderRecord(id) {
    const row=state.rows.find(r => r.id===id); if(!row) { $('#record-content').innerHTML='<h2>요청을 찾을 수 없습니다.</h2><p>초기화된 요청이거나 올바르지 않은 ID입니다.</p>'; log('error','navigation.not_found','요청 상세를 찾을 수 없습니다.',id); return; }
    detailVisited=true;
    $('#record-content').innerHTML=`<span class="detail-id" data-testid="record-id">${row.id}</span><h2 data-testid="record-title">${esc(row.name)}</h2><dl class="detail-grid"><div><dt>유형</dt><dd>${categories[row.category]}</dd></div><div><dt>우선순위</dt><dd>${priorities[row.priority]}</dd></div><div><dt>상태</dt><dd><span class="status-chip ${row.status}">${statuses[row.status]}</span></dd></div><div><dt>저장 위치</dt><dd>이 브라우저 · localStorage</dd></div></dl><div class="detail-note">${esc(row.note || '등록된 메모가 없습니다.')}</div><a href="#lab" class="button outline">UI 실습으로 이동 ↗</a>`;
  }
  const pageMeta={lab:['UI 실습','브라우저 자동화의 실험실','명령을 내리고, UI를 움직이고, 결과를 확인하세요.'],scenarios:['테스트 시나리오','작은 명령, 확실한 검증','6개의 시나리오로 브라우저 자동화를 하나씩 완성하세요.'],pages:['페이지 이동','다음 화면에서도, 끊김 없이','목록과 상세 화면을 오가며 브라우저 탐색을 검증하세요.'],guide:['자동화 가이드','AI와 연결하는 첫 번째 단계','브라우저 MCP 준비부터 안정적인 식별자 선택까지.'],record:['요청 상세','테스트 요청 상세','페이지의 URL과 저장된 데이터가 일치하는지 확인하세요.']};
  function route() {
    const hash=location.hash.slice(1)||'lab'; const name=hash.startsWith('record/')?'record':Object.hasOwn(pageMeta,hash)&&hash!=='record'?hash:'lab';
    const previous=currentRoute; currentRoute=name;
    $$('.view').forEach(v => v.hidden=v.id!==`view-${name}`); $$('[data-nav]').forEach(a => { const active=a.dataset.nav===(name==='record'?'pages':name); a.classList.toggle('active',active); if(active)a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    const meta=pageMeta[name]; $('#breadcrumb').textContent=meta[0]; $('#page-title').innerHTML=esc(meta[1])+'<span class="title-dot">.</span>'; $('#page-subtitle').textContent=meta[2]; document.title=`${meta[0]} · MCP UI Lab`;
    if(name==='pages') { renderNavigation(); if(previous==='record' && detailVisited) { complete('navigation'); detailVisited=false; } }
    if(name==='record') { let id; try { id=decodeURIComponent(hash.slice(7)); } catch { id=hash.slice(7); } renderRecord(id); }
    if(name==='scenarios') renderScenarios();
    if(previous) { log('info','navigation.change',`${meta[0]} 화면으로 이동`,`#${hash}`); window.scrollTo({top:0}); $('#main').focus({preventScroll:true}); }
    $('#starter-prompt').textContent=`${siteUrl()}#lab 사이트를 브라우저 MCP로 열어 줘. 비공개 사이트이므로 로그인 화면이 나타나면 내가 인증할 때까지 기다려 줘. "테스트 시나리오"에서 첫 번째 명령을 읽고 실제 UI로 수행한 뒤, 화면 상태와 실행 로그를 근거로 성공 여부를 보고해 줘.`;
  }
  $('.skip').addEventListener('click',e => { e.preventDefault(); $('#main').focus(); $('#main').scrollIntoView({block:'start'}); });
  window.addEventListener('hashchange',route);
  hydrateForm(); renderTable(); renderProgress(); renderScenarios(); renderLogs(); route();
  log('info','session.ready','UI Lab이 준비되었습니다. 테스트를 시작하세요.','browser-local · 6 scenarios');
})();
