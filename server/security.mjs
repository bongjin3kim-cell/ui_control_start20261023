import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { redactSecrets } from '../dist/snapshot.js';

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const safeMessage = value => redactSecrets(value, 1800);
export function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
export function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
export function json(res, status, value) {
  securityHeaders(res); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value));
}
export async function readJson(req, limit = 48 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new AppError(415, 'CONTENT_TYPE', 'JSON 형식으로 요청해 주세요.');
  if (Number(req.headers['content-length']) > limit) throw new AppError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
  // Vercel may have parsed the body already. Bound that representation as well.
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > limit) throw new AppError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
    try { return JSON.parse(raw); } catch { throw new AppError(400, 'JSON', '올바른 JSON이 아닙니다.'); }
  }
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new AppError(413, 'TOO_LARGE', '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'JSON', '올바른 JSON이 아닙니다.'); }
}
export function validateOrigin(req, origin) {
  if (req.headers.origin !== origin || req.headers['x-ui-lab-request'] !== '1') throw new AppError(403, 'ORIGIN', '이 사이트에서 시작한 요청만 허용합니다.');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new AppError(403, 'ORIGIN', '다른 사이트에서 보낸 요청입니다.');
}
export function createOwnerSessions({ secret, secure = true, sameSite = 'Strict', clock = () => Date.now() }) {
  const name = secure ? '__Host-ui_lab_session' : 'ui_lab_session';
  function signature(body) { return createHmac('sha256', secret).update(body).digest('base64url'); }
  function issue(res) {
    const body = Buffer.from(JSON.stringify({ purpose: 'ui-lab-owner', id: randomBytes(24).toString('base64url'), exp: clock() + 60 * 60 * 1000 })).toString('base64url');
    res.setHeader('Set-Cookie', `${name}=${body}.${signature(body)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=3600${secure ? '; Secure' : ''}`);
  }
  function get(req) {
    const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!value || value.length > 2048) return null;
    const [body, sig, extra] = value.split('.');
    if (!body || !sig || extra || !equal(signature(body), sig)) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url')); return p.purpose === 'ui-lab-owner' && Number.isFinite(p.exp) && p.exp > clock() && p.exp <= clock() + 60 * 60 * 1000 ? p : null; }
    catch { return null; }
  }
  return { issue, get, valid: req => !!get(req), clear: res => res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? '; Secure' : ''}`) };
}
