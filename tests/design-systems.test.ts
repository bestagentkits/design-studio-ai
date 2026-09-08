import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument } from '../src/shared/catalog';
import { resolveLayout } from '../src/shared/layout';
import type { Bindings } from '../server/types';
import type { Project } from '../src/shared/schema';
import { captureSystemComponent, type DesignSystem, type DesignSystemDefinition } from '../src/shared/design-systems';

const definition = (): DesignSystemDefinition => ({
  name: 'Editorial system', description: 'Shared components and compositions', system: 'antd', theme: createDocument('web', 'Theme').theme,
  components: [{ id: 'button-preset', name: 'Primary action', component: { name: 'Button', system: 'antd', props: { label: 'Default action', disabled: false } }, style: { borderRadius: 12 }, sizing: { width: 'fill' } }],
  compositions: [{ id: 'composition', name: 'CTA composition', width: 300, height: 160, background: '#fff', nodes: [
    { id: 'container', name: 'Container', type: 'frame', x: 10, y: 10, width: 280, height: 140 },
    { id: 'action', name: 'Action', type: 'component', parentId: 'container', x: 20, y: 20, width: 100, height: 40, component: { name: 'Button', system: 'antd' }, interactions: [{ trigger: 'click', action: 'toggle', target: 'target' }, { trigger: 'hover', action: 'navigate', target: 'composition' }] },
    { id: 'target', name: 'Target', type: 'text', parentId: 'container', x: 20, y: 70, width: 200, height: 40, text: 'Reusable message' },
  ] }],
});

