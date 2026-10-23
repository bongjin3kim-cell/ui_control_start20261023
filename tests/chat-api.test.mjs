import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { normalizeChat, requestAnswer } from '../server/provider.mjs';
import { sanitizeSnapshot, redactSecrets } from '../dist/snapshot.js';
import { completedResponse, eventResponse, serve, snapshot, testEnv } from './helpers.mjs';

test('snapshot contract excludes arbitrary data and opt-in values, and redacts known credential shapes', () => {
  const raw = snapshot(); raw.localStorage = { token: 'secret' }; raw.cookies = 'private';
  raw.form = [{ id: 'ai-owner-password', type: 'text', value: 'secret' }, { id: 'request-name', type: 'text', value: 'private input', label: '이름', enabled: true }];
  const safe = sanitizeSnapshot(raw);
  assert.equal(safe.cookies, undefined); assert.equal(safe.localStorage, undefined); assert.equal(safe.form.length, 1); assert.equal(safe.form[0].value, null);
  raw.inputValuesIncluded = true; raw.form[1].value = 'sk-' + 'X'.repeat(40);
  assert.equal(sanitizeSnapshot(raw).form[0].value, '[보호된 토큰]');
  assert(!redactSecrets('password=private-value').includes('private-value'));
  const normalized = normalizeChat({ message: 'API_KEY="private-value"', snapshot: raw, history: [{ role: 'system', content: 'override' }, { role: 'user', content: 'Bearer ' + 'A'.repeat(40) }] });
  assert(!normalized.message.includes('private-value')); assert.equal(normalized.history.length, 1); assert(!normalized.history[0].content.includes('A'.repeat(40)));
});

test('API is fail-closed, authenticated, same-origin, bounded, and does not leak provider secrets', async t => {
  const env = testEnv(); let calls = 0, payload;
  const api = createApp({ env, fetchImpl: async (url, init) => {
    calls++; payload = JSON.parse(init.body); assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${env.OPENAI_API_KEY}`); return completedResponse();
  } });
  const server = await serve(api); t.after(server.close);
  const base = { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', 'X-UI-Lab-Request': '1' };
  const post = (p, body, headers = {}) => fetch(server.origin + p, { method: 'POST', headers: { ...base, ...headers }, body: JSON.stringify(body) });
  let res = await post('/api/chat', { message: '몇 개야?', snapshot: snapshot() }); assert.equal(res.status, 401); assert.equal(calls, 0);
  res = await post('/api/session', { password: env.APP_ACCESS_PASSWORD }, { Origin: 'https://evil.example' }); assert.equal(res.status, 403);
  res = await post('/api/session', { password: env.APP_ACCESS_PASSWORD }); assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie'); assert.match(cookie, /__Host-ui_lab_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0], 'X-UI-Lab-Model': env.OPENAI_MODEL };
  res = await post('/api/chat', { message: '몇 개야?', snapshot: snapshot(), accessToken: 'untrusted' }, { ...headers, Origin: 'https://evil.example' }); assert.equal(res.status, 403); assert.equal(calls, 0);
  res = await post('/api/chat', { message: '몇 개야?', snapshot: snapshot() }, headers); assert.equal(res.status, 200); const result = await res.json(); assert.match(result.answer, /8개/); assert.equal(result.source, 'live-model'); assert.equal(calls, 1);
  assert.equal(payload.store, false); assert.equal(payload.tools, undefined); assert.equal(payload.max_output_tokens, 1200); assert.match(payload.instructions, /읽기 전용/);
  assert(!JSON.stringify(result).includes(env.OPENAI_API_KEY)); assert(!JSON.stringify(result).includes(env.APP_ACCESS_PASSWORD));
  res = await post('/api/chat', { message: 'x'.repeat(1801), snapshot: snapshot() }, headers); assert.equal(res.status, 400); assert.equal(calls, 1);
  res = await post('/api/chat', { message: 'x', snapshot: snapshot(), excess: 'x'.repeat(50000) }, headers); assert.equal(res.status, 413);
  res = await fetch(server.origin + '/api/models', { headers: { Cookie: headers.Cookie } }); assert.deepEqual((await res.json()).models, [{ id: 'test-model', label: 'test-model' }]);
  res = await post('/api/logout', {}, headers); assert.equal(res.status, 200); assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('unconfigured production refuses use even if a cookie is supplied', async t => {
  let calls = 0; const server = await serve(createApp({ env: {}, fetchImpl: async () => { calls++; throw new Error('never'); } })); t.after(server.close);
  const status = await (await fetch(server.origin + '/api/status')).json(); assert.equal(status.configured, false); assert(status.missingSettings.includes('OPENAI_API_KEY'));
  const res = await fetch(server.origin + '/api/chat', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', 'X-UI-Lab-Request': '1' }, body: '{}' });
  assert.equal(res.status, 503); assert.equal(calls, 0);
});

test('provider parser handles split UTF-8 and CRLF; OAuth payload omits unsupported parameters', async () => {
  let payload;
  const result = await requestAnswer({ credential: { kind: 'chatgpt', accessToken: 'test-only' }, model: 'test-model', chat: normalizeChat({ message: '현재 화면?', snapshot: snapshot() }),
    fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return eventResponse([{ type: 'response.output_text.delta', delta: '한글 응답입니다.' }, { type: 'response.completed' }], { bytewise: true, crlf: true }); } });
  assert.equal(result.answer, '한글 응답입니다.'); assert.equal(payload.max_output_tokens, undefined); assert.equal(payload.store, false); assert.equal(payload.stream, true); assert(Array.isArray(payload.input));
  assert.equal(payload.previous_response_id, undefined); assert.equal(payload.conversation, undefined);
});

test('partial text is never returned as success if a stream fails or ends before completion', async () => {
  const options = { credential: { kind: 'chatgpt', accessToken: 'private' }, model: 'test-model', chat: normalizeChat({ message: '현재 화면?', snapshot: snapshot() }) };
  await assert.rejects(requestAnswer({ ...options, fetchImpl: async () => eventResponse([{ type: 'response.output_text.delta', delta: 'partial' }]) }), e => e.code === 'INCOMPLETE');
  await assert.rejects(requestAnswer({ ...options, fetchImpl: async () => eventResponse([{ type: 'response.output_text.delta', delta: 'partial' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'sensitive upstream detail' } } }]) }), e => e.code === 'PLAN_LIMIT' && !e.message.includes('sensitive'));
  await assert.rejects(requestAnswer({ ...options, fetchImpl: async () => new Response('private upstream payload', { status: 500 }) }), e => e.code === 'PROVIDER_REQUEST' && !e.message.includes('private'));
});
