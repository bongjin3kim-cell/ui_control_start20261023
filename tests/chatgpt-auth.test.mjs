import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { PrivateStore } from '../server/private-store.mjs';
import { ChatGPTAuth } from '../server/chatgpt-auth.mjs';

const scopes = 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-lab-auth-test-')); t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const store = await new PrivateStore({ directory: dir }).init(); let tokenCalls = 0, nonce, subject = 'test-subject', tokenScope = scopes, refreshCount = 0;
  const auth = new ChatGPTAuth({ store, origin: 'http://127.0.0.1:5173',
    fetchImpl: async (url, init) => {
      if (url.endsWith('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
      if (url.endsWith('/oauth/token')) {
        tokenCalls++; const body = new URLSearchParams(init.body); assert.notEqual(body.get('client_id'), 'dynamic_agent_client'); assert.equal(body.get('resource'), 'https://api.openai.com/v1');
        if (body.get('grant_type') === 'refresh_token') { refreshCount++; assert.equal(body.get('scope'), null); return Response.json({ access_token: 'rotated-test-access', refresh_token: 'rotated-test-refresh', expires_in: 3600, scope: tokenScope }); }
        assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:5173/auth/callback'); assert(body.get('code_verifier'));
        return Response.json({ access_token: 'sensitive-test-access', refresh_token: 'sensitive-test-refresh', id_token: 'test-id-token', expires_in: 3600, scope: tokenScope });
      }
      if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'visible-model', display_name: 'Visible model', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hidden' }] });
      if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
      throw new Error('Unexpected URL');
    },
    verifyToken: async () => ({ sub: subject, nonce, email: 'test@example.test', email_verified: true }), ...options });
  async function begin(accountId) { const url = new URL(await auth.start({ sessionId: 'browser-session', accountId })); nonce = url.searchParams.get('nonce'); return url; }
  const callback = url => new URLSearchParams({ state: url.searchParams.get('state'), code: 'test-code', client_id: 'oaiapp_test_registration' });
  return { auth, store, dir, begin, callback, calls: () => tokenCalls, refreshes: () => refreshCount, setScope: s => { tokenScope = s; }, setSubject: s => { subject = s; } };
}

test('credential store is outside source, encrypted, owner-only, and host ID is stable', async t => {
  const x = await setup(t); const host = x.store.hostId;
  await x.store.write('accounts.enc', { active: 'a', profiles: [{ accessToken: 'confidential-test-value' }] });
  const bytes = await fs.readFile(path.join(x.dir, 'accounts.enc'), 'utf8'); assert(!bytes.includes('confidential-test-value'));
  assert.equal((await x.store.read('accounts.enc')).profiles[0].accessToken, 'confidential-test-value');
  assert.equal((await new PrivateStore({ directory: x.dir }).init()).hostId, host);
  if (process.platform !== 'win32') { assert.equal((await fs.stat(x.dir)).mode & 0o777, 0o700); assert.equal((await fs.stat(path.join(x.dir, 'storage.key'))).mode & 0o777, 0o600); }
  assert.throws(() => new PrivateStore({ directory: path.join(x.dir, 'child'), projectRoot: x.dir }), /OUTSIDE/);
});

test('OAuth rejects wrong state, session, returned client, and replay before token exchange', async t => {
  const x = await setup(t); const url = await x.begin();
  assert.equal(url.origin, 'https://auth.openai.com'); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client'); assert.equal(url.searchParams.get('agent_name_hint'), 'MCP UI Lab'); assert.equal(url.searchParams.get('ext_agent_host_id'), x.store.hostId); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  await assert.rejects(x.auth.callback(new URLSearchParams({ state: 'wrong', code: 'x' }), 'browser-session'), e => e.code === 'OAUTH_STATE');
  await assert.rejects(x.auth.callback(x.callback(url), 'other-browser'), e => e.code === 'OAUTH_STATE'); assert.equal(x.calls(), 0);
  await x.auth.callback(x.callback(url), 'browser-session'); assert.equal(x.calls(), 1);
  await assert.rejects(x.auth.callback(x.callback(url), 'browser-session'), e => e.code === 'OAUTH_STATE');
  const status = await x.auth.status(); assert(status.connected); assert(status.planEnabled); assert(!JSON.stringify(status).includes('sensitive-test')); assert(!JSON.stringify(status).includes('test@example.test'));
  const returning = await x.begin(status.activeAccount); assert.equal(returning.searchParams.get('client_id'), 'oaiapp_test_registration'); assert.equal(returning.searchParams.get('agent_name_hint'), null);
  assert.equal(returning.searchParams.get('id_token_hint'), null); assert(!returning.href.includes('test-id-token'));
  const changed = x.callback(returning); changed.set('client_id', 'oaiapp_other_registration');
  await assert.rejects(x.auth.callback(changed, 'browser-session'), e => e.code === 'CLIENT_ID'); assert.equal(x.calls(), 1);
  assert.deepEqual(await x.auth.models(), [{ id: 'visible-model', label: 'Visible model' }]);
});

test('signature/identity failure writes no credentials and identity-only grant cannot run inference', async t => {
  const x = await setup(t, { verifyToken: async () => { throw new Error('invalid signature'); } }); const url = await x.begin();
  await assert.rejects(x.auth.callback(x.callback(url), 'browser-session'), e => e.code === 'ID_TOKEN'); assert.equal((await x.store.accounts()).profiles.length, 0);
  const y = await setup(t); y.setScope('openid email profile'); const u = await y.begin(); await y.auth.callback(y.callback(u), 'browser-session');
  assert.equal((await y.auth.status()).planEnabled, false); await assert.rejects(y.auth.credential(), e => e.code === 'PLAN_PERMISSION');
});

test('real ID-token validator checks signature, issuer, audience, expiry, nonce and subject', async t => {
  const { publicKey, privateKey } = await generateKeyPair('RS256'); const jwk = await exportJWK(publicKey); jwk.kid = 'test-key'; jwk.alg = 'RS256';
  const x = await setup(t, { verifyToken: null, fetchImpl: async url => {
    if (String(url).endsWith('openid-configuration')) return Response.json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    return Response.json({ keys: [jwk] });
  } });
  const make = (aud = 'oaiapp_test', exp = '1h', issuer = 'https://auth.openai.com') => new SignJWT({ nonce: 'nonce', sub: 'subject' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  const token = await make(); assert.equal((await x.auth.validateIdToken(token, { clientId: 'oaiapp_test', nonce: 'nonce' })).sub, 'subject');
  await assert.rejects(x.auth.validateIdToken(token, { clientId: 'wrong', nonce: 'nonce' }), e => e.code === 'ID_TOKEN');
  await assert.rejects(x.auth.validateIdToken(token, { clientId: 'oaiapp_test', nonce: 'wrong' }), e => e.code === 'ID_TOKEN');
  await assert.rejects(x.auth.validateIdToken(await make('oaiapp_test', '-10m'), { clientId: 'oaiapp_test', nonce: 'nonce' }), e => e.code === 'ID_TOKEN');
  await assert.rejects(x.auth.validateIdToken(token, { clientId: 'oaiapp_test', subject: 'another' }), e => e.code === 'ID_TOKEN');
  await assert.rejects(x.auth.validateIdToken(await make('oaiapp_test', '1h', 'https://untrusted.example'), { clientId: 'oaiapp_test', nonce: 'nonce' }), e => e.code === 'ID_TOKEN');
  const tampered = token.split('.'); tampered[2] = (tampered[2][0] === 'a' ? 'b' : 'a') + tampered[2].slice(1);
  await assert.rejects(x.auth.validateIdToken(tampered.join('.'), { clientId: 'oaiapp_test', nonce: 'nonce' }), e => e.code === 'ID_TOKEN');
});

test('refresh is serialized and stores rotated tokens; logout clears tokens but retains mapping', async t => {
  const x = await setup(t); const url = await x.begin(); await x.auth.callback(x.callback(url), 'browser-session');
  await x.store.update(records => { records.profiles[0].expiresAt = 0; });
  const [a, b] = await Promise.all([x.auth.credential(), x.auth.credential()]); assert.equal(a.accessToken, 'rotated-test-access'); assert.equal(b.accessToken, a.accessToken); assert.equal(x.refreshes(), 1);
  assert.equal((await x.store.accounts()).profiles[0].refreshToken, 'rotated-test-refresh');
  assert.equal((await x.auth.logout()).remoteRevocationConfirmed, true);
  const records = await x.store.accounts(); assert.equal(records.profiles.length, 1); assert.equal(records.profiles[0].accessToken, undefined); assert.equal(records.profiles[0].refreshToken, undefined); assert.equal(records.profiles[0].idToken, undefined); assert(records.profiles[0].clientId);
});

test('remote hosted auth origins are rejected rather than reusing local ChatGPT tokens', async t => {
  const x = await setup(t);
  assert.throws(() => new ChatGPTAuth({ store: x.store, origin: 'https://example.vercel.app' }), /local/);
  assert.throws(() => new ChatGPTAuth({ store: x.store, origin: 'http://localhost:5173' }), /local/);
});

test('logout waits for token rotation and cannot restore credentials after disconnect', async t => {
  const x = await setup(t); const url = await x.begin(); await x.auth.callback(x.callback(url), 'browser-session');
  await x.store.update(records => { records.profiles[0].expiresAt = 0; });
  const upstream = x.auth.fetch; let release, started, revokedToken;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  x.auth.fetch = async (url, init) => {
    if (String(url).endsWith('/oauth/token')) { started(); await gate; }
    if (String(url).endsWith('/revoke')) revokedToken = new URLSearchParams(init.body).get('token');
    return upstream(url, init);
  };
  const rotation = x.auth.credential(); await waiting;
  const logout = x.auth.logout(); release(); await rotation; await logout;
  assert.equal(revokedToken, 'rotated-test-refresh');
  assert.equal((await x.auth.status()).connected, false);
  await assert.rejects(x.auth.credential(), e => e.code === 'CHATGPT_SIGNIN');
});

test('logout invalidates a callback that is already exchanging an authorization code', async t => {
  const x = await setup(t); const url = await x.begin(); const upstream = x.auth.fetch;
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  x.auth.fetch = async (url, init) => { if (String(url).endsWith('/oauth/token')) { started(); await gate; } return upstream(url, init); };
  const callback = x.auth.callback(x.callback(url), 'browser-session'); await waiting;
  await x.auth.logout(); release();
  await assert.rejects(callback, e => e.code === 'REAUTHORIZE');
  assert.equal((await x.store.accounts()).profiles.length, 0);
});
