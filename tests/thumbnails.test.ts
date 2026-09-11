import { serve } from '@hono/node-server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { launchExportBrowser } from '../server/export-node';
import { builtStaticAssets } from './built-static-assets';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';

test('persistent covers deduplicate, survive restart, isolate owners and retain only recent revisions', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-thumbnails-')), path = join(dir, 'db.sqlite');
  let db = new SqliteDatabase(path), launches = 0, cookie = '';
  let server: ReturnType<typeof serve> | undefined;
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(dir, 'assets')), ASSETS: builtStaticAssets, APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret(), EXPORT_BROWSER: async () => { launches++; return launchExportBrowser(); } };
  const request = (path: string, method = 'GET', body?: unknown) => app.request(`https://studio.example${path}`, { method, headers: { Origin: 'https://studio.example', Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  try {
    for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(`migrations/${name}`, 'utf8'));
    const auth = await request('/api/auth/register', 'POST', { email: 'cover@studio.test', name: 'Cover tester', password: 'Cover-password-9831!' });
    assert.equal(auth.status, 201); cookie = auth.headers.get('set-cookie')!.split(';')[0];
    const doc = createDocument('web', 'Persisted cover'); doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
    const created = await request('/api/projects', 'POST', { name: doc.name, kind: doc.kind, document: doc });
    let project = (await created.json() as any).project;
    const cover = (r: number) => `/api/projects/${project.id}/thumbnail?revision=${r}`;
    const pending = request(cover(1));
    for (let i = 0; !launches && i < 200; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(launches, 1);
    assert.equal((await request(cover(1))).status, 202);
    const first = await pending; assert.equal(first.status, 200, await first.clone().text());
    const bytes = Buffer.from(await first.arrayBuffer()); assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(bytes.readUInt32BE(16) <= 480); assert.ok(bytes.readUInt32BE(20) <= 480);
    db.close(); db = new SqliteDatabase(path); env.DB = db; env.ASSETS_BUCKET = new FileBucket(join(dir, 'assets'));
    assert.deepEqual(Buffer.from(await (await request(cover(1))).arrayBuffer()), bytes); assert.equal(launches, 1);
    const coldProcess = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import {app} from './server/index.ts';
      import {SqliteDatabase,FileBucket} from './server/node-adapters.ts';
      const db=new SqliteDatabase(process.env.TEST_DATABASE);
      const response=await app.request('https://studio.example'+process.env.TEST_COVER,{headers:{Cookie:process.env.TEST_SESSION}},{DB:db,ASSETS_BUCKET:new FileBucket(process.env.TEST_BUCKET),APP_URL:'https://studio.example'});
      console.log(JSON.stringify({status:response.status,image:Buffer.from(await response.arrayBuffer()).toString('base64')}));db.close();
    `], { env: { ...process.env, TEST_DATABASE: path, TEST_BUCKET: join(dir, 'assets'), TEST_SESSION: cookie, TEST_COVER: cover(1) } });
    const restarted = JSON.parse(coldProcess.stdout); assert.equal(restarted.status, 200); assert.deepEqual(Buffer.from(restarted.image, 'base64'), bytes);

    const list = await (await request('/api/projects')).json() as any; assert.equal(list.projects[0].thumbnailRevision, 1); assert.equal(list.projects[0].thumbnailUrl, cover(1));
    assert.match(first.headers.get('Cache-Control')!, /private/);
    const issued = await request('/api/tokens', 'POST', { name: 'Thumbnail parity' });
    const token = (await issued.json() as any).token;
    const rpc = await app.request('https://studio.example/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_project_thumbnail', arguments: { projectId: project.id, revision: 1 } } }) }, env);
    const result = (await rpc.json() as any).result; assert.equal(result.content[0].type, 'image'); assert.deepEqual(Buffer.from(result.content[0].data, 'base64'), bytes);
    server = serve({ fetch: req => app.fetch(req, env), hostname: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address() as { port: number }, output = join(dir, 'cover.png');
    await promisify(execFile)(process.execPath, ['packages/cli/dist/dsa.js', 'projects', 'thumbnail', project.id, '--revision', '1', '--output', output], { env: { ...process.env, DESIGN_STUDIO_API_KEY: token, DESIGN_STUDIO_URL: `http://127.0.0.1:${address.port}` } });
    assert.deepEqual(await readFile(output), bytes); assert.equal(launches, 1);
    const ownCookie = cookie; cookie = ''; assert.equal((await request(cover(1))).status, 401);
    const stranger = await request('/api/auth/register', 'POST', { email: 'other-cover@studio.test', name: 'Other', password: 'Cover-password-9831!' }); cookie = stranger.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request(cover(1))).status, 404); cookie = ownCookie;
    for (const revision of [2, 3]) {
      project.document.pages[0].background = revision === 2 ? '#3344ee' : '#ee4433';
      const saved = await request(`/api/projects/${project.id}/document`, 'PUT', { document: project.document, expectedRevision: project.revision }); assert.equal(saved.status, 200); project = (await saved.json() as any).project;
      assert.equal(project.thumbnailRevision, revision - 1);
      const image = await request(cover(revision)); assert.equal(image.status, 200, await image.clone().text());
      assert.notDeepEqual(Buffer.from(await image.arrayBuffer()), bytes);
    }
    const records = await db.prepare("SELECT storage_key FROM project_thumbnails WHERE project_id=? AND state='ready'").bind(project.id).all<{ storage_key: string }>(); assert.equal(records.results.length, 2);
    assert.equal((await request(cover(1))).status, 404); assert.equal((await request(cover(4))).status, 400);
    assert.equal((await request(`/api/projects/${project.id}`, 'DELETE')).status, 200);
    for (const row of records.results) assert.equal(await env.ASSETS_BUCKET.get(row.storage_key), null);
    assert.equal((await request(cover(3))).status, 404);
    const badDoc = createDocument('web', 'External media'); badDoc.theme.fonts = { heading: 'Arial', body: 'Arial' };
    badDoc.pages[0].nodes.push({ id: 'external', type: 'image', name: 'External', x: 0, y: 0, width: 100, height: 100, src: 'https://example.com/private.png' });
    const bad = (await (await request('/api/projects', 'POST', { name: badDoc.name, kind: badDoc.kind, document: badDoc })).json() as any).project;
    const badUrl = `/api/projects/${bad.id}/thumbnail`;
    assert.equal((await request(badUrl)).status, 400); assert.equal((await request(badUrl)).status, 503);
    assert.equal((await request(`/api/projects/${bad.id}`, 'DELETE')).status, 200);
    const next = (await (await request('/api/projects', 'POST', { name: doc.name, kind: doc.kind, document: doc })).json() as any).project;
    await db.prepare("INSERT INTO project_thumbnails(project_id,revision,state,lease_token,lease_until) VALUES(?,1,'rendering','expired-worker',0)").bind(next.id).run();
    const previousLaunches = launches, deletedWhileRendering = request(`/api/projects/${next.id}/thumbnail`);
    for (let i = 0; launches === previousLaunches && i < 200; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(launches, previousLaunches + 1, 'An expired worker lease is recoverable');
    const lease = await db.prepare('SELECT lease_token FROM project_thumbnails WHERE project_id=?').bind(next.id).first<{ lease_token: string }>();
    await db.prepare('UPDATE projects SET thumbnail_deleting=1 WHERE id=?').bind(next.id).run();
    assert.equal((await request(`/api/projects/${next.id}/thumbnail`)).status, 404);
    assert.equal((await deletedWhileRendering).status, 409, 'Deletion intent blocks publication before the storage key snapshot');
    assert.equal((await request(`/api/projects/${next.id}`, 'DELETE')).status, 200);
    assert.equal(await env.ASSETS_BUCKET.get(`thumbnails/${next.id}/1/${lease!.lease_token}`), null, 'Late output cannot orphan a deleted project cover');

  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); db.close(); await rm(dir, { recursive: true, force: true }); }
});
