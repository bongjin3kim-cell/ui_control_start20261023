import { randomUUID } from 'node:crypto';
import { AppError, createOwnerSessions, equal, json, readJson, securityHeaders, validateOrigin } from './security.mjs';
import { normalizeChat, requestAnswer } from './provider.mjs';

export function createApp({ env = process.env, localAuth = null, origin = env.APP_ORIGIN, local = false, sessionSecret, fetchImpl = fetch } = {}) {
  const mode = localAuth ? 'chatgpt-local' : 'api-key';
  const secure = !local;
  const secret = sessionSecret || env.APP_SESSION_SECRET || '';
  const sessions = createOwnerSessions({ secret, secure, sameSite: localAuth ? 'Lax' : 'Strict' });
  const setupErrors = [];
  let appOrigin;
  try { const u = new URL(origin); if (u.origin !== origin || (!local && u.protocol !== 'https:')) throw new Error(); appOrigin = u.origin; }
  catch { setupErrors.push('APP_ORIGIN'); }
  if (!localAuth) {
    if (!env.OPENAI_API_KEY?.trim()) setupErrors.push('OPENAI_API_KEY');
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(env.OPENAI_MODEL || '')) setupErrors.push('OPENAI_MODEL');
    if ((env.APP_ACCESS_PASSWORD || '').length < 24) setupErrors.push('APP_ACCESS_PASSWORD');
    if (secret.length < 32) setupErrors.push('APP_SESSION_SECRET');
  }
  const configured = setupErrors.length === 0;
  const activeRequests = new Set();
  const loginAttempts = new Map(); // Extra per-instance protection; not a global Vercel rate limiter.
  let modelCache;
  async function models() {
    if (!localAuth) return [{ id: env.OPENAI_MODEL, label: env.OPENAI_MODEL }];
    const state = await localAuth.status();
    if (modelCache?.account === state.activeAccount && modelCache.expires > Date.now()) return modelCache.models;
    const list = await localAuth.models(); modelCache = { account: state.activeAccount, models: list, expires: Date.now() + 60000 }; return list;
  }
  const requireSession = req => { if (!sessions.valid(req)) throw new AppError(401, 'OWNER_SIGNIN', '먼저 계정을 연결하거나 소유자 인증을 해 주세요.'); };
  return async function handler(req, res, pathname) {
    securityHeaders(res);
    try {
      const p = pathname || new URL(req.url, appOrigin || 'http://127.0.0.1').pathname;
      if (req.method === 'OPTIONS') throw new AppError(403, 'CORS', '다른 사이트에서 호출할 수 없습니다.');
      if (req.method === 'POST') {
        if (!configured) throw new AppError(503, 'NOT_CONFIGURED', '서버 연결 설정이 필요합니다. 설정 안내를 확인해 주세요.');
        validateOrigin(req, appOrigin);
      }
      if (p === '/api/status' && req.method === 'GET') {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'ORIGIN', '다른 사이트에서 보낸 요청입니다.');
        if (localAuth && !sessions.valid(req)) sessions.issue(res);
        const authenticated = !!localAuth || sessions.valid(req);
        const state = localAuth && authenticated ? await localAuth.status() : { connected: configured && authenticated, planEnabled: false, accounts: [], activeAccount: null };
        return json(res, 200, { mode, configured, authenticated, ...state, missingSettings: setupErrors, readOnly: true });
      }
      if (p === '/api/session' && req.method === 'POST') {
        if (localAuth) throw new AppError(400, 'MODE', 'ChatGPT 로그인 버튼을 사용해 주세요.');
        const body = await readJson(req, 2048);
        const ip = req.socket?.remoteAddress || 'vercel'; const now = Date.now();
        if (loginAttempts.size > 1000) loginAttempts.clear();
        const attempts = loginAttempts.get(ip);
        if (attempts && attempts.until > now && attempts.count >= 5) throw new AppError(429, 'LOGIN_LIMIT', '인증 시도가 많습니다. 1분 후 다시 시도해 주세요.');
        if (typeof body?.password !== 'string' || body.password.length > 512 || !equal(body.password, env.APP_ACCESS_PASSWORD)) {
          loginAttempts.set(ip, { count: attempts?.until > now ? attempts.count + 1 : 1, until: now + 60000 });
          throw new AppError(401, 'OWNER_SIGNIN', '소유자 비밀번호가 일치하지 않습니다.');
        }
        loginAttempts.delete(ip); sessions.issue(res); return json(res, 200, { authenticated: true });
      }
      if (p === '/auth/callback' && req.method === 'GET' && localAuth) {
        try { await localAuth.callback(new URL(req.url, appOrigin).searchParams, sessions.get(req)?.id); }
        catch { res.statusCode = 303; res.setHeader('Location', '/?connection=failed#lab'); return res.end(); }
        modelCache = null; res.statusCode = 303; res.setHeader('Location', '/?connection=success#lab'); return res.end();
      }
      if (p === '/api/auth/chatgpt/start' && req.method === 'POST' && localAuth) {
        requireSession(req); const body = await readJson(req, 2048);
        const url = await localAuth.start({ sessionId: sessions.get(req).id, accountId: typeof body?.accountId === 'string' ? body.accountId : undefined });
        return json(res, 200, { url });
      }
      if (p === '/api/auth/chatgpt/select' && req.method === 'POST' && localAuth) {
        requireSession(req); const body = await readJson(req, 2048); await localAuth.select(body?.accountId); modelCache = null;
        return json(res, 200, { selected: true });
      }
      if (p === '/api/models' && req.method === 'GET') {
        if (!configured) throw new AppError(503, 'NOT_CONFIGURED', '서버 설정이 필요합니다.');
        requireSession(req); return json(res, 200, { models: await models() });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        requireSession(req); modelCache = null;
        const result = localAuth ? await localAuth.logout() : { remoteRevocationConfirmed: true };
        sessions.clear(res); return json(res, 200, result);
      }
      if (p === '/api/chat' && req.method === 'POST') {
        requireSession(req);
        const session = sessions.get(req).id;
        if (activeRequests.has(session)) throw new AppError(409, 'BUSY', '현재 답변을 기다리거나 중지한 뒤 다시 질문해 주세요.');
        const chat = normalizeChat(await readJson(req));
        // A model ID is selected through a separate safe header, never from snapshot data.
        const selected = req.headers['x-ui-lab-model'];
        if (typeof selected !== 'string' || !(await models()).some(m => m.id === selected)) throw new AppError(400, 'MODEL', '이 계정에서 사용할 수 있는 모델을 선택해 주세요.');
        const credential = localAuth ? await localAuth.credential() : { kind: 'api-key', accessToken: env.OPENAI_API_KEY };
        activeRequests.add(session); const controller = new AbortController();
        const closed = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', closed);
        try {
          const result = await requestAnswer({ credential, model: selected, chat, fetchImpl, signal: controller.signal });
          if (!res.destroyed) return json(res, 200, { ...result, source: 'live-model', readOnly: true });
        } finally { activeRequests.delete(session); res.off('close', closed); }
        return;
      }
      throw new AppError(404, 'NOT_FOUND', '요청한 API를 찾을 수 없습니다.');
    } catch (error) {
      // Never serialize upstream payloads, exception stacks, headers, or secrets.
      if (!res.destroyed && !res.writableEnded) return json(res, error instanceof AppError ? error.status : 500, {
        error: { code: error instanceof AppError ? error.code : 'SERVER_ERROR', message: error instanceof AppError ? error.message : '서버에서 요청을 처리하지 못했습니다.', requestId: randomUUID() }
      });
    }
  };
}
