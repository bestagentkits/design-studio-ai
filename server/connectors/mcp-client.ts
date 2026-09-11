import { Client, StreamableHTTPClientTransport, SdkError, SdkErrorCode, UnsupportedProtocolVersionError, type JsonSchemaType, type JsonSchemaValidator, type RequestOptions } from '@modelcontextprotocol/client';
import type { Bindings } from '../types';
import type { ConnectionRow } from '../connection-store';
import type { ConnectorCredential } from '../connector-credentials';
import { connectorEndpointSchema } from '../../src/shared/connector-values';
import { ConnectorSchemaError, validateConnectorArguments } from '../connector-schema-validation';
import { ApiError, fail } from '../security';
import { mcpResourceMatchesEndpoint } from './mcp-auth-resource';

export type McpProfile = 'auto' | 'modern' | 'legacy';
export interface McpRequestScope { client: Client; connectionId: string; requestOptions: RequestOptions }
const safeValidator = {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    return input => {
      try { validateConnectorArguments(schema, input); return { valid: true, data: input as T, errorMessage: undefined }; }
      catch (error) {
        if (error instanceof ConnectorSchemaError && error.code !== 'invalid_tool_arguments') fail(422, 'unsupported_schema', 'Remote schema is outside the supported validation profile.');
        return { valid: false, data: undefined, errorMessage: 'Remote content does not match its schema.' };
      }
    };
  },
};

