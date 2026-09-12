import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const origin = process.env.STUDIO_SMOKE_URL || 'https://studio.agentkit.best';
const productionDatabase = '920d59d1-d4e9-4e8b-b01b-9dbf45a180aa';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases.find(binding => binding.binding === 'DB').database_id;
assert.equal(database, productionDatabase, 'Cleanup must target the D1 database this deployment publishes to.');
const checks = [];
let cookie, token, userId, projectId;
const extraProjects = [];
const expect = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); console.log(`PASS ${label}`); };
const request = (path, method = 'GET', body, useToken = false) => fetch(origin + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(useToken && token ? { Authorization: `Bearer ${token}` } : cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
let primaryError;
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
  const scope = {objective:'Explain the release',audience:'Design teams',direction:'Clear and readable',deliverables:['A presentation'],constraints:['Preserve the approved copy'],acceptanceCriteria:['Readable text and correct export']};
  const briefResponse = await request(`/api/projects/${projectId}/brief`, 'PUT', {expectedRevision:0,request:'Create a release presentation',interview:{message:'Confirm the audience.',questions:[{id:'audience',title:'Who is this for?',description:'',type:'text',options:[],required:true}],scope},answers:{audience:'Design teams'}});
  expect(briefResponse.ok && (await briefResponse.json()).brief.status === 'ready', 'D1 interview and answers persisted without implicit approval');
  const mcpCall = async (name, args) => {
    const response = await fetch(origin + '/mcp', {method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}})});
    const envelope=await response.json();
    if (!response.ok || envelope.error || envelope.result?.isError) throw new Error(`Production MCP tool ${name} failed`);
    return JSON.parse(envelope.result.content[0].text);
  };
  expect((await mcpCall('approve_design_brief',{projectId,expectedRevision:1})).brief.status==='approved','MCP explicit scope approval uses persisted brief revision');
  expect((await request(`/api/projects/${projectId}/brief/approve`,'POST',{expectedRevision:1})).status===409,'Production stale brief approval rejected');
  const designChecks=await mcpCall('inspect_design',{projectId});
  expect(designChecks.revision===2 && Array.isArray(designChecks.issues),'MCP design preflight inspects saved revision');
  const docs=await fetch(origin+'/docs/api'), markdown=await fetch(origin+'/docs/api.md'), sitemap=await fetch(origin+'/sitemap.xml');
  expect(docs.ok && (await docs.text()).includes('application/ld+json') && markdown.headers.get('content-type')?.includes('text/markdown') && (await markdown.text()).includes('/brief/approve') && sitemap.ok,'Public HTML, Markdown and sitemap served on production');
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
} catch (error) {
  primaryError = error;
} finally {
  const cleanupFailures = [];
  for (const extraId of extraProjects) { const deleted = await request(`/api/projects/${extraId}`, 'DELETE'); if (!deleted.ok) cleanupFailures.push(new Error(`Extra verification project ${extraId} cleanup needs attention`)); }
  if (projectId) { const deleted = await request(`/api/projects/${projectId}`, 'DELETE'); console.log(deleted.ok ? 'CLEANED verification project' : 'Verification project cleanup needs attention'); if (!deleted.ok) cleanupFailures.push(new Error('Verification project cleanup needs attention')); }
  if (userId && process.env.CLOUDFLARE_API_TOKEN && origin === 'https://studio.agentkit.best') {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'DELETE FROM users WHERE id = ?', params: [userId] }) });
    const cleaned = response.ok && (await response.json()).success;
    console.log(cleaned ? 'CLEANED verification account and temporary credentials' : 'Verification account cleanup needs attention');
    if (!cleaned) cleanupFailures.push(new Error('Verification account cleanup needs attention'));
  }
  await mkdir('.data/verification', { recursive: true }); await writeFile('.data/verification/production-checks.json', JSON.stringify({ origin, checkedAt: new Date().toISOString(), checks }, null, 2));
  if (cleanupFailures.length > 0) throw new AggregateError(primaryError ? [primaryError, ...cleanupFailures] : cleanupFailures, 'Production smoke cleanup left resources behind; see .data/verification/production-checks.json.');
  if (primaryError) throw primaryError;
}
