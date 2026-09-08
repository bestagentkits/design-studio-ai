import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase, staticAssets } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import type { Bindings } from '../server/types';

test('public slide HTML excludes speaker notes without removing owner notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-notes-')), database = new SqliteDatabase(':memory:');
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const bindings: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ASSETS: staticAssets(resolve('public')), APP_URL: 'https://studio.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, anonymous = false) => app.request(`https://studio.example${path}`, { method, headers: { Origin: 'https://studio.example', 'Content-Type': 'application/json', ...(anonymous ? {} : { Cookie: cookie }) }, ...(body ? { body: JSON.stringify(body) } : {}) }, bindings);
  try {
    const registration = await request('/api/auth/register', 'POST', { email: 'notes@example.com', password: 'Private speaker notes regression' }); assert.equal(registration.status, 201); cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const document = createDocument('slides', 'Public slides'); document.pages[0].notes = 'PRIVATE-SPEAKER-NOTES-9182';
    const created = await request('/api/projects', 'POST', { name: document.name, kind: document.kind, document }); assert.equal(created.status, 201);
    const { project } = await created.json() as { project: { id: string } };
    const publication = await request(`/api/projects/${project.id}/publish`, 'POST', {}); assert.equal(publication.status, 200);
    const { url } = await publication.json() as { url: string };
    const html = await (await request(new URL(url).pathname, 'GET', undefined, true)).text();
    assert.ok(html.includes('studio-document')); assert.ok(!html.includes('PRIVATE-SPEAKER-NOTES-9182'));
    const owned = await (await request(`/api/projects/${project.id}`)).json() as { project: { document: typeof document } };
    assert.equal(owned.project.document.pages[0].notes, 'PRIVATE-SPEAKER-NOTES-9182');
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});
