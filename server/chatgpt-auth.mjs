import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import { AppError, equal } from './security.mjs';

const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const opaque = () => randomBytes(32).toString('base64url');
const hash = s => createHash('sha256').update(s).digest('hex');
const validClient = s => typeof s === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(s) && s !== 'dynamic_agent_client';
const hasToken = p => typeof p?.accessToken === 'string' && p.accessToken.length > 0 && !p.needsReconnect;
const label = p => p.email ? p.email.replace(/^(.).+(@.*)$/, '$1***$2') : `ChatGPT 계정 ${p.id.slice(0, 6)}`;

export class ChatGPTAuth {
  constructor({ store, origin, fetchImpl = fetch, verifyToken, clock = () => Date.now() }) {
    const u = new URL(origin);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.pathname !== '/' || process.env.VERCEL) throw new Error('ChatGPT plan sign-in is enabled only on a local 127.0.0.1 runtime.');
    this.store = store; this.origin = origin; this.redirectUri = `${origin}/auth/callback`;
    this.fetch = fetchImpl; this.clock = clock; this.verifyToken = verifyToken; this.pending = new Map(); this.refreshes = new Map(); this.disconnecting = new Set(); this.authEpoch = 0;
  }
  async fetchJson(url, init = {}) {
    try {
      const response = await this.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new AppError(response.status === 401 || response.status === 400 ? 401 : 502, 'CHATGPT_CONNECTION', 'ChatGPT 연결을 갱신할 수 없습니다. 다시 로그인해 주세요.');
      const raw = await response.text();
      if (raw.length > 128 * 1024) throw new Error('Oversized auth response');
      return JSON.parse(raw);
    } catch (err) { if (err instanceof AppError) throw err; throw new AppError(502, 'CHATGPT_NETWORK', 'ChatGPT 인증 서버에 연결할 수 없습니다.'); }
  }
  async discovery() {
    if (!this.discoveryPromise) this.discoveryPromise = this.fetchJson(`${AUTH}/.well-known/openid-configuration`).then(data => {
      if (data.issuer !== AUTH) throw new Error('Invalid issuer');
      for (const key of ['jwks_uri', 'revocation_endpoint']) {
        const u = new URL(data[key]); if (u.origin !== AUTH || u.username || u.password) throw new Error('Untrusted OIDC endpoint');
      }
      return data;
    }).catch(() => { this.discoveryPromise = null; throw new AppError(502, 'DISCOVERY', '인증 서버 설정을 확인할 수 없습니다.'); });
    return this.discoveryPromise;
  }
  async validateIdToken(token, { clientId, nonce, subject }) {
    const discovery = await this.discovery();
    let payload;
    try {
      if (this.verifyToken) payload = await this.verifyToken(token, { clientId, nonce, subject });
      else {
        this.jwks ||= createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: 8000, [customFetch]: (url, options) => this.fetch(url, { ...options, redirect: 'error' }) });
        ({ payload } = await jwtVerify(token, this.jwks, { issuer: AUTH, audience: clientId, clockTolerance: 5, requiredClaims: ['sub', 'exp', 'iat'], currentDate: new Date(this.clock()) }));
      }
      if (!payload.sub || (nonce && !equal(payload.nonce || '', nonce)) || (subject && payload.sub !== subject)) throw new Error('Invalid token identity');
      return payload;
    } catch { throw new AppError(401, 'ID_TOKEN', '로그인 응답을 검증하지 못했습니다. 다시 연결해 주세요.'); }
  }
  async status() {
    const records = await this.store.accounts(); const active = records.profiles.find(p => p.id === records.active);
    return {
      connected: hasToken(active), planEnabled: hasToken(active) && active.scopes.includes(PLAN_SCOPE), activeAccount: active?.id || null,
      accounts: records.profiles.map(p => ({ id: p.id, label: label(p), connected: hasToken(p), planEnabled: hasToken(p) && p.scopes.includes(PLAN_SCOPE) }))
    };
  }
  async start({ sessionId, accountId }) {
    const records = await this.store.accounts();
    const existing = accountId ? records.profiles.find(p => p.id === accountId) : null;
    if (accountId && !existing) throw new AppError(400, 'ACCOUNT', '저장된 계정을 찾을 수 없습니다.');
    for (const [state, pending] of this.pending) if (pending.expires < this.clock()) this.pending.delete(state);
    if (this.pending.size >= 5) throw new AppError(429, 'SIGNIN_PENDING', '진행 중인 로그인을 마치거나 잠시 후 다시 시도해 주세요.');
    const state = opaque(), nonce = opaque(), verifier = opaque();
    this.pending.set(state, { sessionId, nonce, verifier, clientId: existing?.clientId, subject: existing?.subject, epoch: this.authEpoch, expires: this.clock() + 10 * 60 * 1000 });
    const params = new URLSearchParams({ client_id: existing?.clientId || 'dynamic_agent_client', ext_agent_host_id: this.store.hostId,
      response_type: 'code', redirect_uri: this.redirectUri, scope: SCOPE, resource: RESOURCE, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    // Intentionally omit optional id_token_hint: no retained token is returned
    // to frontend JavaScript or put in an application-visible navigation URL.
    if (!existing) params.set('agent_name_hint', 'MCP UI Lab');
    return `${AUTH}/api/accounts/authorize?${params}`;
  }
  async callback(params, sessionId) {
    const state = params.get('state'); const pending = this.pending.get(state);
    if (!pending || pending.expires < this.clock() || !equal(sessionId || '', pending.sessionId)) throw new AppError(400, 'OAUTH_STATE', '로그인 요청이 만료되었거나 일치하지 않습니다.');
    this.pending.delete(state);
    if (params.get('error')) throw new AppError(400, 'OAUTH_DENIED', 'ChatGPT 연결이 승인되지 않았습니다.');
    const returnedClient = params.get('client_id'); const clientId = pending.clientId || returnedClient;
    if (!validClient(clientId) || (pending.clientId && returnedClient && returnedClient !== pending.clientId)) throw new AppError(400, 'CLIENT_ID', '등록된 앱 정보를 확인하지 못했습니다.');
    const code = params.get('code'); if (!code || code.length > 4096) throw new AppError(400, 'OAUTH_CODE', '로그인 응답이 올바르지 않습니다.');
    const tokens = await this.fetchJson(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: this.redirectUri, resource: RESOURCE }).toString() });
    const identity = await this.validateIdToken(tokens.id_token, { clientId, nonce: pending.nonce, subject: pending.subject });
    const profile = this.profile(tokens, { id: hash(`${clientId}\0${identity.sub}`).slice(0, 32), clientId, subject: identity.sub, email: identity.email_verified === true && typeof identity.email === 'string' ? identity.email.slice(0, 254) : null, idToken: tokens.id_token });
    await this.store.update(records => {
      if (pending.epoch !== this.authEpoch) throw new AppError(401, 'REAUTHORIZE', '연결 해제 후 새 로그인을 시작해 주세요.');
      const i = records.profiles.findIndex(p => p.id === profile.id); if (i < 0) records.profiles.push(profile); else records.profiles[i] = profile; records.active = profile.id;
    });
  }
  profile(tokens, previous) {
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || /[\r\n]/.test(tokens.access_token) || tokens.access_token.length > 16000 || (tokens.token_type && tokens.token_type.toLowerCase() !== 'bearer')) throw new AppError(401, 'TOKEN_RESPONSE', '인증 응답이 올바르지 않습니다.');
    const expires = Number(tokens.expires_in);
    if (!Number.isFinite(expires) || expires <= 0 || expires > 86400) throw new AppError(401, 'TOKEN_EXPIRY', '인증 만료 정보를 확인할 수 없습니다.');
    return { ...previous, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || previous.refreshToken || null,
      idToken: tokens.id_token || previous.idToken, expiresAt: this.clock() + expires * 1000,
      scopes: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : previous.scopes || [], needsReconnect: false };
  }
  async activeProfile() {
    const records = await this.store.accounts(); const p = records.profiles.find(p => p.id === records.active);
    if (!hasToken(p) || this.disconnecting.has(p.id)) throw new AppError(401, 'CHATGPT_SIGNIN', 'Continue with ChatGPT로 계정을 연결해 주세요.');
    if (!p.scopes.includes(PLAN_SCOPE)) throw new AppError(403, 'PLAN_PERMISSION', '이 앱의 ChatGPT 구독 사용 권한을 승인해 주세요.');
    if (p.expiresAt > this.clock() + 60000) return p;
    if (!this.refreshes.has(p.id)) {
      const refresh = (async () => {
        if (!p.refreshToken) throw new AppError(401, 'REAUTHORIZE', 'ChatGPT 로그인을 갱신해 주세요.');
        const tokens = await this.fetchJson(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken, resource: RESOURCE }).toString() });
        if (tokens.id_token) await this.validateIdToken(tokens.id_token, { clientId: p.clientId, subject: p.subject });
        const updated = this.profile(tokens, p);
        if (!updated.scopes.includes(PLAN_SCOPE)) throw new AppError(403, 'PLAN_PERMISSION', 'ChatGPT 구독 사용 권한을 다시 확인해 주세요.');
        await this.store.update(records => { const i = records.profiles.findIndex(r => r.id === p.id); if (i >= 0) records.profiles[i] = updated; });
        return updated;
      })().finally(() => this.refreshes.delete(p.id));
      this.refreshes.set(p.id, refresh);
    }
    return this.refreshes.get(p.id);
  }
  async credential() { return { kind: 'chatgpt', accessToken: (await this.activeProfile()).accessToken }; }
  async models() {
    const p = await this.activeProfile();
    const result = await this.fetchJson(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${p.accessToken}` } });
    return (Array.isArray(result.models) ? result.models : []).filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ id: m.slug, label: m.display_name || m.slug }));
  }
  async select(id) {
    await this.store.update(records => { if (!records.profiles.some(p => p.id === id)) throw new AppError(400, 'ACCOUNT', '계정을 찾을 수 없습니다.'); records.active = id; });
  }
  async logout() {
    this.authEpoch++; this.pending.clear();
    const records = await this.store.accounts(); let profile = records.profiles.find(p => p.id === records.active);
    if (!profile) return { remoteRevocationConfirmed: true };
    const id = profile.id; this.disconnecting.add(id);
    try {
      // Finish an already-running rotation before revoking its latest token.
      try { await this.refreshes.get(id); } catch { /* Local credentials are still cleared. */ }
      profile = (await this.store.accounts()).profiles.find(p => p.id === id);
      await this.store.update(records => { const p = records.profiles.find(p => p.id === id); if (p) { delete p.accessToken; delete p.refreshToken; delete p.idToken; p.needsReconnect = true; } });
      const revokeToken = profile?.refreshToken || profile?.accessToken;
      let revoked = !revokeToken;
      if (revokeToken) {
        try {
          const discovery = await this.discovery();
          const r = await this.fetch(discovery.revocation_endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: revokeToken, token_type_hint: profile.refreshToken ? 'refresh_token' : 'access_token', client_id: profile.clientId }).toString() });
          revoked = r.status === 200;
        } catch { revoked = false; }
      }
      return { remoteRevocationConfirmed: revoked };
    } finally { this.disconnecting.delete(id); }
  }
}
