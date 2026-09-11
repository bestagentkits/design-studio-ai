import { activePrincipalGuard } from './connector-principal-guard';
import type { Bindings, Statement } from './types';
import { connectorSelectionSchema, sourceSnapshotSchema, type SourceSnapshot } from '../src/shared/connectors';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { authorizeConnectorBinding, principalColumns } from './connection-policy';
import { beginConnectorObjectUpload, abandonConnectorObjectUpload } from './connector-object-cleanup';
import { fail, id, now } from './security';

type Selection = ReturnType<typeof connectorSelectionSchema.parse>;
export interface SourceImport {
  selection: Selection; remoteIdentity: string; remoteVersion: string;
  mimeType: string; extractionVersion: string; bytes: Uint8Array;
}
interface SourceRow {
  id: string; user_id: string; project_id: string; binding_id: string | null; adapter: SourceSnapshot['adapter'];
  remote_identity: string; remote_version: string; content_hash: string; content_object_key: string;
  mime_type: string; bytes: number; extraction_version: string; fetched_at: string; status: SourceSnapshot['status'];
}
const metadata = (r: SourceRow): SourceSnapshot => sourceSnapshotSchema.parse({ id: r.id, projectId: r.project_id, bindingId: r.binding_id,
  adapter: r.adapter, remoteIdentity: r.remote_identity, remoteVersion: r.remote_version, contentHash: r.content_hash,
  mimeType: r.mime_type, bytes: r.bytes, extractionVersion: r.extraction_version, fetchedAt: r.fetched_at, status: r.status });
