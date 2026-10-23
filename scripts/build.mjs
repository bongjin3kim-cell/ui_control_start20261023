import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Only these maintained public assets can enter a deployment. Never copy the
// entire workspace or process.env: ignored local files may contain credentials.
const publicFiles = ['index.html', 'style.css', 'app.js', 'chat.css', 'chat.js', 'snapshot.js', 'release.css'];

export async function build({ root = projectRoot, env = process.env, now = new Date() } = {}) {
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid package version.');
  let commit = env.VERCEL_GIT_COMMIT_SHA || '';
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { /* A source ZIP may have no Git metadata. */ }
  }
  if (commit && !/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error('Invalid Git commit metadata.');
  const builtAt = now.toISOString();
  const korea = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  const timeLabel = `${korea.slice(0, 10).replaceAll('-', '.')} ${korea.slice(11, 19)} KST`;
  const versionLabel = `ver ${version} · ${commit ? commit.slice(0, 7) : 'local'}`;
  const output = path.join(root, 'build');
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  for (const name of publicFiles) {
    const source = path.join(root, 'dist', name);
    if (!(await fs.lstat(source)).isFile()) throw new Error('Public assets must be regular files.');
    let contents = await fs.readFile(source, 'utf8');
    if (name === 'index.html') {
      if ((contents.match(/data-release-version>/g) || []).length !== 2 || !contents.includes('<time data-release-time>')) throw new Error('Release display markers are missing.');
      contents = contents.replace(/(<span[^>]*\bdata-release-version>)[^<]*(<\/span>)/g, `$1${versionLabel}$2`)
        .replace(/<time data-release-time>[^<]*<\/time>/, `<time data-release-time datetime="${builtAt}" title="${builtAt}">${timeLabel}</time>`);
    }
    await fs.writeFile(path.join(output, name), contents);
  }
  const metadata = { schemaVersion: 1, version, commit: commit || null, builtAt };
  await fs.writeFile(path.join(output, 'version.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metadata = await build();
  console.log(`Built ver ${metadata.version} · ${metadata.commit?.slice(0, 7) || 'local'} · ${metadata.builtAt}`);
}
