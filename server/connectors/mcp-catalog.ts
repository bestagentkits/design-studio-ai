import { z } from 'zod';
import { connectorToolSchema, type ConnectorTool } from '../../src/shared/connectors';
import { boundedConnectorJson } from '../../src/shared/connector-values';
import { connectorFingerprint } from '../connector-fingerprints';
import { inspectConnectorSchema } from '../connector-schema-validation';
import { fail } from '../security';
import type { McpRequestScope } from './mcp-client';

const resourceSchema = z.object({ name: z.string().min(1).max(200), uri: z.string().min(1).max(2048), description: z.string().max(8000).optional(), mimeType: z.string().max(120).optional() });
const templateSchema = resourceSchema.omit({ uri: true }).extend({ uriTemplate: z.string().min(1).max(2048) });
export interface McpCatalogTool extends ConnectorTool { id: string; schemaSupported: boolean }
export async function readMcpCatalog(scope: McpRequestScope) {
  let count = 0, bytes = 0;
  const paginate = async <T>(load: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>) => {
    const items: T[] = [], cursors = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = await load(cursor);
      bytes += new TextEncoder().encode(JSON.stringify(response)).byteLength; count += response.items.length;
      if (bytes > 1048576 || count > 300) fail(413, 'limit_exceeded', 'Remote catalog exceeds its size limit.');
      items.push(...response.items);
      if (!response.nextCursor) return items;
      if (response.nextCursor.length > 2048 || cursors.has(response.nextCursor)) fail(413, 'limit_exceeded', 'Remote catalog pagination did not advance.');
      cursor = response.nextCursor; cursors.add(cursor);
    }
    return fail(413, 'limit_exceeded', 'Remote catalog exceeds its page limit.');
  };
  const capabilities = scope.client.getServerCapabilities();
  // Use typed single requests: SDK list helpers otherwise aggregate before our size checks.
  const rawTools = capabilities?.tools ? await paginate(async cursor => { const page = await scope.client.request({ method: 'tools/list', params: { cursor } }, scope.requestOptions); return { items: page.tools, nextCursor: page.nextCursor }; }) : [];
  const rawResources = capabilities?.resources ? await paginate(async cursor => { const page = await scope.client.request({ method: 'resources/list', params: { cursor } }, scope.requestOptions); return { items: page.resources, nextCursor: page.nextCursor }; }) : [];
  const rawTemplates = capabilities?.resources ? await paginate(async cursor => { const page = await scope.client.request({ method: 'resources/templates/list', params: { cursor } }, scope.requestOptions); return { items: page.resourceTemplates, nextCursor: page.nextCursor }; }) : [];
  const names = new Set<string>();
  const tools: McpCatalogTool[] = [];
  for (const remote of rawTools) {
    if (names.has(remote.name)) fail(502, 'invalid_catalog', 'Remote tool names must be unique.'); names.add(remote.name);
    if (!boundedConnectorJson(65536, true).safeParse(remote.inputSchema).success) fail(422, 'unsupported_schema', 'Remote input schema exceeds limits or requires external references.');
    let schemaSupported = true;
    try { inspectConnectorSchema(remote.inputSchema); if (remote.outputSchema) inspectConnectorSchema(remote.outputSchema); }
    catch { schemaSupported = false; }
    const definition = connectorToolSchema.parse({ connectionId: scope.connectionId, remoteName: remote.name, description: remote.description ?? '', inputSchema: remote.inputSchema,
      effect: 'unknown', fingerprint: await connectorFingerprint({ connectionId: scope.connectionId, name: remote.name, description: remote.description ?? '', inputSchema: remote.inputSchema, outputSchema: remote.outputSchema ?? null }) });
    tools.push({ ...definition, id: `${scope.connectionId}:${remote.name}`, schemaSupported });
  }
  const resources = await Promise.all(rawResources.map(async remote => { const value = resourceSchema.parse(remote); return { ...value, id: `${scope.connectionId}:${value.uri}`, connectionId: scope.connectionId, fingerprint: await connectorFingerprint({ connectionId: scope.connectionId, ...value }) }; }));
  const templates = await Promise.all(rawTemplates.map(async remote => { const value = templateSchema.parse(remote); return { ...value, id: `${scope.connectionId}:${value.uriTemplate}`, connectionId: scope.connectionId, fingerprint: await connectorFingerprint({ connectionId: scope.connectionId, ...value }) }; }));
  const catalog = { tools, resources, templates };
  boundedConnectorJson(1048576).parse(catalog);
  return { ...catalog, fingerprint: await connectorFingerprint(catalog) };
}
