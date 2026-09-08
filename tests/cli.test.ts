import { builtStaticAssets } from './built-static-assets';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import { documentSchema } from '../src/shared/schema';

const executable = resolve('packages/cli/dist/dsa.js');
let directory: string;
let database: SqliteDatabase;
let server: ReturnType<typeof serve>;
let baseUrl: string;
let apiKey: string;

function run(args: string[], options: { input?: string; token?: string; executable?: string; url?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [options.executable ?? executable, ...args], {
      env: { ...process.env, DESIGN_STUDIO_API_KEY: options.token ?? apiKey ?? '', DESIGN_STUDIO_URL: options.url ?? baseUrl ?? 'http://127.0.0.1:1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('CLI test subprocess exceeded 30 seconds')); }, 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); resolveRun({ code: code ?? -1, stdout, stderr }); });
    child.stdin.end(options.input ?? '');
  });
}
async function json(args: string[], options: Parameters<typeof run>[1] = {}) {
  const result = await run(args, options);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

before(async () => {
  const built = await run([], { executable: resolve('packages/cli/build.mjs') });
  assert.equal(built.code, 0, built.stderr);
  directory = await mkdtemp(join(tmpdir(), 'dsa-cli-test-'));
  database = new SqliteDatabase(join(directory, 'studio.sqlite'));
  for (const name of (await readdir(resolve('migrations'))).filter(name => name.endsWith('.sql')).sort()) await database.exec(await readFile(resolve('migrations', name), 'utf8'));
  const bindings: Bindings = { ASSETS: builtStaticAssets, DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  server = serve({ fetch: request => app.fetch(request, bindings), hostname: '127.0.0.1', port: 0 });
  await new Promise<void>(resolveListening => { if (server.listening) resolveListening(); else server.once('listening', resolveListening); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`; bindings.APP_URL = baseUrl;
  const response = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'cli-owner@example.test', password: 'test-password-for-cli-123', name: 'CLI owner' }) });
  assert.equal(response.status, 201, await response.text());
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
  const tokenResponse = await fetch(`${baseUrl}/api/tokens`, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CLI test' }) });
  assert.equal(tokenResponse.status, 201);
  apiKey = (await tokenResponse.json() as { token: string }).token;
});
after(async () => {
  if (server) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  database?.close();
  if (directory) { assert.equal(resolve(directory).startsWith(resolve(tmpdir())), true); assert.ok(basename(directory).startsWith('dsa-cli-test-')); await rm(directory, { recursive: true, force: true }); }
});

test('CLI persists a versioned brief, approves scope and reads deterministic design checks', async () => {
  const created = await json(['projects','create','--name','Interview contract','--kind','web']);
  const projectId=created.project.id;
  const scope={objective:'Explain a ceramics class',audience:'Local beginners',direction:'Calm and tactile',deliverables:['One landing page'],constraints:['Use supplied copy'],acceptanceCriteria:['Readable type']};
  const begun=await json(['brief','put',projectId,'--revision','0','--file','-'],{input:JSON.stringify({request:'Create a ceramics class landing page',interview:{message:'Who is it for?',questions:[{id:'audience',title:'Audience',description:'',type:'text',options:[],required:true}],scope}})});
  assert.equal(begun.brief.status,'interview');
  const incomplete=await run(['brief','approve',projectId,'--revision','1']);
  assert.notEqual(incomplete.code,0);
  const answered=await json(['brief','put',projectId,'--revision','1','--file','-'],{input:JSON.stringify({answers:{audience:'Local beginners'}})});
  assert.equal(answered.brief.status,'ready');
  const approved=await json(['brief','approve',projectId,'--revision','2']);
  assert.equal(approved.brief.status,'approved');
  assert.equal((await json(['brief','get',projectId])).brief.revision,3);
  assert.notEqual((await run(['brief','approve',projectId,'--revision','2'])).code,0);
  const checks=await json(['projects','check',projectId]);
  assert.equal(checks.projectId,projectId);
  assert.equal(checks.revision,created.project.revision);
  assert.ok(Array.isArray(checks.issues)&&Array.isArray(checks.limitations));
});

test('standalone built executable prints help and version without checkout dependencies', async () => {
  const standalone = join(directory, 'standalone.mjs'); await copyFile(executable, standalone);
  const help = await run(['--help'], { executable: standalone });
  assert.equal(help.code, 0); assert.match(help.stdout, /projects/); assert.match(help.stdout, /google-slides/);
  const version = await run(['--version'], { executable: standalone }); assert.equal(version.code, 0); assert.equal(version.stdout.trim(), '0.2.3');
});

test('schema and templates use the actual shared document format', async () => {
  const schema = await json(['schema']); assert.equal(schema.schema.properties.schemaVersion.const, 1);
  const operationSchema = await json(['schema', '--operations']); assert.equal(operationSchema.schema.type, 'array');
  const catalog = await json(['templates', 'list']);
  for (const template of catalog.templates) {
    const document = await json(['templates', 'instantiate', template.id]);
    const parsed = documentSchema.parse(document); assert.equal(parsed.kind, template.kind); assert.ok(parsed.pages[0].nodes.length);
  }
});

test('offline rendering accepts canonical JSON on stdin without authentication', async () => {
  const document = await json(['templates', 'instantiate', 'product-deck']);
  const rendered = await run(['render', '--file', '-', '--format', 'svg', '--page', '1'], { input: JSON.stringify(document), token: '' });
  assert.equal(rendered.code, 0, rendered.stderr); assert.match(rendered.stdout, /^<svg /); assert.match(rendered.stdout, /A clear perspective/);
});

test('invalid commands, insecure origins, and missing tokens return useful nonzero JSON errors', async () => {
  const bad = await run(['does-not-exist']); assert.equal(bad.code, 1); assert.equal(JSON.parse(bad.stderr).error.code, 'invalid_command');
  const missing = await run(['projects', 'list'], { token: '' }); assert.equal(missing.code, 2); assert.equal(JSON.parse(missing.stderr).error.code, 'authentication_required');
  const insecure = await run(['health'], { url: 'http://untrusted.example' }); assert.equal(insecure.code, 1); assert.equal(JSON.parse(insecure.stderr).error.code, 'invalid_url');
  const escape = await run(['api', 'GET', '/api/../oauth/token']); assert.equal(escape.code, 1); assert.equal(JSON.parse(escape.stderr).error.code, 'invalid_path');
  const unsupported = await run(['projects', 'export', 'not-read', '--format', 'jpeg']); assert.equal(unsupported.code, 1); assert.equal(JSON.parse(unsupported.stderr).error.code, 'unsupported_format');
  const binary = await run(['projects', 'export', 'not-read', '--format', 'pdf']); assert.equal(binary.code, 1); assert.equal(JSON.parse(binary.stderr).error.code, 'file_required');
});

test('real SQLite project edits use stdin operations and reject stale revisions without losing changes', async () => {
  assert.equal((await json(['health'])).ok, true);
  const created = (await json(['projects', 'create', '--name', 'CLI deck', '--template', 'product-deck'])).project;
  const node = created.document.pages[0].nodes.find((value: any) => value.type === 'text');
  const edits = [{ op: 'update-node', nodeId: node.id, changes: { text: 'Saved through CLI' } }];
  const saved = (await json(['projects', 'document', 'patch', created.id, '--revision', '1', '--file', '-'], { input: JSON.stringify(edits) })).project;
  assert.equal(saved.revision, 2); assert.equal(saved.document.pages[0].nodes.find((value: any) => value.id === node.id).text, 'Saved through CLI');
  const conflict = await run(['projects', 'document', 'patch', created.id, '--revision', '1', '--file', '-'], { input: JSON.stringify([{ op: 'rename', name: 'Must not win' }]) });
  assert.equal(conflict.code, 1); assert.equal(JSON.parse(conflict.stderr).error.code, 'revision_conflict');
  const loaded = (await json(['projects', 'get', created.id])).project; assert.equal(loaded.name, 'CLI deck'); assert.equal(loaded.revision, 2);
  const renamed = (await json(['projects', 'rename', created.id, 'Renamed safely', '--revision', '2'])).project; assert.equal(renamed.revision, 3);
  const exported = join(directory, 'deck.svg'); await json(['projects', 'export', created.id, '--format', 'svg', '--output', exported]);
  const svg = await readFile(exported, 'utf8'); assert.match(svg, /^<svg /); assert.match(svg, /Saved through CLI/);
  const preview = await json(['preview', created.id]); assert.equal((await fetch(preview.url)).status, 200);
  await json(['unpreview', created.id]); assert.equal((await fetch(preview.url)).status, 404);
  const share = await json(['share', created.id]); assert.equal((await fetch(share.url)).status, 200);
  await json(['unshare', created.id]); assert.equal((await fetch(share.url)).status, 404);
  const invalid = await run(['projects', 'document', 'put', created.id, '--revision', '3', '--file', '-'], { input: '{}' });
  assert.equal(invalid.code, 1); assert.equal(JSON.parse(invalid.stderr).error.code, 'invalid_document');
  const unconfigured = await run(['projects', 'export', created.id, '--format', 'png', '--output', join(directory, 'unavailable.png')]);
  assert.equal(unconfigured.code, 1); assert.equal(JSON.parse(unconfigured.stderr).error.code, 'renderer_not_configured');
});

test('asset clone copies bytes and static exports embed images after deleting source', async () => {
  const created = (await json(['projects', 'create', '--name', 'Source with asset'])).project;
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const originalFile = join(directory, 'pixel.png'); await writeFile(originalFile, pixel);
  const asset = (await json(['assets', 'upload', created.id, '--file', originalFile])).asset;
  assert.equal((await json(['assets', 'list', created.id])).assets.length, 1);
  created.document.assets.push(asset);
  created.document.pages[0].nodes.push({ id: 'cli-test-image', type: 'image', name: 'Pixel', x: 0, y: 0, width: 1, height: 1, src: asset.url });
  await json(['projects', 'document', 'put', created.id, '--revision', '1', '--file', '-'], { input: JSON.stringify(created.document) });
  const clone = (await json(['projects', 'clone', created.id, '--name', 'Independent clone'])).project;
  assert.notEqual(clone.document.assets[0].id, asset.id); assert.notEqual(clone.document.assets[0].url, asset.url);
  await json(['projects', 'delete', created.id]);
  const downloaded = join(directory, 'cloned-pixel.png'); await json(['assets', 'download', clone.document.assets[0].id, '--output', downloaded]);
  assert.deepEqual(await readFile(downloaded), pixel);
  const exported = await run(['projects', 'export', clone.id, '--format', 'html']); assert.equal(exported.code, 0, exported.stderr); assert.match(exported.stdout, /data:image\/png;base64,/);
  const publication = await json(['publish', clone.id]); assert.equal((await fetch(publication.url)).status, 200);
  await json(['unpublish', clone.id]); assert.equal((await fetch(publication.url)).status, 404);
});

test('token revocation invalidates actual CLI authentication', async () => {
  const created = await json(['tokens', 'create', '--name', 'Disposable token']);
  assert.equal((await json(['projects', 'list'], { token: created.token })).projects instanceof Array, true);
  assert.equal((await json(['--api-key', created.token, 'projects', 'list'], { token: '' })).projects instanceof Array, true);
  await json(['tokens', 'revoke', created.id]);
  const denied = await run(['projects', 'list'], { token: created.token });
  assert.equal(denied.code, 2); assert.equal(denied.stderr.includes(created.token), false);
});
