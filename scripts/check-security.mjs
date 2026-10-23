import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [...new Set([...tracked, ...untracked])];
const forbiddenPath = /(^|\/)(?:\.env(?:\..+)?|\.vercel|\.private|private|secrets|auth\.json|tokens\.json|host\.enc|accounts\.enc|credentials[^/]*\.json|chatgpt-host\.json|chatgpt-session[^/]*\.json)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i;
const patterns = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const failures = [];
for (const file of files) {
  if (file === '.env.example') {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    if (text.split('\n').some(l => /^[A-Z_]*(?:KEY|SECRET|PASSWORD|TOKEN)=.+/.test(l.trim()))) failures.push(`${file}: template contains a credential value`);
    continue;
  }
  if (forbiddenPath.test(file)) { failures.push(`${file}: credential path must not be tracked`); continue; }
  const full = path.join(root, file); if (!fs.existsSync(full)) continue;
  if (fs.lstatSync(full).isSymbolicLink()) { failures.push(`${file}: review symlink before committing`); continue; }
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0) || bytes.length > 2 * 1024 * 1024) continue;
  if (patterns.some(p => p.test(bytes.toString('utf8')))) failures.push(`${file}: possible credential (value suppressed)`);
}
const mustIgnore = ['.env', '.env.local', '.env.production', 'dist/.env.local', '.vercel/project.json', '.private/auth.json', 'secrets/token.txt', 'credentials.json', 'chatgpt-host.json', 'host.enc', 'nested/accounts.enc', 'test.key'];
for (const file of mustIgnore) {
  try { execFileSync('git', ['check-ignore', '--no-index', '-q', file], { cwd: root, stdio: 'pipe' }); }
  catch { failures.push(`${file}: ignore rule is missing`); }
}
try { execFileSync('git', ['check-ignore', '--no-index', '-q', '.env.example'], { cwd: root, stdio: 'pipe' }); failures.push('.env.example must remain committable'); }
catch { /* Expected: the blank example is safe to commit. */ }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Security check passed: ${files.length} repository files; credential paths ignored; blank environment template.`);
