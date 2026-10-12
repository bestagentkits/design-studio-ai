// Dual-era Streamable HTTP adapter. The SDK implements the initialize-based revisions; requests from the
// stateless 2026-07-28 revision carry their version in every request, so they are validated here and then
// served by the same stateless SDK transport under the newest legacy revision.
export const modernProtocolVersions = ['2026-07-28'] as const;
export const legacyProtocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const supportedProtocolVersions: readonly string[] = [...modernProtocolVersions, ...legacyProtocolVersions];
const bridgedVersion = legacyProtocolVersions[0];
const meta = { version: 'io.modelcontextprotocol/protocolVersion', capabilities: 'io.modelcontextprotocol/clientCapabilities', serverInfo: 'io.modelcontextprotocol/serverInfo' } as const;
const namedMethods: Record<string, 'name' | 'uri'> = { 'tools/call': 'name', 'resources/read': 'uri', 'prompts/get': 'name' };

type Id = string | number | null;
interface Rpc { jsonrpc?: unknown; id?: Id; method?: unknown; params?: Record<string, unknown> }
export interface McpServerDescription { serverInfo: { name: string; version: string }; instructions: string; capabilities: Record<string, unknown> }
export interface McpRequestInfo { era: 'legacy' | 'modern'; method: string | null; protocolVersion: string | null; id: Id }
export type McpDispatch = { info: McpRequestInfo } & ({ forward: Request } | { response: Response });

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const jsonRpcError = (status: number, id: Id, code: number, message: string, data?: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }), { status, headers: { 'Content-Type': 'application/json' } });
const unsupported = (id: Id, requested: string) => jsonRpcError(400, id, -32022, 'Unsupported protocol version', { supported: supportedProtocolVersions, requested });
const mismatch = (id: Id, message: string) => jsonRpcError(400, id, -32020, `Header mismatch: ${message}`);
function decodeHeader(value: string) {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value)?.[1];
  if (encoded === undefined) return value;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))); }
  catch { return null; }
}
const forward = (raw: Request, body: string, version?: string) => {
  const headers = new Headers(raw.headers);
  headers.delete('Content-Length');
  if (version) headers.set('MCP-Protocol-Version', version);
  return new Request(raw.url, { method: raw.method, headers, body });
};

export async function dispatchMcpRequest(raw: Request, server: McpServerDescription): Promise<McpDispatch> {
  const header = raw.headers.get('MCP-Protocol-Version');
  const body = await raw.text();
  let rpc: unknown;
  try { rpc = JSON.parse(body); } catch { rpc = undefined; }
  const single: Rpc = object(rpc) ? rpc : {};
  const id: Id = typeof single.id === 'string' || typeof single.id === 'number' ? single.id : null;
  const method = typeof single.method === 'string' ? single.method : null;
  const requestMeta = object(single.params?._meta) ? single.params._meta : undefined;
  const metaVersion = typeof requestMeta?.[meta.version] === 'string' ? requestMeta[meta.version] as string : undefined;
  const modernHeader = header !== null && (modernProtocolVersions as readonly string[]).includes(header);
  const modern = method !== 'initialize' && (modernHeader || metaVersion !== undefined);
  const info: McpRequestInfo = { era: modern ? 'modern' : 'legacy', method, protocolVersion: metaVersion ?? header, id };
  if (header !== null && !supportedProtocolVersions.includes(header)) return { info, response: unsupported(id, header) };
  // initialize always selects the legacy handshake, which the SDK negotiates itself.
  if (!modern) return { info, forward: forward(raw, body, modernHeader ? bridgedVersion : undefined) };
  if (!object(rpc)) return { info, response: jsonRpcError(400, null, rpc === undefined ? -32700 : -32600, rpc === undefined ? 'Parse error' : 'Invalid Request: send one JSON-RPC message per POST') };
  // The revision defines no header or _meta requirements for client notifications.
  if (single.id === undefined) return { info, response: new Response(null, { status: 202 }) };
  if (metaVersion === undefined) return { info, response: jsonRpcError(400, id, -32602, `Invalid params: _meta["${meta.version}"] is required`) };
  // Legacy versions are negotiated through initialize, never declared per request.
  if (!(modernProtocolVersions as readonly string[]).includes(metaVersion)) return { info, response: unsupported(id, metaVersion) };
  if (header !== metaVersion) return { info, response: mismatch(id, `MCP-Protocol-Version header ${header === null ? 'is missing' : `'${header}'`} does not match _meta value '${metaVersion}'`) };
  const methodHeader = raw.headers.get('Mcp-Method');
  if (methodHeader !== method) return { info, response: mismatch(id, `Mcp-Method header ${methodHeader === null ? 'is missing' : `'${methodHeader}'`} does not match body method '${method}'`) };
  const nameField = method ? namedMethods[method] : undefined;
  if (nameField) {
    const nameHeader = raw.headers.get('Mcp-Name');
    const decoded = nameHeader === null ? null : decodeHeader(nameHeader);
    if (decoded === null || decoded !== single.params?.[nameField]) return { info, response: mismatch(id, `Mcp-Name header ${nameHeader === null ? 'is missing' : 'does not match'} params.${nameField}`) };
  }
  if (!object(requestMeta?.[meta.capabilities])) return { info, response: jsonRpcError(400, id, -32602, `Invalid params: _meta["${meta.capabilities}"] is required`) };
  if (method === 'server/discover') return { info, response: new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {
    resultType: 'complete', supportedVersions: supportedProtocolVersions, capabilities: server.capabilities,
    _meta: { [meta.serverInfo]: server.serverInfo }, instructions: server.instructions,
  } }), { headers: { 'Content-Type': 'application/json' } }) };
  return { info, forward: forward(raw, body, bridgedVersion) };
}

// Results gain the modern resultType and serverInfo; status codes follow the modern HTTP binding.
export async function completeModernResponse(response: Response, server: McpServerDescription): Promise<Response> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) return response;
  const message = await response.json() as { result?: Record<string, unknown>; error?: { code?: number } };
  let status = response.status;
  if (object(message.result)) message.result = { resultType: 'complete', ...message.result, _meta: { ...(object(message.result._meta) ? message.result._meta : {}), [meta.serverInfo]: server.serverInfo } };
  else if (message.error?.code === -32601) status = 404;
  else if (message.error?.code === -32002) message.error.code = -32602;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(JSON.stringify(message), { status, headers });
}
