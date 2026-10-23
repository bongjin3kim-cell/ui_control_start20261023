import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
export class PrivateStore {
  constructor({ directory = path.join(os.homedir(), '.config', 'mcp-ui-lab-chatgpt'), projectRoot } = {}) {
    this.directory = path.resolve(directory); this.projectRoot = projectRoot && path.resolve(projectRoot);
    if (this.projectRoot && inside(this.projectRoot, this.directory)) throw new Error('Credential storage must be OUTSIDE the project.');
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe credential directory.');
    this.directory = await fs.realpath(this.directory);
    if (this.projectRoot && inside(await fs.realpath(this.projectRoot), this.directory)) throw new Error('Credential storage resolves inside the project.');
    await fs.chmod(this.directory, 0o700);
    const keyPath = path.join(this.directory, 'storage.key');
    try { await fs.writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const keyStat = await fs.lstat(keyPath);
    if (!keyStat.isFile() || keyStat.isSymbolicLink() || (process.getuid && keyStat.uid !== process.getuid())) throw new Error('Unsafe credential key.');
    await fs.chmod(keyPath, 0o600); this.key = await fs.readFile(keyPath);
    if (this.key.length !== 32) throw new Error('Invalid credential key.');
    let host = await this.read('host.enc');
    if (!host) { host = { hostId: `urn:uuid:${randomUUID()}` }; await this.write('host.enc', host); }
    this.hostId = host.hostId;
    if (!/^urn:uuid:[a-f0-9-]{36}$/.test(this.hostId)) throw new Error('Invalid saved host identifier.');
    this.sessionSecret = createHmac('sha256', this.key).update('mcp-ui-lab/browser-session/v1').digest('base64url');
    return this;
  }
  async read(name) {
    if (!/^[a-z-]+\.enc$/.test(name)) throw new Error('Invalid private filename.');
    let bytes;
    try {
      const file = path.join(this.directory, name); const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe credential record.');
      await fs.chmod(file, 0o600); bytes = await fs.readFile(file);
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const data = JSON.parse(bytes);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from(`mcp-ui-lab:${name}:v1`)); decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body, 'base64')), decipher.final()]).toString('utf8'));
  }
  async write(name, value) {
    if (!/^[a-z-]+\.enc$/.test(name)) throw new Error('Invalid private filename.');
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`mcp-ui-lab:${name}:v1`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const bytes = JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: encrypted.toString('base64') });
    const tmp = path.join(this.directory, `.write-${randomUUID()}`); const target = path.join(this.directory, name);
    try { await fs.writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(tmp, target); await fs.chmod(target, 0o600); }
    finally { await fs.rm(tmp, { force: true }); }
  }
  async update(mutator) {
    const operation = this.queue.then(async () => {
      const records = await this.read('accounts.enc') || { active: null, profiles: [] };
      const result = await mutator(records); await this.write('accounts.enc', records); return result;
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async accounts() { await this.queue; return await this.read('accounts.enc') || { active: null, profiles: [] }; }
}
