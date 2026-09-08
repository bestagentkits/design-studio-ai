import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import type { DesignDocument, Project } from '../src/shared/schema';
import type { DesignBrief } from '../src/shared/brief';

test('collaboration routes persist merged documents with ownership and revision protection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-collaboration-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const origin = 'https://studio.example';
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: origin, ENCRYPTION_KEY: secret(), ALLOW_REGISTRATION: 'true' };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => app.request(origin + path, {
    method, headers: { Origin: origin, ...(auth ? { Cookie: auth } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const register = async (email: string) => {
    const response = await request('/api/auth/register', 'POST', { email, password: secret() });
    assert.equal(response.status, 201, await response.clone().text());
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const projectFrom = async (response: Response, status = 200) => {
    assert.equal(response.status, status, await response.clone().text());
    return ((await response.json()) as { project: Project }).project;
  };
  const create = async () => projectFrom(await request('/api/projects', 'POST', { name: 'Collaborative design', kind: 'web' }), 201);
  const read = async (id: string) => projectFrom(await request(`/api/projects/${id}`));
  const merge = (base: Project, document: DesignDocument, auth = cookie) => request(`/api/projects/${base.id}/merge`, 'POST', { base: base.document, baseRevision: base.revision, document }, auth);
  const fail = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status, await response.clone().text());
    const body = await response.json() as { error: { code: string; details?: { paths: string[] } } };
    assert.equal(body.error.code, code); return body.error;
  };
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    cookie = await register('collaboration-owner@studio.test');
    const other = await register('collaboration-other@studio.test');

    await t.test('changes returns only the revision when unchanged and the persisted document otherwise', async () => {
      const project = await create();
      const unchanged = await request(`/api/projects/${project.id}/changes?since=${project.revision}`);
      assert.equal(unchanged.status, 200);
      assert.deepEqual(await unchanged.json(), { revision: project.revision, unchanged: true });
      const changed = await request(`/api/projects/${project.id}/changes?since=0`);
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { revision: project.revision, project });
      const local = structuredClone(project.document); local.name = 'Merged name';
      const saved = await projectFrom(await merge(project, local));
      assert.equal(saved.revision, project.revision + 1);
      const polled = await request(`/api/projects/${project.id}/changes?since=${project.revision}`);
      assert.deepEqual(await polled.json(), { revision: saved.revision, project: saved });
    });
    await t.test('both collaboration endpoints isolate other owners and unauthenticated requests', async () => {
      const project = await create(), local = structuredClone(project.document); local.name = 'Unauthorized change';
      for (const [auth, status, code] of [[other, 404, 'not_found'], ['', 401, 'unauthorized']] as const) {
        await fail(await request(`/api/projects/${project.id}/changes?since=0`, 'GET', undefined, auth), status, code);
        await fail(await merge(project, local, auth), status, code);
      }
      assert.deepEqual(await read(project.id), project);
    });
    await t.test('stale disjoint edits combine without changing the approved brief or its revision', async () => {
      const project = await create(), briefPath = `/api/projects/${project.id}/brief`;
      const response = await request(briefPath, 'PUT', { expectedRevision: 0, request: 'Create a readable landing page', interview: { message: 'Scope ready', questions: [], scope: { objective: 'Explain the product', audience: 'Founders', direction: 'Clear typography', deliverables: ['Landing page'], constraints: ['Preserve brand colors'], acceptanceCriteria: ['Visible contact action'] } } });
      assert.equal(response.status, 200, await response.clone().text());
      const initialBrief = ((await response.json()) as { brief: DesignBrief }).brief;
      const approved = await request(briefPath + '/approve', 'POST', { expectedRevision: initialBrief.revision });
      assert.equal(approved.status, 200, await approved.clone().text());
      const pinnedBrief = await approved.json() as { brief: DesignBrief };
      assert.equal(pinnedBrief.brief.status, 'approved');
      const local = structuredClone(project.document), remote = structuredClone(project.document);
      local.pages[0].nodes[0].x += 10; remote.pages[0].nodes[0].y += 20;
      const first = await projectFrom(await merge(project, remote));
      const second = await projectFrom(await merge(project, local));
      assert.equal(first.revision, project.revision + 1); assert.equal(second.revision, project.revision + 2);
      assert.equal(second.document.pages[0].nodes[0].x, local.pages[0].nodes[0].x);
      assert.equal(second.document.pages[0].nodes[0].y, remote.pages[0].nodes[0].y);
      assert.deepEqual(await (await request(briefPath)).json(), pinnedBrief);
      const reopened = new SqliteDatabase(join(directory, 'studio.sqlite'));
      try {
        const row = await reopened.prepare('SELECT document,revision FROM projects WHERE id=?').bind(project.id).first<{ document: string; revision: number }>();
        assert.equal(row!.revision, second.revision); assert.deepEqual(JSON.parse(row!.document), second.document);
        const storedBrief = await reopened.prepare('SELECT brief FROM design_briefs WHERE project_id=?').bind(project.id).first<{ brief: string }>();
        assert.deepEqual(JSON.parse(storedBrief!.brief), pinnedBrief.brief);
      } finally { reopened.close(); }
    });
    await t.test('same-field stale merges return conflict paths and leave stored state unchanged', async () => {
      const project = await create(), local = structuredClone(project.document), remote = structuredClone(project.document);
      local.pages[0].nodes[0].x += 10; remote.pages[0].nodes[0].x += 20;
      const saved = await projectFrom(await merge(project, remote));
      const error = await fail(await merge(project, local), 409, 'merge_conflict');
      assert.ok(error.details?.paths.some(path => path.endsWith(`[${local.pages[0].nodes[0].id}].x`)));
      assert.deepEqual(await read(project.id), saved);
    });
    await t.test('future revisions and mismatched project bases are rejected without writes', async () => {
      const project = await create(), another = await create();
      const payload = { base: project.document, document: project.document, baseRevision: project.revision + 1 };
      await fail(await request(`/api/projects/${project.id}/merge`, 'POST', payload), 400, 'invalid_merge_base');
      await fail(await request(`/api/projects/${project.id}/merge`, 'POST', { ...payload, baseRevision: project.revision, base: another.document }), 400, 'invalid_merge_base');
      await fail(await request(`/api/projects/${project.id}/merge`, 'POST', { ...payload, baseRevision: project.revision, document: another.document }), 400, 'invalid_merge_base');
      assert.deepEqual(await read(project.id), project);
    });
    await t.test('simultaneous disjoint edits are either merged or rejected then safely retried without lost updates', async () => {
      const project = await create(), left = structuredClone(project.document), right = structuredClone(project.document);
      left.pages[0].nodes[0].x += 30; right.pages[0].nodes[0].y += 40;
      const documents = [left, right], responses = await Promise.all(documents.map(document => merge(project, document)));
      assert.ok(responses.some(response => response.status === 200));
      for (const [index, response] of responses.entries()) {
        if (response.status === 200) await projectFrom(response);
        else { await fail(response, 409, 'revision_conflict'); await projectFrom(await merge(project, documents[index])); }
      }
      const saved = await read(project.id);
      assert.equal(saved.revision, project.revision + 2);
      assert.equal(saved.document.pages[0].nodes[0].x, left.pages[0].nodes[0].x);
      assert.equal(saved.document.pages[0].nodes[0].y, right.pages[0].nodes[0].y);
    });
    await t.test('simultaneous same-field edits acknowledge only one write', async () => {
      const project = await create(), left = structuredClone(project.document), right = structuredClone(project.document);
      left.name = 'Left edit'; right.name = 'Right edit';
      const responses = await Promise.all([merge(project, left), merge(project, right)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      const success = await projectFrom(responses.find(response => response.status === 200)!);
      const failed = await responses.find(response => response.status === 409)!.json() as { error: { code: string } };
      assert.ok(['revision_conflict', 'merge_conflict'].includes(failed.error.code));
      assert.equal(success.revision, project.revision + 1); assert.deepEqual(await read(project.id), success);
    });
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
