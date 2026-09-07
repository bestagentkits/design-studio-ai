import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.STUDIO_SMOKE_URL || 'https://studio.agentkit.best';
const checks = [];
let cookie, token, userId, projectId;
const extraProjects = [];
const expect = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); console.log(`PASS ${label}`); };
const request = (path, method = 'GET', body, useToken = false) => fetch(origin + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(useToken && token ? { Authorization: `Bearer ${token}` } : cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
  const health = await request('/api/health'); expect(health.ok, 'Production API reachable over TLS');
  const registration = await request('/api/auth/register', 'POST', { email: `smoke-${randomUUID()}@studio-test.invalid`, password: randomUUID() + randomUUID(), name: 'Release verification' });
  expect(registration.status === 201, 'Registration and session persistence');
  userId = (await registration.json()).user.id; cookie = registration.headers.get('set-cookie').split(';')[0];
  const created = await request('/api/projects', 'POST', { name: 'Release verification', kind: 'slides', templateId: 'product-deck' });
  expect(created.status === 201, 'D1 project creation');
  const { project } = await created.json(); projectId = project.id;
  const loaded = await request(`/api/projects/${projectId}`); expect((await loaded.json()).project.revision === 1, 'Saved project readable');
  project.document.name = 'Verified cloud design';
  const saved = await request(`/api/projects/${projectId}/document`, 'PUT', { document: project.document, expectedRevision: 1 }); expect((await saved.json()).project.revision === 2, 'D1 revision save');
  const conflict = await request(`/api/projects/${projectId}/document`, 'PUT', { document: project.document, expectedRevision: 1 }); expect(conflict.status === 409, 'Concurrent stale save rejected');
  const message = await request(`/api/projects/${projectId}/messages`, 'POST', { role: 'user', text: 'Persistent conversation verification' });
  const messages = await request(`/api/projects/${projectId}/messages`);
  expect(message.status === 201 && (await messages.json()).messages.some(item => item.text === 'Persistent conversation verification'), 'Conversation stored and reloaded from D1');
  const key = await request('/api/tokens', 'POST', { name: 'Release verification temporary' }); token = (await key.json()).token;
  const mcp = await fetch(origin + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'release-check', version: '1.0' } } }) });
  expect(mcp.ok && !!(await mcp.json()).result?.capabilities?.tools, 'MCP SDK initialization over Streamable HTTP');
  const publication = await request(`/api/projects/${projectId}/publish`, 'POST'); const { url } = await publication.json();
  const publicView = await fetch(url); expect(publicView.ok && (await publicView.text()).includes('Verified cloud design'), 'Anonymous published snapshot');
  for (const format of ['png', 'pdf', 'pptx']) {
    const exported = await request(`/api/projects/${projectId}/export`, 'POST', { format, pageIndex: 0, expectedRevision: 2 });
    if (!exported.ok) throw new Error(`Cloud ${format} export failed: ${exported.status} ${await exported.text()}`);
    const bytes = Buffer.from(await exported.arrayBuffer());
    const valid = format === 'png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : format === 'pdf' ? bytes.subarray(0, 4).toString() === '%PDF' : bytes.subarray(0, 2).toString() === 'PK';
    expect(valid, `Cloud Browser Rendering ${format.toUpperCase()} output`);
    await mkdir('.data/verification', { recursive: true }); await writeFile(`.data/verification/cloud-export.${format}`, bytes);
  }
  for (const kind of ['3d', 'video']) {
    const response = await request('/api/projects', 'POST', { name: `Release ${kind} verification`, kind });
    if (!response.ok) throw new Error(`Cannot create ${kind} verification design`);
    const { project: scene } = await response.json(); extraProjects.push(scene.id);
    if (kind === 'video') {
      scene.document.timeline.duration = 0.5;
      scene.document.timeline.tracks = scene.document.timeline.tracks.map(track => ({ ...track, keyframes: track.keyframes.filter(frame => frame.time === 0) }));
      const saved = await request(`/api/projects/${scene.id}/document`, 'PUT', { document: scene.document, expectedRevision: 1 });
      if (!saved.ok) throw new Error('Cannot save short video');
    }
    const format = kind === '3d' ? 'png' : 'webm';
    const rendered = await request(`/api/projects/${scene.id}/export`, 'POST', { format });
    if (!rendered.ok) throw new Error(`Cloud ${kind} failed: ${rendered.status} ${await rendered.text()}`);
    const bytes = Buffer.from(await rendered.arrayBuffer());
    expect(kind === '3d' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0, 4).toString('hex') === '1a45dfa3', `Cloud ${kind} rendering produces actual ${format.toUpperCase()} bytes`);
    await writeFile(`.data/verification/cloud-${kind}.${format}`, bytes);
    const snapshot = await request(`/api/projects/${scene.id}/publish`, 'POST'); const { url } = await snapshot.json();
    const publicPage = await fetch(url);
    expect(publicPage.ok && (await publicPage.text()).includes('id="studio-document"'), `Published ${kind} contains trusted interactive viewer`);
  }
} finally {
  for (const extraId of extraProjects) await request(`/api/projects/${extraId}`, 'DELETE');
  if (projectId) { const deleted = await request(`/api/projects/${projectId}`, 'DELETE'); console.log(deleted.ok ? 'CLEANED verification project' : 'Verification project cleanup needs attention'); }
  if (userId && process.env.CLOUDFLARE_API_TOKEN && origin === 'https://studio.agentkit.best') {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/920d59d1-d4e9-4e8b-b01b-9dbf45a180aa/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM users WHERE id = ?', params: [userId] }) });
    console.log(response.ok ? 'CLEANED verification account and temporary credentials' : 'Verification account cleanup needs attention');
  }
  await mkdir('.data/verification', { recursive: true }); await writeFile('.data/verification/production-checks.json', JSON.stringify({ origin, checkedAt: new Date().toISOString(), checks }, null, 2));
}