test('design systems persist immutable versions and share real project revision boundaries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-design-systems-')), db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const origin = 'https://studio.example', env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: origin, ENCRYPTION_KEY: secret(), ALLOW_REGISTRATION: 'true' };
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => app.request(origin + path, { method, headers: { Origin: origin, ...(auth ? { Cookie: auth } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const register = async (email: string) => { const response = await request('/api/auth/register', 'POST', { email, password: secret() }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; };
  const systemFrom = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return (await response.json() as { system: DesignSystem }).system; };
  const projectFrom = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return (await response.json() as { project: Project }).project; };
  const read = async (id: string, version?: number) => systemFrom(await request(`/api/design-systems/${id}${version ? `?version=${version}` : ''}`));
  const fail = async (response: Response, status: number, code: string) => { assert.equal(response.status, status, await response.clone().text()); assert.equal((await response.json() as { error: { code: string } }).error.code, code); };
  const createProject = async (auth = cookie) => {
    const document = createDocument('web', 'System project'); document.pages[0].layout = { mode: 'absolute' }; document.pages[0].nodes = [{ id: 'existing', name: 'Existing button', type: 'component', x: 10, y: 20, width: 120, height: 40, component: { name: 'Button', system: 'shadcn', props: { label: 'Keep my text' } }, style: { fill: '#123456' } }];
    return projectFrom(await request('/api/projects', 'POST', { name: 'System project', kind: 'web', document }, auth), 201);
  };
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    cookie = await register('systems-owner@studio.test'); const other = await register('systems-other@studio.test');
    let library = await systemFrom(await request('/api/design-systems', 'POST', definition()), 201);
    const original = structuredClone(library);
    await t.test('create, list, read and reopen retain the complete definition', async () => {
      assert.equal(library.version, 1); assert.deepEqual(await read(library.id), original);
      const listed = await request('/api/design-systems'); assert.equal(listed.status, 200);
      assert.deepEqual((await listed.json() as { systems: DesignSystem[] }).systems, [original]);
      const reopened = new SqliteDatabase(join(directory, 'studio.sqlite'));
      try { const row = await reopened.prepare('SELECT definition FROM design_system_versions WHERE system_id=? AND version=1').bind(library.id).first<{ definition: string }>(); assert.deepEqual(JSON.parse(row!.definition), original.definition); }
      finally { reopened.close(); }
    });
    await t.test('version updates keep historical definitions immutable and stale writers fail', async () => {
      const revised = structuredClone(library.definition); revised.name = 'Revised system'; revised.theme.colors.accent = '#aabbcc';
      library = await systemFrom(await request(`/api/design-systems/${library.id}`, 'PUT', { expectedVersion: 1, definition: revised }));
      assert.equal(library.version, 2); assert.deepEqual(await read(library.id, 1), original);
      await fail(await request(`/api/design-systems/${library.id}`, 'PUT', { expectedVersion: 1, definition: original.definition }), 409, 'version_conflict');
      assert.deepEqual(await read(library.id), library);
      const versions = await request(`/api/design-systems/${library.id}/versions`); assert.equal(versions.status, 200);
      assert.deepEqual((await versions.json() as { versions: { version: number }[] }).versions.map(v => v.version), [2, 1]);
      await fail(await request(`/api/design-systems/${library.id}?version=99`), 404, 'not_found');
    });
    await t.test('concurrent version writers create exactly one next version', async () => {
      const responses = await Promise.all(['Left writer', 'Right writer'].map(name => request(`/api/design-systems/${library.id}`, 'PUT', { expectedVersion: library.version, definition: { ...library.definition, name } })));
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      library = await systemFrom(responses.find(response => response.status === 200)!);
      await fail(responses.find(response => response.status === 409)!, 409, 'version_conflict');
      assert.equal(library.version, 3); assert.deepEqual(await read(library.id), library); assert.deepEqual(await read(library.id, 1), original);
    });
    await t.test('all reads and writes isolate owners and require authentication', async () => {
      const project = await createProject(other), payload = { projectId: project.id, expectedRevision: project.revision };
      const requests = [['', 'GET', undefined], ['/versions', 'GET', undefined], ['', 'PUT', { expectedVersion: library.version, definition: definition() }], ['/apply', 'POST', payload], ['/insert', 'POST', { ...payload, pageId: project.document.pages[0].id, itemId: 'button-preset' }], ['', 'DELETE', undefined]] as const;
      for (const [suffix, method, body] of requests) await fail(await request(`/api/design-systems/${library.id}${suffix}`, method, body, other), 404, 'not_found');
      for (const path of ['/api/design-systems', `/api/design-systems/${library.id}`]) await fail(await request(path, 'GET', undefined, ''), 401, 'unauthorized');
      assert.deepEqual((await (await request('/api/design-systems', 'GET', undefined, other)).json() as { systems: DesignSystem[] }).systems, []);
      await fail(await request(`/api/design-systems/${library.id}/apply`, 'POST', payload), 404, 'not_found');
    });
    await t.test('apply pins the requested version without overwriting authored component values', async () => {
      const project = await createProject(), path = `/api/design-systems/${library.id}/apply`;
      const saved = await projectFrom(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision, version: 1 }));
      assert.equal(saved.revision, project.revision + 1); assert.deepEqual(saved.document.designSystem, { id: library.id, version: 1, name: original.definition.name });
      assert.deepEqual(saved.document.theme, original.definition.theme);
      assert.deepEqual(saved.document.pages[0].nodes[0].component, { name: 'Button', system: 'antd', props: { label: 'Keep my text', disabled: false } });
      assert.deepEqual(saved.document.pages[0].nodes[0].style, { borderRadius: 12, fill: '#123456' });
      await fail(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision }), 409, 'revision_conflict');
      assert.deepEqual(await projectFrom(await request(`/api/projects/${project.id}`)), saved);
      const latest = await projectFrom(await request(path, 'POST', { projectId: project.id, expectedRevision: saved.revision }));
      assert.equal(latest.document.designSystem!.version, library.version); assert.equal(latest.document.theme.colors.accent, '#aabbcc');
    });
    await t.test('repeated composition insertion remaps every node, parent, toggle and navigation reference', async () => {
      let project = await createProject(); const path = `/api/design-systems/${library.id}/insert`, pageId = project.document.pages[0].id;
      for (let iteration = 0; iteration < 2; iteration++) {
        const previousIds = new Set(project.document.pages[0].nodes.map(node => node.id));
        const saved = await projectFrom(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId, itemId: 'composition' }));
        assert.equal(saved.revision, project.revision + 1);
        const inserted = saved.document.pages[0].nodes.filter(node => !previousIds.has(node.id)), container = inserted.find(node => node.name === 'Container')!, action = inserted.find(node => node.name === 'Action')!, target = inserted.find(node => node.name === 'Target')!, root = inserted.find(node => node.name === 'CTA composition')!;
        assert.equal(inserted.length, 4); assert.equal(container.parentId, root.id); assert.equal(action.parentId, container.id); assert.equal(target.parentId, container.id);
        assert.deepEqual(action.interactions, [{ trigger: 'click', action: 'toggle', target: target.id }, { trigger: 'hover', action: 'navigate', target: pageId }]);
        assert.ok(inserted.every(node => !['container', 'action', 'target'].includes(node.id)));
        await fail(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId, itemId: 'composition' }), 409, 'revision_conflict'); project = saved;
      }
      await fail(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId, itemId: 'missing' }), 400, 'invalid_item');
      const inserted = await projectFrom(await request(path, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId, itemId: 'button-preset' }));
      assert.equal(inserted.document.pages[0].nodes.at(-1)!.component!.props!.label, 'Default action');
    });
    await t.test('captured image and avatar components preserve media, text and dimensions through storage and insertion', async () => {
      const sources = ['https://example.com/library-image.png', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg=='];
      for (const [index, name] of (['Image', 'Avatar'] as const).entries()) {
        const captured = captureSystemComponent({ id: 'canvas-image', name: `Captured ${name}`, type: 'component', x: 10, y: 20, width: 500, height: 300, src: sources[index], text: 'Image caption', component: { name, system: 'antd' } }, 'captured-media');
        const media = definition(); media.components = [captured];
        const system = await systemFrom(await request('/api/design-systems', 'POST', media), 201), project = await createProject();
        assert.deepEqual((await read(system.id)).definition.components, JSON.parse(JSON.stringify([captured])));
        const saved = await projectFrom(await request(`/api/design-systems/${system.id}/insert`, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId: project.document.pages[0].id, itemId: captured.id }));
        const inserted = saved.document.pages[0].nodes.at(-1)!;
        assert.equal(inserted.width, 500); assert.equal(inserted.height, 300); assert.equal(inserted.src, sources[index]); assert.equal(inserted.text, 'Image caption');
        assert.deepEqual(inserted.component, captured.component); assert.notEqual(inserted.id, captured.id); assert.notEqual(inserted.id, 'canvas-image');
        for (const src of ['/api/assets/private-image', '/published/private-snapshot/assets/private-image']) {
          const invalid = { ...media, components: [captureSystemComponent({ ...inserted, src }, captured.id)] };
          await fail(await request('/api/design-systems', 'POST', invalid), 400, 'invalid_input');
          await fail(await request(`/api/design-systems/${system.id}`, 'PUT', { expectedVersion: system.version, definition: invalid }), 400, 'invalid_input');
        }
        assert.equal((await read(system.id)).version, 1);
      }
    });
    await t.test('legacy composition insertion preserves absolute child positions relative to its new wrapper', async () => {
      const legacy = definition(); legacy.compositions[0].nodes = [
        { id: 'parent', name: 'Legacy parent', type: 'frame', x: 100, y: 50, width: 200, height: 100 },
        { id: 'child', name: 'Legacy child', type: 'shape', parentId: 'parent', x: 120, y: 70, width: 40, height: 20 },
      ];
      const system = await systemFrom(await request('/api/design-systems', 'POST', legacy), 201), project = await createProject();
      const saved = await projectFrom(await request(`/api/design-systems/${system.id}/insert`, 'POST', { projectId: project.id, expectedRevision: project.revision, pageId: project.document.pages[0].id, itemId: 'composition' }));
      const nodes = resolveLayout(saved.document.pages[0]).nodes, parent = nodes.find(n => n.name === 'Legacy parent')!, child = nodes.find(n => n.name === 'Legacy child')!;
      assert.equal(parent.x, 140); assert.equal(parent.y, 90); assert.equal(child.x, 160); assert.equal(child.y, 110); assert.equal(child.parentId, parent.id);
    });
    await t.test('private media and invalid reusable references reject creation and updates', async () => {
      for (const src of ['/api/assets/private-asset', '/published/private-snapshot/assets/private-asset']) {
        const invalid = definition(); invalid.compositions[0].nodes[2].src = src;
        await fail(await request('/api/design-systems', 'POST', invalid), 400, 'invalid_input');
        await fail(await request(`/api/design-systems/${library.id}`, 'PUT', { expectedVersion: library.version, definition: invalid }), 400, 'invalid_input');
      }
      const invalid = definition(); invalid.compositions[0].nodes[1].interactions![0].target = 'missing';
      await fail(await request('/api/design-systems', 'POST', invalid), 400, 'invalid_input');
      const publicMedia = definition(); publicMedia.compositions[0].nodes[2].src = 'https://example.com/image.png';
      await systemFrom(await request('/api/design-systems', 'POST', publicMedia), 201);
      assert.deepEqual(await read(library.id), library);
    });
    await t.test('deleting a library removes its version history while saved project designs survive', async () => {
      const project = await createProject(); const pinned = await projectFrom(await request(`/api/design-systems/${library.id}/apply`, 'POST', { projectId: project.id, expectedRevision: project.revision }));
      assert.equal((await request(`/api/design-systems/${library.id}`, 'DELETE')).status, 200);
      await fail(await request(`/api/design-systems/${library.id}`), 404, 'not_found');
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM design_system_versions WHERE system_id=?').bind(library.id).first<{ count: number }>())!.count, 0);
      assert.deepEqual(await projectFrom(await request(`/api/projects/${project.id}`)), pinned);
    });
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
