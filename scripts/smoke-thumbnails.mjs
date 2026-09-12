import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Release-only check: use a disposable account and remove its stored data in finally.
const origin = 'https://studio.agentkit.best';
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && account, 'Cloudflare credentials are required for verification account cleanup.');
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const database = config.d1_databases.find(binding => binding.binding === 'DB').database_id;
let cookie = '', userId, projectId;
const request = (path, method = 'GET', body) => fetch(origin + path, {
  method, redirect: 'error', signal: AbortSignal.timeout(90000),
  headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const cover = async revision => {
  const start = performance.now();
  const response = await request(`/api/projects/${projectId}/thumbnail?revision=${revision}`);
  assert.equal(response.status, 200, `Cover revision ${revision}`);
  assert.match(response.headers.get('cache-control'), /private/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(bytes.readUInt32BE(16) <= 480 && bytes.readUInt32BE(20) <= 480);
  console.log(`Cover revision ${revision}: ${bytes.length} bytes, ${Math.round(performance.now() - start)} ms`);
  return bytes;
};
try {
  const registration = await request('/api/auth/register', 'POST', {
    email: `thumbnail-smoke-${randomUUID()}@studio-test.invalid`, password: randomUUID() + randomUUID(), name: 'Thumbnail release verification',
  });
  assert.equal(registration.status, 201);
  userId = (await registration.json()).user.id;
  cookie = registration.headers.get('set-cookie').split(';')[0];
  const created = await request('/api/projects', 'POST', { name: 'Thumbnail release verification', kind: 'web' });
  assert.equal(created.status, 201);
  const { project } = await created.json(); projectId = project.id;
  project.document.theme.fonts = { heading: 'Arial', body: 'Arial' };
  project.document.pages[0].background = '#ff0000';
  assert.equal((await request(`/api/projects/${projectId}/document`, 'PUT', { document: project.document, expectedRevision: 1 })).status, 200);
  const first = await cover(2);
  assert.deepEqual(await cover(2), first);
  let listed = await request('/api/projects');
  assert.equal((await listed.json()).projects.find(item => item.id === projectId).thumbnailRevision, 2);
  project.document.pages[0].background = '#0000ff';
  assert.equal((await request(`/api/projects/${projectId}/document`, 'PUT', { document: project.document, expectedRevision: 2 })).status, 200);
  listed = await request('/api/projects');
  assert.equal((await listed.json()).projects.find(item => item.id === projectId).thumbnailRevision, 2);
  const changed = await cover(3); assert.notDeepEqual(changed, first);
  assert.deepEqual(await cover(2), first);
  assert.deepEqual(await cover(3), changed);
  const anonymous = await fetch(`${origin}/api/projects/${projectId}/thumbnail?revision=3`, { redirect: 'error' });
  assert.equal(anonymous.status, 401);
  console.log('PASS production revision cache, stable bytes, revision refresh, retained cover and ownership.');
  const inspect = async (path, body) => {
    const response = await request(path, 'POST', body);
    assert.equal(response.status, 200, 'Visual inspection response');
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    const result = await response.json();
    assert.equal(result.source, 'saved');
    assert.equal(result.items[0].projectId, projectId);
    assert.equal(result.items[0].revision, 3);
    for (const image of result.images) {
      const bytes = Buffer.from(image.data, 'base64');
      assert.equal(image.mimeType, 'image/png');
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(16), image.width);
      assert.equal(bytes.readUInt32BE(20), image.height);
    }
    return result;
  };
  const page = await inspect(`/api/projects/${projectId}/inspect`, { mode: 'page', pageIndex: 0, expectedRevision: 3, maxDimension: 256 });
  assert.equal(page.scope, 'page'); assert.equal(page.images.length, 1);
  const overview = await inspect(`/api/projects/${projectId}/inspect`, { mode: 'overview', expectedRevision: 3, limit: 2, tileSize: 160 });
  assert.equal(overview.scope, 'project'); assert.equal(overview.items.length, Math.min(2, project.document.pages.length));
  const workspace = await inspect('/api/projects/inspect', { limit: 1, tileSize: 160 });
  assert.equal(workspace.scope, 'workspace'); assert.equal(workspace.total, 1);
  assert.equal((await request(`/api/projects/${projectId}/inspect`, 'POST', { expectedRevision: 2 })).status, 409);
  console.log('PASS production page, project and workspace visual inspection, PNG dimensions and revision protection.');
} finally {
  try {
    if (projectId) assert.equal((await request(`/api/projects/${projectId}`, 'DELETE')).status, 200, 'Verification project cleanup');
  } finally {
    if (userId) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'DELETE FROM users WHERE id = ?', params: [userId] }),
      });
      assert.ok(response.ok && (await response.json()).success, 'Verification account cleanup');
      console.log('CLEANED verification account and project.');
    }
  }
}
