import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { PrivateStore } from './private-store.mjs';
import { ChatGPTAuth } from './chatgpt-auth.mjs';
import { securityHeaders } from './security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticRoot = await fs.realpath(path.join(root, 'dist'));
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const isChatGPT = process.argv.includes('--chatgpt');
let localAuth, sessionSecret;
if (isChatGPT) {
  const store = await new PrivateStore({ directory: process.env.CHATGPT_DATA_DIR, projectRoot: root }).init();
  localAuth = new ChatGPTAuth({ store, origin }); sessionSecret = store.sessionSecret;
}
const handler = createApp({ local: true, origin, localAuth, sessionSecret });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  // Bind and Host validation both prevent exposing a local OAuth runtime remotely.
  if (req.headers.host !== `127.0.0.1:${port}`) { res.statusCode = 403; return res.end('Use the 127.0.0.1 address printed by this server.'); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, origin).pathname); }
  catch { res.statusCode = 400; return res.end('Bad request'); }
  if (pathname.startsWith('/api/') || pathname === '/auth/callback') return handler(req, res, pathname);
  if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
  if (pathname.split('/').some(part => part.startsWith('.'))) { res.statusCode = 404; return res.end(); }
  try {
    const file = await fs.realpath(path.join(staticRoot, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(staticRoot + path.sep) || !(await fs.stat(file)).isFile()) throw new Error();
    const bytes = await fs.readFile(file); res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.statusCode = 404; res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`MCP UI Lab: ${origin}\nMode: ${isChatGPT ? 'local ChatGPT sign-in' : 'server API key'} · read-only chat\nNo credentials or request bodies are logged.`));