async function ownedProject(env: Bindings, userId: string, projectId: string) {
  if (!await env.DB.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').bind(projectId, userId).first()) fail(404, 'not_found', 'Project not found.');
}
async function ownedSource(env: Bindings, userId: string, projectId: string, sourceId: string) {
  await ownedProject(env, userId, projectId);
  return await env.DB.prepare('SELECT * FROM project_source_snapshots WHERE id=? AND user_id=? AND project_id=?').bind(sourceId, userId, projectId).first<SourceRow>()
    ?? fail(404, 'not_found', 'Source not found.');
}
function exactSelection(selected: Selection, allowed: Selection) {
  let permitted = false;
  if (selected.adapter === 'mcp' && allowed.adapter === 'mcp') permitted = selected.tools.length === 0 && selected.resources.length === 1 && allowed.resources.includes(selected.resources[0]);
  if (selected.adapter === 'github' && allowed.adapter === 'github') permitted = selected.repositoryId === allowed.repositoryId && selected.commit === allowed.commit && selected.paths.length === 1 && allowed.paths.includes(selected.paths[0]);
  if (selected.adapter === 'google-drive' && allowed.adapter === 'google-drive') permitted = !selected.destinationFolderId && selected.fileIds.length === 1 && allowed.fileIds.includes(selected.fileIds[0]);
  if (!permitted) fail(403, 'missing_grant', 'Select exactly one permitted source.');
}
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
async function store(env: Bindings, userId: string, snapshot: SourceSnapshot, bytes: Uint8Array, guard: () => Promise<{ sql: string; values: unknown[] }>) {
  const upload = await beginConnectorObjectUpload(env);
  try {
    await env.ASSETS_BUCKET.put(upload.key, bytes, { httpMetadata: { contentType: snapshot.mimeType } });
    const condition = await guard();
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO project_source_snapshots(id,user_id,project_id,binding_id,adapter,remote_identity,remote_version,content_hash,content_object_key,mime_type,bytes,extraction_version,fetched_at,status)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connector_object_cleanup WHERE object_key=? AND state='uploading' AND lease_id=? AND due_at>?)
        AND EXISTS(SELECT 1 FROM projects WHERE id=? AND user_id=?) AND (${condition.sql})`)
        .bind(snapshot.id, userId, snapshot.projectId, snapshot.bindingId, snapshot.adapter, snapshot.remoteIdentity, snapshot.remoteVersion, snapshot.contentHash, upload.key,
          snapshot.mimeType, bytes.byteLength, snapshot.extractionVersion, snapshot.fetchedAt, snapshot.status, upload.key, upload.lease, Date.now(), snapshot.projectId, userId, ...condition.values),
      env.DB.prepare("DELETE FROM connector_object_cleanup WHERE object_key=? AND state='uploading' AND lease_id=? AND EXISTS(SELECT 1 FROM project_source_snapshots WHERE id=? AND content_object_key=?)")
        .bind(upload.key, upload.lease, snapshot.id, upload.key),
    ]) as { meta: { changes: number } }[];
    if (result[0]?.meta.changes !== 1) fail(409, 'revision_conflict', 'Source access changed during import.');
    return snapshot;
  } catch (error) {
    // The durable upload intent also survives failure of this best-effort transition.
    try { await abandonConnectorObjectUpload(env, upload.key, upload.lease); } catch { /* Maintenance will claim the expired intent. */ }
    throw error;
  }
}
/** Trusted adapters supply validated bytes and optional SQL pins from before their remote request; never accept SQL from client input. */
export async function importProjectSource(env: Bindings, principal: ConnectorPrincipal, projectId: string, bindingId: string, input: SourceImport, trustedGuard?: { sql: string; values: unknown[] }) {
  await ownedProject(env, principal.userId, projectId);
  const selected = connectorSelectionSchema.parse(input.selection);
  const action = selected.adapter === 'mcp' ? selected.resources[0] : undefined;
  const auth = await authorizeConnectorBinding(env, principal, bindingId, 'read_source', action);
  if (auth.binding.project_id !== projectId) fail(403, 'missing_grant', 'Source binding belongs to a different project.');
  exactSelection(selected, auth.selection);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > 20 * 1024 * 1024) fail(413, 'limit_exceeded', 'Source exceeds the 20 MiB limit.');
  const bytes = new Uint8Array(input.bytes);
  const snapshot = sourceSnapshotSchema.parse({ id: id(), projectId, bindingId, adapter: selected.adapter, remoteIdentity: input.remoteIdentity,
    remoteVersion: input.remoteVersion, contentHash: await digest(bytes), mimeType: input.mimeType, bytes: bytes.byteLength,
    extractionVersion: input.extractionVersion, fetchedAt: now(), status: 'available' });
  return store(env, principal.userId, snapshot, bytes, async () => {
    const current = await authorizeConnectorBinding(env, principal, bindingId, 'read_source', action);
    exactSelection(selected, current.selection);
    if (current.binding.policy_revision !== auth.binding.policy_revision || current.connection.revision !== auth.connection.revision) fail(409, 'revision_conflict', 'Source access changed during import.');
    const active = activePrincipalGuard(env, principal), identity = principalColumns(principal);
    const grant = current.grant ? ` AND EXISTS(SELECT 1 FROM connection_agent_grants WHERE id=? AND principal_kind=? AND principal_id=? AND principal_client_id IS ? AND revoked_at IS NULL AND expires_at>? AND policy_revision=?)` : '';
    return { sql: `EXISTS(SELECT 1 FROM project_connection_bindings b JOIN connections c ON c.id=b.connection_id AND c.user_id=b.user_id
      WHERE b.id=? AND b.user_id=? AND b.project_id=? AND b.policy_revision=? AND b.disabled_at IS NULL AND c.revision=? AND c.status='connected') AND ${active.sql}${grant}${trustedGuard ? ` AND (${trustedGuard.sql})` : ''}`,
      values: [bindingId, principal.userId, projectId, auth.binding.policy_revision, auth.connection.revision, ...active.values,
        ...(current.grant ? [current.grant.id, identity.kind, identity.id, identity.clientId, Date.now(), auth.binding.policy_revision] : []), ...(trustedGuard?.values ?? [])] };
  });
}
export async function listProjectSources(env: Bindings, userId: string, projectId: string) {
  await ownedProject(env, userId, projectId);
  const { results } = await env.DB.prepare('SELECT * FROM project_source_snapshots WHERE user_id=? AND project_id=? ORDER BY fetched_at DESC,id').bind(userId, projectId).all<SourceRow>();
  return results.map(metadata);
}
export async function getProjectSource(env: Bindings, userId: string, projectId: string, sourceId: string) {
  const row = await ownedSource(env, userId, projectId, sourceId), object = await env.ASSETS_BUCKET.get(row.content_object_key);
  if (!object) return fail(404, 'not_found', 'Source content not found.');
  return { metadata: metadata(row), body: object.body };
}
export async function removeProjectSource(env: Bindings, userId: string, projectId: string, sourceId: string) {
  await ownedSource(env, userId, projectId, sourceId);
  await env.DB.prepare('DELETE FROM project_source_snapshots WHERE id=? AND user_id=? AND project_id=?').bind(sourceId, userId, projectId).run();
}
/** Append this to the same batch as project deletion; the delete trigger also covers cascading deletion. */
export async function prepareProjectSourceCleanup(env: Bindings, userId: string, projectId: string): Promise<Statement> {
  await ownedProject(env, userId, projectId);
  return env.DB.prepare(`INSERT OR IGNORE INTO connector_object_cleanup(object_key,state,lease_id,due_at,created_at)
    SELECT content_object_key,'deleting',NULL,0,? FROM project_source_snapshots WHERE user_id=? AND project_id=?`).bind(now(), userId, projectId);
}
export async function cloneProjectSources(env: Bindings, userId: string, sourceProjectId: string, targetProjectId: string, sourceIds: string[]) {
  await ownedProject(env, userId, sourceProjectId); await ownedProject(env, userId, targetProjectId);
  if (sourceIds.length > 100 || new Set(sourceIds).size !== sourceIds.length) fail(400, 'limit_exceeded', 'Choose up to 100 distinct sources.');
  const rows = await Promise.all(sourceIds.map(sourceId => ownedSource(env, userId, sourceProjectId, sourceId)));
  const copied: SourceSnapshot[] = [];
  for (const row of rows) {
    const object = await env.ASSETS_BUCKET.get(row.content_object_key);
    if (!object) fail(404, 'not_found', 'Source content not found.');
    const reader = object!.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength;
      if (length > 20 * 1024 * 1024 || length > row.bytes) fail(413, 'limit_exceeded', 'Source content exceeds its stored size.'); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (length !== row.bytes || await digest(bytes) !== row.content_hash) fail(409, 'revision_conflict', 'Source content integrity check failed.');
    const snapshot = sourceSnapshotSchema.parse({ ...metadata(row), id: id(), projectId: targetProjectId, bindingId: null, status: 'disconnected' });
    copied.push(await store(env, userId, snapshot, bytes, async () => ({ sql: 'EXISTS(SELECT 1 FROM project_source_snapshots WHERE id=? AND user_id=? AND project_id=?)', values: [row.id, userId, sourceProjectId] })));
  }
  return copied;
}
