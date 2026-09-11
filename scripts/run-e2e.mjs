import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
// Each device gets a fresh database and rate-limit bucket, preserving production limits.
if (!process.argv.slice(2).some(argument => argument === '--project' || argument.startsWith('--project='))) {
  let code = 0, interrupted = false;
  for (const project of ['desktop', 'mobile']) {
    const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2), `--project=${project}`], {stdio:'inherit',env:process.env,windowsHide:true});
    const stop = () => { interrupted = true; child.kill('SIGTERM'); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    const result = await new Promise(accept => child.once('exit', value => accept(value ?? 1)));
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    if (result !== 0) code = Number(result);
    if (interrupted) break;
  }
  process.exit(code);
}
// Authentication limits are production behavior; independent specs receive independent databases.
if (!process.env.STUDIO_E2E_SPEC_ISOLATED) {
  const args = process.argv.slice(2), requested = args.filter(arg => arg.endsWith('.spec.ts'));
  const files = requested.length ? requested : (await readdir('tests')).filter(name => name.endsWith('.spec.ts')).sort().map(name => `tests/${name}`);
  let result = 0, interrupted = false;
  for (const file of files) {
    const project = args.find(arg => arg.startsWith('--project='))?.split('=')[1] || args[args.indexOf('--project') + 1] || 'selected';
    const output = args.some(arg => arg === '--output' || arg.startsWith('--output=')) ? [] : [`--output=test-results/${project}/${file.split('/').at(-1).replace(/\.spec\.ts$/, '')}`];
    const child = spawn(process.execPath, [process.argv[1], ...args.filter(arg => !requested.includes(arg)), file, ...output], { stdio: 'inherit', env: { ...process.env, STUDIO_E2E_SPEC_ISOLATED: '1' } });
    const stop = () => { interrupted = true; child.kill('SIGTERM'); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const code = await new Promise(resolve => child.once('exit', value => resolve(value ?? 1)));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (code !== 0) result = Number(code);
    if (interrupted) break;
  }
  process.exit(result);
}
const port = Number(process.env.E2E_PORT || 8791);
const origin = `http://127.0.0.1:${port}`;
await new Promise((accept, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(accept)); });
const directory = await mkdtemp(join(tmpdir(), 'studio-e2e-'));
// The isolated test server uses this reserved origin for settings persistence only.
const testProviderOrigins = 'https://browser-provider.example';
const env = { ...process.env, PORT: String(port), APP_URL: origin, HOST: '127.0.0.1', DATA_DIR: directory, ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: randomBytes(32).toString('base64'), E2E_BASE_URL: origin };
const server = spawn(process.execPath, ['--import', 'tsx', 'server/node.ts'], { env: { ...env, PROVIDER_ALLOWED_ORIGINS: testProviderOrigins }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let listening = false, startupOutput = '';
server.stdout.on('data', data => { startupOutput += data.toString(); listening = startupOutput.includes(`Design Studio AI listening on ${origin}`); process.stdout.write(data); });
server.stderr.on('data', data => process.stderr.write(data));
console.log(`E2E server PID ${server.pid}, port ${port}, temporary database`);
let exitCode = 1, runner;
const terminate = () => { runner?.kill('SIGTERM'); server.kill('SIGTERM'); };
process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('E2E server exited before becoming ready');
    try { ready = listening && (await fetch(origin + '/api/health')).ok && server.exitCode === null; } catch { /* Startup has not bound the port yet. */ }
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
