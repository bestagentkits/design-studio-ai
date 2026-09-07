import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
const port = Number(process.env.E2E_PORT || 8791);
const origin = `http://127.0.0.1:${port}`;
await new Promise((accept, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(accept)); });
const directory = await mkdtemp(join(tmpdir(), 'studio-e2e-'));
const env = { ...process.env, PORT: String(port), APP_URL: origin, HOST: '127.0.0.1', DATA_DIR: directory, ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: randomBytes(32).toString('base64'), E2E_BASE_URL: origin };
const server = spawn(process.execPath, ['--import', 'tsx', 'server/node.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
server.stdout.on('data', data => process.stdout.write(data)); server.stderr.on('data', data => process.stderr.write(data));
console.log(`E2E server PID ${server.pid}, port ${port}, temporary database`);
let exitCode = 1, runner;
const terminate = () => { runner?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('E2E server exited before becoming ready');
    try { ready = (await fetch(origin + '/api/health')).ok; } catch { /* Startup has not bound the port yet. */ }
    if (ready) break;
    await new Promise(accept => setTimeout(accept, 100));
  }
  if (!ready) throw new Error('E2E server failed to start');
  runner = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
  exitCode = await new Promise(accept => runner.once('exit', code => accept(code ?? 1)));
} finally {
  const exited = new Promise(accept => { if (server.exitCode !== null) accept(); else server.once('exit', accept); });
  server.kill('SIGTERM'); await exited;
  const target = resolve(directory), temporaryRoot = resolve(tmpdir()) + sep;
  if (!target.startsWith(temporaryRoot) || !target.split(sep).pop().startsWith('studio-e2e-')) throw new Error('Unexpected test cleanup path');
  await rm(target, { recursive: true, force: true });
}
process.exitCode = exitCode;
