import { cachedMcpCatalog } from './mcp-catalog-cache';
import { connectorVersionPinsSchema } from '../../src/shared/connector-operations';
import type { Bindings } from '../types';
import type { ConnectorPrincipal } from '../../src/shared/connector-values';
import { authorizeConnectorBinding, type ConnectorCapability } from '../connection-policy';
import { readConnectorCredential } from '../connector-credentials';
import { canonicalConnectorJson, connectorFingerprint } from '../connector-fingerprints';
import { activePrincipalGuard } from '../connector-principal-guard';
import { operationClockSql } from '../connector-operation-versions';
import { importProjectSource } from '../project-sources';
import { fail } from '../security';
import { withMcpClient } from './mcp-client';
import { readMcpCatalog } from './mcp-catalog';
import { decodeMcpResourceContents } from './mcp-content';

export { connectorBindingAuthority as mcpBindingAuthority } from '../connector-binding-authority';
import { connectorBindingAuthority as mcpBindingAuthority } from '../connector-binding-authority';

/** Discovery shows only exact selected names; templates never confer wildcard authority. */
export async function discoverBindingMcpCatalog(env: Bindings, principal: ConnectorPrincipal, bindingId: string) {
  const auth = await mcpBindingAuthority(env, principal, bindingId, 'discover');
  const catalog = await cachedMcpCatalog(env,auth.connection,auth.credential,canonicalConnectorJson({bindingId,policy:auth.binding.policy_revision,principal,selection:auth.selection}),auth.recheck);
  await auth.recheck();
  if (auth.selection.adapter !== 'mcp') return fail(400, 'unsupported_protocol', 'An MCP selection is required.');
  const selection = auth.selection;
  const filtered = { tools: catalog.tools.filter(tool => selection.tools.includes(tool.remoteName)), resources: catalog.resources.filter(resource => selection.resources.includes(resource.uri)), templates: [] };
  const project = await env.DB.prepare('SELECT revision FROM projects WHERE id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  const brief = await env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(auth.binding.project_id,principal.userId).first<{revision:number}>();
  const credential = await env.DB.prepare('SELECT credential_version FROM connection_credentials WHERE connection_id=? AND user_id=?').bind(auth.connection.id,principal.userId).first<{credential_version:number}>();
  await auth.recheck();
  const versions = connectorVersionPinsSchema.parse({connectionRevision:auth.connection.revision,credentialVersion:auth.connection.auth_mode==='anonymous'?1:credential?.credential_version,
    policyRevision:auth.binding.policy_revision,documentRevision:project?.revision,briefRevision:brief?.revision??0,sourceSnapshotIds:[]});
  return { ...filtered, versions, fingerprint: await connectorFingerprint(filtered) };
}

/** Only the MCP endpoint is fetched; resource URIs remain opaque identifiers. */
export async function importMcpResource(env: Bindings, principal: ConnectorPrincipal, projectId: string, bindingId: string, uri: string) {
  const auth = await mcpBindingAuthority(env, principal, bindingId, 'read_source', uri, projectId);
  const decoded = await withMcpClient(env, auth.connection, auth.credential, async scope => {
    await auth.recheck();
    const result = await scope.client.request({ method: 'resources/read', params: { uri } }, scope.requestOptions);
    const value = decodeMcpResourceContents(result);
    if (!value.content.length || value.content.some(item => item.type !== 'resource' || item.uri !== uri)) fail(502, 'invalid_resource', 'Remote response does not match the selected resource.');
    return value;
  });
  await auth.recheck();
  const bytes = new TextEncoder().encode(canonicalConnectorJson(decoded));
  return importProjectSource(env, principal, projectId, bindingId, {
    selection: { adapter: 'mcp', tools: [], resources: [uri] }, remoteIdentity: uri,
    remoteVersion: `sha256:${await connectorFingerprint(decoded)}`, mimeType: 'application/json', extractionVersion: 'mcp-content-v1', bytes,
  }, auth.guard);
}
