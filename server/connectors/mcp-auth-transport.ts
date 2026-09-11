import type { Bindings } from '../types';
import type { ConnectorFetch } from '../connector-transport';
import { validateConnectorUrl } from '../connector-network-policy';
import { ApiError, fail } from '../security';

/** OAuth uses the same public-network boundary; SDK fallbacks cannot swallow a transport rejection. */
export async function withMcpAuthFetch<T>(env: Bindings, callback: (fetcher: ConnectorFetch) => Promise<T>): Promise<T> {
  if (!env.CONNECTOR_FETCH) fail(503,'connector_unconfigured','Connector transport is unavailable.');
  const transport = env.CONNECTOR_FETCH!, controller = new AbortController(); let requests = 0, failure: ApiError | undefined;
  const timer = setTimeout(() => controller.abort(),30000);
  const fetcher: ConnectorFetch = async (input,init) => {
    try {
      if (++requests > 12 || controller.signal.aborted) fail(408,'connector_timeout','OAuth request budget exhausted.');
      const request = new Request(input,init); validateConnectorUrl(request.url);
      const response = await transport(request,{redirect:'manual',signal:AbortSignal.any([request.signal,controller.signal])});
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); fail(400,'unsafe_destination','OAuth redirects are not permitted.'); }
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
      if (reader) try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength;
        if (length > 65536) fail(413,'limit_exceeded','OAuth response exceeds 64 KiB.'); chunks.push(next.value); }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (controller.signal.aborted) fail(408,'connector_timeout','OAuth request deadline exceeded.');
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      return new Response(length ? bytes : null,{status:response.status,headers:response.headers});
    } catch (error) {
      failure = error instanceof ApiError ? error : new ApiError(400,'oauth_transport_failed','OAuth transport failed.');
      throw new TypeError('OAuth transport failed.');
    }
  };
  try { return await callback(fetcher); }
  catch (error) { if (failure) throw failure; if (error instanceof ApiError) throw error; return fail(400,'oauth_failed','OAuth authorization failed. Restart authorization.'); }
  finally { clearTimeout(timer); controller.abort(); }
}
