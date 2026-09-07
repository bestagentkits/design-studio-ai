import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { interviewSchema, type DesignBrief, type DesignScope, type Interview } from '../src/shared/brief';
import type { Project } from '../src/shared/schema';
import type { Bindings } from '../server/types';

test('persisted project interviews require explicit scope approval and preserve optimistic concurrency', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-briefs-'));
  const db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const base = 'https://studio.example';
  const env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: base, ENCRYPTION_KEY: secret(), ALLOW_REGISTRATION: 'true' };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => app.request(base + path, {
    method, headers: { Origin: base, ...(auth ? { Cookie: auth } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const register = async (email: string) => {
    const response = await request('/api/auth/register', 'POST', { email, password: secret() });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const create = async (name: string) => {
    const response = await request('/api/projects', 'POST', { name, kind: 'web' });
    assert.equal(response.status, 201);
    return ((await response.json()) as { project: Project }).project;
  };
  const read = async (id: string) => {
    const response = await request(`/api/projects/${id}/brief`);
    assert.equal(response.status, 200);
    return ((await response.json()) as { brief: DesignBrief | null }).brief;
  };
  const write = async (id: string, body: unknown) => {
    const response = await request(`/api/projects/${id}/brief`, 'PUT', body);
    assert.equal(response.status, 200, await response.clone().text());
    return ((await response.json()) as { brief: DesignBrief }).brief;
  };
  const approve = async (id: string, expectedRevision: number) => {
    const response = await request(`/api/projects/${id}/brief/approve`, 'POST', { expectedRevision });
    assert.equal(response.status, 200);
    return ((await response.json()) as { brief: DesignBrief }).brief;
  };
  const fails = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
  };
  const scope: DesignScope = { objective: 'Explain the studio and invite enquiries', audience: 'Independent business owners', direction: 'Warm editorial layout with readable typography', deliverables: ['One responsive landing page'], constraints: ['Keep existing brand colors'], acceptanceCriteria: ['Contact action appears without scrolling on mobile'] };
  const interview: Interview = interviewSchema.parse({ message: 'Help shape the landing page.', questions: [
    { id: 'audience', title: 'Who is it for?', type: 'text', required: true },
    { id: 'tone', title: 'Which tone fits?', type: 'single', options: ['Calm', 'Bold'], required: true },
    { id: 'pages', title: 'Which pages matter?', type: 'multiple', options: ['Home', 'About', 'Contact'], required: true },
    { id: 'notes', title: 'Anything else?', type: 'text', required: false },
  ], scope });
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    cookie = await register('brief-owner@studio.test');
    const other = await register('brief-other@studio.test');
    const project = await create('Interview project');
    const endpoint = `/api/projects/${project.id}/brief`;
    let brief: DesignBrief;

    await t.test('initial request persists without invented questions and is owner scoped', async () => {
      assert.equal(await read(project.id), null);
      await fails(await request(endpoint, 'PUT', { expectedRevision: 0, scope }), 400, 'brief_request_required');
      brief = await write(project.id, { expectedRevision: 0, request: 'A welcoming site for my design studio' });
      assert.equal(brief.revision, 1); assert.equal(brief.projectId, project.id);
      assert.equal(brief.status, 'interview'); assert.equal(brief.scope, null); assert.equal(brief.approvedAt, null);
      assert.deepEqual(brief.questions, []); assert.deepEqual(brief.answers, {}); assert.equal(brief.message, '');
      assert.deepEqual(await read(project.id), brief);
      for (const [suffix, method, body] of [
        ['', 'GET', undefined], ['', 'PUT', { expectedRevision: 1, request: 'Other owner' }], ['/approve', 'POST', { expectedRevision: 1 }], ['/interview', 'POST', { expectedRevision: 1, provider: 'openai' }],
      ] as const) await fails(await request(endpoint + suffix, method, body, other), 404, 'not_found');
      await fails(await request(endpoint, 'GET', undefined, ''), 401, 'unauthorized');
      assert.deepEqual(await read(project.id), brief);
      const reopened = new SqliteDatabase(join(directory, 'studio.sqlite'));
      try { assert.deepEqual(JSON.parse((await reopened.prepare('SELECT brief FROM design_briefs WHERE project_id=?').bind(project.id).first<{ brief: string }>())!.brief), brief); }
      finally { reopened.close(); }
    });

    await t.test('external-agent interview accepts answers but never infers approval', async () => {
      await fails(await request(endpoint + '/approve', 'POST', { expectedRevision: brief.revision }), 400, 'brief_incomplete');
      brief = await write(project.id, { expectedRevision: brief.revision, interview });
      assert.equal(brief.status, 'interview');
      await fails(await request(endpoint + '/approve', 'POST', { expectedRevision: brief.revision }), 400, 'brief_incomplete');
      brief = await write(project.id, { expectedRevision: brief.revision, answers: { audience: '  Local founders  ', tone: 'Calm', pages: ['Home', 'Contact'] } });
      assert.equal(brief.status, 'ready'); assert.equal(brief.answers.audience, 'Local founders');
      assert.equal(brief.approvedAt, null); assert.equal(brief.answers.notes, undefined);
      await fails(await request(`/api/projects/${project.id}/generate`, 'POST', { expectedRevision: project.revision, prompt: 'Build the scope', provider: 'openai' }), 409, 'brief_not_approved');
      const beforeApproval = brief.revision;
      brief = await approve(project.id, brief.revision);
      assert.equal(brief.status, 'approved'); assert.ok(brief.approvedAt); assert.equal(brief.revision, beforeApproval + 1);
      await fails(await request(endpoint + '/approve', 'POST', { expectedRevision: beforeApproval }), 409, 'revision_conflict');
      await fails(await request(`/api/projects/${project.id}/generate`, 'POST', { expectedRevision: project.revision, prompt: 'Build the scope', provider: 'openai' }), 400, 'provider_unconfigured');
      assert.deepEqual(await read(project.id), brief);
    });

    await t.test('answer and scope changes invalidate approval and choice questions allow explicit custom text', async () => {
      brief = await write(project.id, { expectedRevision: brief.revision, answers: { tone: 'Friendly but restrained', pages: 'One long page with anchored sections' } });
      assert.equal(brief.status, 'ready'); assert.equal(brief.approvedAt, null);
      assert.equal(brief.answers.tone, 'Friendly but restrained'); assert.equal(brief.answers.pages, 'One long page with anchored sections');
      brief = await approve(project.id, brief.revision);
      brief = await write(project.id, { expectedRevision: brief.revision, scope: { ...scope, constraints: ['Use the revised brand palette'] } });
      assert.equal(brief.status, 'ready'); assert.equal(brief.approvedAt, null);
      brief = await approve(project.id, brief.revision);
      brief = await write(project.id, { expectedRevision: brief.revision, answers: { audience: '' } });
      assert.equal(brief.status, 'interview'); assert.equal(brief.approvedAt, null); assert.equal(brief.answers.audience, undefined);
      await fails(await request(endpoint + '/approve', 'POST', { expectedRevision: brief.revision }), 400, 'brief_incomplete');
      brief = await write(project.id, { expectedRevision: brief.revision, answers: { audience: 'Local founders' } });
    });

    await t.test('unknown IDs, wrong answer types, invalid selections and approval injection are rejected without changes', async () => {
      for (const answers of [{ unknown: 'value' }, { audience: ['Home'] }, { tone: ['Calm'] }, { pages: ['Invented selection'] }, { pages: ['Home', 'Home'] }]) {
        await fails(await request(endpoint, 'PUT', { expectedRevision: brief.revision, answers }), 400, 'invalid_answers');
        assert.deepEqual(await read(project.id), brief);
      }
      for (const extra of [{ status: 'approved' }, { approvedAt: new Date().toISOString() }, { scope: { ...scope, deliverables: [] } }, { request: '' }]) {
        await fails(await request(endpoint, 'PUT', { expectedRevision: brief.revision, ...extra }), 400, 'invalid_input');
        assert.deepEqual(await read(project.id), brief);
      }
      await fails(await request(endpoint, 'PUT', { expectedRevision: brief.revision, interview: { ...interview, questions: [interview.questions[0], interview.questions[0]] } }), 400, 'invalid_input');
      assert.deepEqual(await read(project.id), brief);
    });

    await t.test('replacement questions preserve compatible answers and clear changed meanings or removed options', async () => {
      brief = await write(project.id, { expectedRevision: brief.revision, answers: { tone: 'Calm', pages: ['Home', 'Contact'] } });
      const expanded = structuredClone(interview);
      expanded.questions.find(question => question.id === 'tone')!.options.push('Editorial');
      brief = await write(project.id, { expectedRevision: brief.revision, interview: expanded });
      assert.equal(brief.answers.tone, 'Calm'); assert.deepEqual(brief.answers.pages, ['Home', 'Contact']);
      const changed = structuredClone(expanded);
      changed.questions.find(question => question.id === 'audience')!.title = 'Who approves the budget?';
      changed.questions.find(question => question.id === 'tone')!.options = ['Bold', 'Editorial'];
      changed.questions.find(question => question.id === 'pages')!.options = ['Home', 'About'];
      brief = await write(project.id, { expectedRevision: brief.revision, interview: changed });
      assert.deepEqual(brief.answers, {}); assert.equal(brief.status, 'interview');
      brief = await write(project.id, { expectedRevision: brief.revision, interview: { message: 'Ready to review the scope.', questions: [], scope } });
      assert.equal(brief.status, 'ready'); assert.deepEqual(brief.answers, {}); assert.equal(brief.approvedAt, null);
    });

    await t.test('stale and concurrent changes cannot overwrite a newer brief or approval', async () => {
      const previous = structuredClone(brief);
      brief = await approve(project.id, brief.revision);
      await fails(await request(endpoint, 'PUT', { expectedRevision: previous.revision, interview }), 409, 'revision_conflict');
      assert.deepEqual(await read(project.id), brief);
      const beforeRace = brief.revision;
      const changes = await Promise.all([
        request(endpoint, 'PUT', { expectedRevision: beforeRace, request: 'One request revision' }),
        request(endpoint, 'PUT', { expectedRevision: beforeRace, request: 'Another request revision' }),
      ]);
      assert.deepEqual(changes.map(response => response.status).sort(), [200, 409]);
      brief = (await read(project.id))!;
      assert.equal(brief.revision, beforeRace + 1); assert.equal(brief.approvedAt, null);
      const newProject = await create('Concurrent first brief');
      const creates = await Promise.all([
        request(`/api/projects/${newProject.id}/brief`, 'PUT', { expectedRevision: 0, request: 'First creator' }),
        request(`/api/projects/${newProject.id}/brief`, 'PUT', { expectedRevision: 0, request: 'Second creator' }),
      ]);
      assert.deepEqual(creates.map(response => response.status).sort(), [200, 409]);
      assert.equal((await read(newProject.id))!.revision, 1);
    });

    await t.test('provider configuration failures never mutate interviews and stale requests fail before provider work', async () => {
      await fails(await request(endpoint + '/interview', 'POST', { expectedRevision: brief.revision - 1, provider: 'openai' }), 409, 'revision_conflict');
      await fails(await request(endpoint + '/interview', 'POST', { expectedRevision: brief.revision, provider: 'openai' }), 400, 'provider_unconfigured');
      assert.deepEqual(await read(project.id), brief);
      const fresh = await create('No brief legacy project');
      await fails(await request(`/api/projects/${fresh.id}/brief/interview`, 'POST', { expectedRevision: 0, provider: 'openai' }), 400, 'brief_required');
      await fails(await request(`/api/projects/${fresh.id}/generate`, 'POST', { expectedRevision: fresh.revision, prompt: 'Normal legacy generation', provider: 'openai' }), 400, 'provider_unconfigured');
      assert.equal(await read(fresh.id), null);
    });

    await t.test('question IDs matching object properties remain unanswered until explicitly provided', async () => {
      const special = await create('Object property question');
      const question = { id: 'constructor', title: 'Who will build the site?', description: '', type: 'text' as const, options: [], required: true };
      const content = { message: 'Identify the implementer.', questions: [question], scope };
      let current = await write(special.id, { expectedRevision: 0, request: 'Build a site', interview: content });
      assert.equal(current.status, 'interview'); assert.deepEqual(current.answers, {});
      await fails(await request(`/api/projects/${special.id}/brief/approve`, 'POST', { expectedRevision: current.revision }), 400, 'brief_incomplete');
      current = await write(special.id, { expectedRevision: current.revision, interview: content });
      assert.equal(current.status, 'interview'); assert.deepEqual(current.answers, {});
      current = await write(special.id, { expectedRevision: current.revision, answers: { constructor: 'Our design team' } });
      assert.equal(current.status, 'ready'); assert.equal(current.answers.constructor, 'Our design team');
      current = await approve(special.id, current.revision);
      current = await write(special.id, { expectedRevision: current.revision, interview: { ...content, questions: [{ ...question, title: 'Who maintains it after launch?' }] } });
      assert.equal(current.status, 'interview'); assert.deepEqual(current.answers, {}); assert.equal(current.approvedAt, null);
    });

    await t.test('deleting a project cascades its private brief', async () => {
      assert.equal((await request(`/api/projects/${project.id}`, 'DELETE')).status, 200);
      assert.equal(await db.prepare('SELECT project_id FROM design_briefs WHERE project_id=?').bind(project.id).first(), null);
      await fails(await request(endpoint), 404, 'not_found');
    });
  } finally {
    db.close();
    const target = resolve(directory), temporaryRoot = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(temporaryRoot) && target.split(sep).pop()!.startsWith('studio-briefs-'));
    await rm(target, { recursive: true, force: true });
  }
});
