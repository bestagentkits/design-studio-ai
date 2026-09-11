import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../server/index';
import { SqliteDatabase, FileBucket } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import type { Project } from '../src/shared/schema';
import { paintingSchema } from '../src/shared/painting-schema';
import { upgradeDocument } from '../src/shared/document-upgrade';
import { decodePaintTile } from '../src/shared/paint-png';

test('painting commands commit real pixels with ownership, CAS and durable retry identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'painting-commands-'));
  const db = new SqliteDatabase(join(directory, 'db.sqlite')), bucket = new FileBucket(join(directory, 'assets'));
  const origin = 'https://studio.example', env: Bindings = { DB: db, ASSETS_BUCKET: bucket, APP_URL: origin, ENCRYPTION_KEY: secret(), ALLOW_REGISTRATION: 'true' };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => app.request(origin + path, { method, headers: { Origin: origin, Cookie: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  const projectFrom = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return (await response.json() as { project: Project }).project; };
  const rejects = async (response: Response, status: number, code: string) => { assert.equal(response.status, status, await response.clone().text()); assert.match(await response.text(), new RegExp(code)); };
  const pixels = async (project: Project) => {
    assert.equal(project.document.schemaVersion, 2); if (project.document.schemaVersion !== 2) throw new Error('Missing painting');
    const tile = project.document.paintings[0].layers[0].tiles[0]; assert.ok(tile);
    const row = await db.prepare('SELECT storage_key FROM assets WHERE id=? AND project_id=?').bind(tile.assetId, project.id).first<{ storage_key: string }>(); assert.ok(row);
    const blob = await bucket.get(row.storage_key); assert.ok(blob); return decodePaintTile(new Uint8Array(await blob.arrayBuffer()));
  };
  const assetCount = async (projectId: string) => (await db.prepare('SELECT COUNT(*) AS count FROM assets WHERE project_id=?').bind(projectId).first<{ count: number }>())!.count;
  const generation = (project: Project) => project.document.schemaVersion === 2 ? project.document.paintings[0].generation : -1;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const registration = await request('/api/auth/register', 'POST', { email: 'command-owner@studio.test', password: secret() }); assert.equal(registration.status, 201); cookie = registration.headers.get('set-cookie')!.split(';')[0];
    let project = await projectFrom(await request('/api/projects', 'POST', { name: 'Command paint', kind: 'web' }), 201);
    const doc = upgradeDocument(project.document); doc.paintings.push(paintingSchema.parse({ id: 'paint', name: 'Paint', width: 512, height: 512, generation: 0, colorSpace: 'srgb', algorithm: 'cpu-srgb-grain-v1', tileSize: 512, layers: [{ id: 'layer', name: 'Layer', visible: true, locked: false, opacity: 1, blend: 'normal', tiles: [] }] }));
    project = await projectFrom(await request(`/api/projects/${project.id}/document`, 'PUT', { document: doc, expectedRevision: project.revision }));
    const route = `/api/projects/${project.id}/paint`, command = { expectedRevision: project.revision, expectedGeneration: generation(project), operationId: 'red-stroke', paintingId: 'paint', layerId: 'layer', action: { type: 'stroke', preset: 'bristle', size: 32, flow: 1, color: '#ff0000', seed: 7, points: [{ x: 80, y: 80, pressure: 1 }, { x: 120, y: 80, pressure: 1 }] } };
    await t.test('unauthenticated and different-owner requests cannot execute paint', async () => {
      await rejects(await request(route, 'POST', command, ''), 401, 'unauthorized');
      const registered = await request('/api/auth/register', 'POST', { email: 'command-other@studio.test', password: secret() }); assert.equal(registered.status, 201); const other = registered.headers.get('set-cookie')!.split(';')[0];
      await rejects(await request(route, 'POST', command, other), 404, 'not_found');
    });
    await t.test('stroke stores nontransparent red pixels and a server composite', async () => {
      const before = project; project = await projectFrom(await request(route, 'POST', command));
      assert.equal(project.revision, before.revision + 1); assert.equal(generation(project), generation(before) + 1);
      const output = await pixels(project); let colored = 0;
      for (let y = 60; y < 100; y++) for (let x = 60; x < 140; x++) { const index = (y * 512 + x) * 4; if (output[index + 3]) { assert.ok(output[index] > output[index + 1]); colored++; } }
      assert.ok(colored > 100); assert.equal(output[3], 0);
      assert.ok(project.document.schemaVersion === 2 && project.document.paintings[0].composite);
    });
    await t.test('exact retry returns identical receipt with no new assets; changed payload conflicts', async () => {
      const count = await assetCount(project.id), retry = await projectFrom(await request(route, 'POST', command)); assert.deepEqual(retry, project); assert.equal(await assetCount(project.id), count);
      await rejects(await request(route, 'POST', { ...command, action: { ...command.action, color: '#0000ff' } }), 409, 'operation_id_conflict');
      assert.equal(await assetCount(project.id), count);
    });
    await t.test('stale document revision and painting generation fail without uploads', async () => {
      const count = await assetCount(project.id);
      await rejects(await request(route, 'POST', { ...command, operationId: 'stale-doc' }), 409, 'revision_conflict');
      await rejects(await request(route, 'POST', { ...command, operationId: 'stale-paint', expectedRevision: project.revision }), 409, 'painting_generation_conflict');
      assert.equal(await assetCount(project.id), count);
    });
    await t.test('fill changes actual selected pixels and preserves stroke pixels outside selection', async () => {
      const before = await pixels(project);
      project = await projectFrom(await request(route, 'POST', { operationId: 'blue-fill', expectedRevision: project.revision, expectedGeneration: generation(project), paintingId: 'paint', layerId: 'layer', selection: { kind: 'rectangle', points: [{ x: 200, y: 200 }, { x: 208, y: 208 }], feather: 0 }, action: { type: 'fill', x: 202, y: 202, color: [0, 0, 255, 255], tolerance: 0, contiguous: true } }));
      const after = await pixels(project); assert.deepEqual([...after.slice((202 * 512 + 202) * 4, (202 * 512 + 202) * 4 + 4)], [0, 0, 255, 255]);
      assert.deepEqual(after.slice((80 * 512 + 100) * 4, (80 * 512 + 100) * 4 + 4), before.slice((80 * 512 + 100) * 4, (80 * 512 + 100) * 4 + 4));
      assert.equal(after[(199 * 512 + 202) * 4 + 3], 0);
    });
    await t.test('stale brief guard does not change the saved document', async () => {
      const brief = await request(`/api/projects/${project.id}/brief`, 'PUT', { expectedRevision: 0, request: 'Keep selected paint' }); assert.equal(brief.status, 200, await brief.clone().text());
      const revision = project.revision, count = await assetCount(project.id);
      await rejects(await request(route, 'POST', { ...command, operationId: 'stale-brief', expectedRevision: project.revision, expectedGeneration: generation(project), expectedBriefRevision: 0 }), 409, 'revision_conflict');
      assert.equal((await projectFrom(await request(`/api/projects/${project.id}`))).revision, revision);
      assert.equal(await assetCount(project.id), count, 'Stale brief must be rejected before creating tile or composite assets');
    });
    await t.test('actual canvas bounds and invalid lasso reject before work', async () => {
      const count = await assetCount(project.id), current = { ...command, expectedRevision: project.revision, expectedGeneration: generation(project) };
      await rejects(await request(route, 'POST', { ...current, operationId: 'outside', action: { ...command.action, points: [{ x: 900, y: 1, pressure: 1 }] } }), 400, 'invalid_paint_point');
      await rejects(await request(route, 'POST', { ...current, operationId: 'invalid-lasso', selection: { kind: 'lasso', points: [{ x: 0, y: 0 }, { x: 3, y: 3 }], feather: 0 } }), 400, 'invalid_paint_selection');
      assert.equal(await assetCount(project.id), count);
    });
    await t.test('alpha lock preserves every pixel alpha and refuses erase', async () => {
      const locked = upgradeDocument(project.document); locked.paintings[0].layers[0].alphaLock = true; locked.paintings[0].generation++; delete locked.paintings[0].composite;
      project = await projectFrom(await request(`/api/projects/${project.id}/document`, 'PUT', { document: locked, expectedRevision: project.revision }));
      const before = await pixels(project);
      project = await projectFrom(await request(route, 'POST', { ...command, operationId: 'alpha-paint', expectedRevision: project.revision, expectedGeneration: generation(project), action: { ...command.action, color: '#00ff00' } }));
      const after = await pixels(project); let changed = false;
      for (let i = 3; i < before.length; i += 4) { assert.equal(after[i], before[i]); if (after[i - 2] !== before[i - 2]) changed = true; }
      assert.ok(changed, 'Painting still changes color inside existing alpha');
      await rejects(await request(route, 'POST', { ...command, operationId: 'alpha-erase', expectedRevision: project.revision, expectedGeneration: generation(project), action: { ...command.action, preset: 'erase' } }), 409, 'paint_alpha_locked');
    });
    await t.test('locked layer rejects command before raster uploads', async () => {
      const locked = upgradeDocument(project.document); locked.paintings[0].layers[0].locked = true; locked.paintings[0].generation++; delete locked.paintings[0].composite;
      project = await projectFrom(await request(`/api/projects/${project.id}/document`, 'PUT', { document: locked, expectedRevision: project.revision }));
      const count = await assetCount(project.id);
      await rejects(await request(route, 'POST', { ...command, operationId: 'locked', expectedRevision: project.revision, expectedGeneration: generation(project) }), 409, 'paint_layer_locked'); assert.equal(await assetCount(project.id), count);
    });
    for (const table of ['asset_reservations', 'creative_work_leases']) assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())!.count, 0);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
