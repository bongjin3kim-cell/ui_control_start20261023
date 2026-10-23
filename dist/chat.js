import { captureSnapshot, redactSecrets } from './snapshot.js';

const $ = s => document.querySelector(s);
const history = [];
let state, busy = false, controller, activeIdentity, conversationVersion = 0;
const messages = $('#ai-messages');
const notice = (message, error = false) => { $('#ai-notice').hidden = !message; $('#ai-notice').textContent = message; $('#ai-notice').dataset.error = String(error); };
const snapshot = () => captureSnapshot(document, { includeInputValues: $('#ai-include-values').checked });
const fingerprint = s => JSON.stringify({ ...s, capturedAt: '' });
const ready = () => state?.configured && state?.authenticated && state?.connected && (state.mode !== 'chatgpt-local' || state.planEnabled) && !!$('#ai-model').value;
const updateButtons = () => { $('#ai-send').disabled = busy || !ready(); $('#ai-stop').hidden = !busy; $('#ai-message').setAttribute('aria-busy', String(busy)); };

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['X-UI-Lab-Request'] = '1'; }
  if (path === '/api/chat') headers['X-UI-Lab-Model'] = $('#ai-model').value;
  let response;
  try { response = await fetch(path, { method, credentials: 'same-origin', redirect: 'error', headers, body: body === undefined ? undefined : JSON.stringify(body), signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('서버에 연결할 수 없습니다. 로컬 서버 또는 배포 상태를 확인해 주세요.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('AI 서버 API가 없습니다. 개인 PC에서는 npm run dev로 실행하고, 배포 시에는 서버 경로 설정을 확인해 주세요.'); }
  if (!response.ok) throw new Error(typeof data.error?.message === 'string' ? data.error.message : '요청을 처리하지 못했습니다.');
  return data;
}
function clearConversation() { conversationVersion++; controller?.abort(); history.length = 0; messages.replaceChildren(); append('system', '새 대화를 시작합니다. 현재 화면에 대해 질문해 주세요.'); }
function append(role, text, meta = '') {
  messages.querySelector('.ai-empty')?.remove();
  const item = document.createElement('article'); item.className = `ai-message ${role}`;
  const label = document.createElement('span'); label.className = 'ai-message-label'; label.textContent = role === 'user' ? '나' : role === 'assistant' ? '화면 도우미' : role === 'error' ? '연결 안내' : '안내';
  const body = document.createElement('div'); body.className = 'ai-message-body'; body.textContent = text;
  item.append(label, body);
  if (meta) { const m = document.createElement('p'); m.className = 'ai-message-meta'; m.textContent = meta; item.append(m); }
  messages.append(item); messages.scrollTop = messages.scrollHeight; return item;
}
async function refreshStatus() {
  try {
    state = await request('/api/status');
    const identity = `${state.mode}:${state.activeAccount || ''}:${state.connected}`;
    if (activeIdentity && identity !== activeIdentity) { conversationVersion++; controller?.abort(); history.length = 0; messages.replaceChildren(); }
    activeIdentity = identity;
    const local = state.mode === 'chatgpt-local';
    $('#ai-chatgpt-connect').hidden = !local || !state.configured;
    $('#ai-owner-form').hidden = local || !state.configured || state.authenticated;
    $('#ai-connected').hidden = !state.authenticated || !state.connected;
    $('#ai-setup').hidden = state.configured;
    $('#ai-manage-usage').hidden = !local;
    $('#ai-status').textContent = !state.configured ? '서버 설정 필요' : !state.authenticated ? '소유자 인증 필요' : !state.connected ? '계정 연결 필요' : local && !state.planEnabled ? '구독 사용 승인 필요' : '연결됨 · 읽기 전용';
    $('#ai-status').dataset.ready = String(state.connected && state.configured && (!local || state.planEnabled));
    $('#ai-missing-settings').textContent = state.missingSettings?.length ? `서버에서 확인할 설정: ${state.missingSettings.join(', ')}` : '';
    const account = $('#ai-account'); account.replaceChildren();
    for (const a of state.accounts || []) { const o = document.createElement('option'); o.value = a.id; o.textContent = a.label; o.selected = a.id === state.activeAccount; account.append(o); }
    account.hidden = !local || !(state.accounts?.length);
    $('#ai-add-account').hidden = !local || !(state.accounts?.length);
    $('#ai-connect').textContent = state.connected ? 'ChatGPT 다시 연결' : 'Continue with ChatGPT';
    const picker = $('#ai-model'); const previous = picker.value; picker.replaceChildren();
    if (state.connected && (!local || state.planEnabled)) {
      const data = await request('/api/models');
      for (const m of data.models || []) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; picker.append(o); }
      if ([...picker.options].some(o => o.value === previous)) picker.value = previous;
      if (!picker.options.length) notice('이 계정에 표시할 수 있는 모델이 없습니다. 계정과 구독 사용 설정을 확인해 주세요.', true);
    }
  } catch (e) { notice(e.message, true); $('#ai-status').textContent = '연결 확인 필요'; }
  updateButtons();
}
async function signIn(newAccount = false) {
  $('#ai-connect').disabled = true; notice('ChatGPT 로그인 페이지로 이동합니다. 본인이 직접 로그인하고 앱의 구독 사용 범위를 확인해 승인해 주세요.');
  try {
    const data = await request('/api/auth/chatgpt/start', { method: 'POST', body: { accountId: newAccount ? undefined : state.activeAccount || undefined } });
    const url = new URL(data.url);
    if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize') throw new Error('허용된 로그인 주소가 아닙니다.');
    location.assign(url.href);
  } catch (e) { notice(e.message, true); $('#ai-connect').disabled = false; }
}
$('#ai-connect').addEventListener('click', () => signIn());
$('#ai-add-account').addEventListener('click', () => signIn(true));
$('#ai-account').addEventListener('change', async e => {
  controller?.abort(); notice('');
  try { await request('/api/auth/chatgpt/select', { method: 'POST', body: { accountId: e.target.value } }); await refreshStatus(); }
  catch (error) { notice(error.message, true); }
});
$('#ai-owner-form').addEventListener('submit', async e => {
  e.preventDefault(); const field = $('#ai-owner-password'); const password = field.value; field.value = ''; notice('');
  try { await request('/api/session', { method: 'POST', body: { password } }); await refreshStatus(); }
  catch (error) { notice(error.message, true); }
});
$('#ai-disconnect').addEventListener('click', async () => {
  controller?.abort();
  try {
    const data = await request('/api/logout', { method: 'POST', body: {} }); clearConversation(); await refreshStatus();
    notice(data.remoteRevocationConfirmed ? '연결을 해제했습니다.' : '로컬 연결은 해제했습니다. 원격 해제는 확인되지 않았으므로 ChatGPT 설정에서도 앱 연결을 해제해 주세요.', !data.remoteRevocationConfirmed);
  } catch (e) { notice(e.message, true); }
});
$('#ai-model').addEventListener('change', updateButtons);
$('#ai-clear').addEventListener('click', clearConversation);
$('#ai-stop').addEventListener('click', () => controller?.abort());
document.querySelectorAll('[data-ai-prompt]').forEach(button => button.addEventListener('click', () => { $('#ai-message').value = button.dataset.aiPrompt; $('#ai-message').focus(); }));
function previewContext() { if ($('#ai-context').open) $('#ai-context-preview').textContent = JSON.stringify(snapshot(), null, 2); }
$('#ai-context').addEventListener('toggle', previewContext);
$('#ai-include-values').addEventListener('change', previewContext);
window.addEventListener('hashchange', previewContext);
document.addEventListener('input', e => { if (e.target.closest('.view')) previewContext(); });
document.addEventListener('change', e => { if (e.target.closest('.view')) previewContext(); });
// Observe application state only, so changing the preview cannot trigger itself.
const contextObserver = new MutationObserver(previewContext);
document.querySelectorAll('.view, #page-title, #completed-count, #event-log, #confirm-dialog').forEach(el => {
  contextObserver.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
});
$('#ai-chat-form').addEventListener('submit', async e => {
  e.preventDefault(); const field = $('#ai-message'); const question = redactSecrets(field.value.trim(), 1800);
  if (!question || busy || !ready()) return;
  const screen = snapshot(); const prior = history.slice(-10); const before = fingerprint(screen); const version = conversationVersion;
  field.value = ''; notice(''); append('user', question); history.push({ role: 'user', content: question });
  const pending = append('pending', '화면 정보를 확인하고 답변하는 중…');
  busy = true; updateButtons(); controller = new AbortController();
  try {
    const result = await request('/api/chat', { method: 'POST', body: { message: question, history: prior, snapshot: screen }, signal: controller.signal });
    if (version !== conversationVersion) return;
    if (typeof result.answer !== 'string' || result.source !== 'live-model') throw new Error('실제 모델의 완료된 답변을 확인하지 못했습니다.');
    pending.remove(); history.push({ role: 'assistant', content: result.answer });
    const stale = before !== fingerprint(snapshot());
    append('assistant', result.answer, `${result.model} · ${new Date(screen.capturedAt).toLocaleTimeString('ko-KR')} 화면 기준${stale ? ' · 전송 후 화면이 변경되었습니다.' : ''}`);
  } catch (error) {
    pending.remove(); if (version === conversationVersion) append('error', error.name === 'AbortError' ? '응답 대기를 중지했습니다. 완료된 답변은 저장하지 않았습니다.' : error.message);
  } finally { busy = false; controller = null; updateButtons(); field.focus(); }
});
const connection = new URLSearchParams(location.search).get('connection');
if (connection) {
  historyReplaceClean();
  notice(connection === 'success' ? '로그인 응답을 검증했습니다. 연결된 계정과 구독 사용 상태를 확인합니다.' : 'ChatGPT 연결을 완료하지 못했습니다. 승인 여부 또는 로그인이 만료되었는지 확인하고 다시 연결해 주세요.', connection !== 'success');
}
function historyReplaceClean() { window.history.replaceState(null, '', location.pathname + location.hash); }
refreshStatus();