// Hold the slot through streamed body consumption, not merely receipt of response headers.
function trackResponse(response: Response, release: () => void, signal: AbortSignal) {
  const reader = response.body!.getReader();
  let released = false;
  const done = () => { if (!released) { released = true; signal.removeEventListener('abort', done); release(); } };
  signal.addEventListener('abort', done, { once: true });
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const chunk = await reader.read(); if (chunk.done) { done(); controller.close(); } else controller.enqueue(chunk.value); }
      catch (error) { done(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { done(); } },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Server-owned scope only. No OAuth discovery, refresh, automatic sampling, roots or remote execution. */
export async function withMcpClient<T>(env: Bindings, connection: ConnectionRow, credential: ConnectorCredential | undefined,
  callback: (scope: McpRequestScope) => Promise<T>, options: { profile?: McpProfile; timeoutMs?: number } = {}) {
  if (!env.CONNECTOR_FETCH) fail(503, 'connector_unconfigured', 'Connector transport is unavailable.');
  if (connection.adapter !== 'mcp' || !connection.endpoint) fail(400, 'unsupported_protocol', 'An HTTP MCP connection is required.');
  if (connection.status === 'disconnected') fail(409, 'connection_revoked', 'Connection is disconnected.');
  if (connection.status === 'needs_reauthorization') fail(409, 'needs_reauthorization', 'Reconnect this account.');
  const endpoint = new URL(connectorEndpointSchema.parse(connection.endpoint)).href;
  const resourceMatches = !!credential && mcpResourceMatchesEndpoint(credential.resource, endpoint);
  const profile = options.profile ?? 'auto';
  if (!['auto', 'modern', 'legacy'].includes(profile)) fail(400, 'unsupported_protocol', 'Select a supported MCP profile.');
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) fail(400, 'invalid_input', 'Invalid MCP request deadline.');
  if (connection.auth_mode !== 'anonymous' && (!credential || !resourceMatches || credential.tokenType !== 'Bearer' || !credential.accessToken || /[\r\n]/.test(credential.accessToken)))
    fail(409, 'needs_reauthorization', 'Credentials do not match this connection resource.');
  // Snapshot authority so callback mutations cannot redirect or replace credentials mid-request.
  const bearer = connection.auth_mode === 'anonymous' ? undefined : credential!.accessToken;
  const fetcher = env.CONNECTOR_FETCH, controller = new AbortController();
  let active = true, closing = false, transportFailure: ApiError | undefined;
  let dispatches = 0, inFlight = 0;
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: async (input, init) => {
      let release: (() => void) | undefined;
      try {
        if (!active || controller.signal.aborted) return fail(408, 'connector_timeout', 'MCP request deadline exceeded.');
        const request = new Request(input, init);
        if (closing && request.method !== 'DELETE') fail(409, 'connection_closed', 'MCP request scope is closing.');
        if (request.url !== endpoint) fail(400, 'unsafe_destination', 'MCP requests must use the exact configured endpoint.');
        if (!closing && (++dispatches > 64 || inFlight >= 4)) {
          transportFailure = new ApiError(413, 'limit_exceeded', 'MCP HTTP request budget exceeded.'); controller.abort(); throw transportFailure;
        }
        inFlight++; let released = false; release = () => { if (!released) { released = true; inFlight--; } };
        const headers = new Headers(request.headers); headers.delete('authorization');
        if (bearer) headers.set('authorization', `Bearer ${bearer}`);
        const response = await fetcher(request, { headers, redirect: 'manual', signal: AbortSignal.any([request.signal, controller.signal]) });
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); fail(400, 'unsafe_destination', 'MCP redirects are not supported.'); }
        if ([401, 403].includes(response.status)) { await response.body?.cancel(); fail(409, 'needs_reauthorization', 'MCP access was denied. Reconnect or update permissions.'); }
        if (!response.body || response.status === 202 || response.status >= 400) { await response.body?.cancel(); release(); return new Response(null, { status: response.status, headers: response.headers }); }
        return trackResponse(response, release, controller.signal);
      } catch (error) { release?.(); if (error instanceof ApiError && !transportFailure) transportFailure = error; throw error; }
    },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  const client = new Client({ name: 'design-studio-ai-connector', version: '1' }, {
    inputRequired: { autoFulfill: false },
    versionNegotiation: { mode: profile === 'modern' ? { pin: '2026-07-28' } : profile, probe: { maxRetries: 0 } }, jsonSchemaValidator: safeValidator, listMaxPages: 10,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ApiError(408, 'connector_timeout', 'MCP request deadline exceeded.')); }, timeout); });
  try {
    return await Promise.race([deadline, (async () => {
      const requestOptions = { timeout, maxTotalTimeout: timeout, signal: controller.signal };
      await client.connect(transport, requestOptions);
      const expected = profile === 'auto' ? ['2026-07-28', '2025-11-25'] : [profile === 'modern' ? '2026-07-28' : '2025-11-25'];
      if (!expected.includes(client.getNegotiatedProtocolVersion() ?? '')) fail(409, 'unsupported_protocol', 'The remote MCP protocol profile is unsupported.');
      const result = await callback({ client, connectionId: connection.id, requestOptions });
      if (transportFailure) throw transportFailure;
      if (controller.signal.aborted) fail(408, 'connector_timeout', 'MCP request deadline exceeded.');
      return result;
    })()]);
  } catch (error) {
    if (transportFailure) throw transportFailure;
    if (error instanceof ApiError) throw error;
    if (error instanceof UnsupportedProtocolVersionError || error instanceof SdkError && error.code === SdkErrorCode.EraNegotiationFailed) fail(409, 'unsupported_protocol', 'The remote MCP protocol profile is unsupported.');
    if (controller.signal.aborted || error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) fail(408, 'connector_timeout', 'MCP request deadline exceeded.');
    fail(502, 'mcp_request_failed', 'The remote MCP request failed.');
  } finally {
    if (timer) clearTimeout(timer); closing = true;
    if (transport.sessionId && !controller.signal.aborted) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([transport.terminateSession(), new Promise<void>(resolve => { cleanupTimer = setTimeout(() => { controller.abort(); resolve(); }, 2000); })]);
      } catch { /* Remote cleanup failure cannot replace the operation outcome. */ }
      finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
    }
    active = false; controller.abort();
    await client.close().catch(() => undefined); await transport.close().catch(() => undefined);
  }
}
