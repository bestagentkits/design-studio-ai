import { ConnectorTransportError, validateConnectorUrl } from './connector-network-policy';

export interface ConnectorTransportLimits {
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxHeaderBytes: number;
}
export const connectorTransportDefaults: Readonly<ConnectorTransportLimits> = Object.freeze({
  timeoutMs: 30_000, maxRequestBytes: 1_048_576, maxResponseBytes: 1_048_576, maxHeaderBytes: 16_384,
});
export type ConnectorFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
// Only trusted server composition may supply a transport. Never expose this option through input schemas.
export type ConnectorTransportOptions = {
  runtime: 'node-pinned' | 'workers-public';
  transport: ConnectorFetch;
  limits?: Partial<ConnectorTransportLimits>;
};
const safeError = (error: unknown) => error instanceof ConnectorTransportError ? error : new ConnectorTransportError('Connector request failed or was aborted');
const encoder = new TextEncoder();
function headerSize(headers: Headers) {
  let size = 0;
  headers.forEach((value, name) => { size += encoder.encode(name).length + encoder.encode(value).length + 4; });
  return size;
}

export function createConnectorFetch(options: ConnectorTransportOptions): ConnectorFetch {
  if (!['node-pinned', 'workers-public'].includes(options.runtime) || typeof options.transport !== 'function') throw new ConnectorTransportError('Explicit trusted connector runtime transport required');
  const limits = { ...connectorTransportDefaults, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > ({ timeoutMs: 300_000, maxRequestBytes: 16_777_216, maxResponseBytes: 67_108_864, maxHeaderBytes: 65_536 }[key] ?? 0)) throw new ConnectorTransportError('Invalid connector transport limit');
  }
  return async (input, init) => {
    // Request normalization supports SDK fetch middleware while dropping non-standard routing options.
    if (!(input instanceof Request)) validateConnectorUrl(input);
    let request: Request;
    try { request = new Request(input instanceof URL ? input.href : input, init); }
    catch { throw new ConnectorTransportError('Invalid connector request'); }
    const url = validateConnectorUrl(request.url);
    const headers = new Headers(request.headers);
    for (const name of headers.keys()) {
      if (/^(?:host|cookie|cookie2|connection|upgrade|transfer-encoding|content-length|expect|te|trailer|keep-alive|forwarded|via|proxy-.*|x-forwarded-.*)$/i.test(name)) throw new ConnectorTransportError('Forbidden connector request header');
    }
    headers.set('accept-encoding', 'identity');
    if (headerSize(headers) > limits.maxHeaderBytes) throw new ConnectorTransportError('Connector request headers exceed limit');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let finished = false;
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    // Keep rejection handled while the caller is holding a streaming response without reading it.
    void aborted.catch(() => {});
    const abort = () => {
      const reason = safeError(controller.signal.reason);
      rejectAbort(reason);
      void reader?.cancel(reason).catch(() => {});
      cleanup();
    };
    const forwardAbort = () => controller.abort(request.signal.reason);
    const timer = setTimeout(() => controller.abort(new ConnectorTransportError('Connector request timed out')), limits.timeoutMs);
    const cleanup = () => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      request.signal.removeEventListener('abort', forwardAbort);
      controller.signal.removeEventListener('abort', abort);
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    request.signal.addEventListener('abort', forwardAbort, { once: true });
    if (request.signal.aborted) forwardAbort();
    try {
      controller.signal.throwIfAborted();
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (request.body) {
        reader = request.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const chunk = await Promise.race([reader.read(), aborted]);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limits.maxRequestBytes) throw new ConnectorTransportError('Connector request body exceeds limit');
          chunks.push(chunk.value);
        }
        reader.releaseLock(); reader = undefined;
        body = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      }
      const pending = options.transport(url, { method: request.method, headers, body, signal: controller.signal, redirect: 'manual', credentials: 'omit' });
      // Dispose a late response even if a trusted adapter ignored cancellation.
      void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await Promise.race([pending, aborted]);
      reader = response.body?.getReader();
      if (response.status >= 300 && response.status < 400) throw new ConnectorTransportError('Connector redirects are not allowed');
      if (headerSize(response.headers) > limits.maxHeaderBytes) throw new ConnectorTransportError('Connector response headers exceed limit');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > limits.maxResponseBytes)) throw new ConnectorTransportError('Connector response body exceeds limit');
      // Identity avoids runtime-dependent decompression and compression-bomb behavior.
      if (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new ConnectorTransportError('Connector response must use identity encoding');
      if (!reader) { cleanup(); return response; }
      const responseReader = reader; let size = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            controller.signal.throwIfAborted();
            const chunk = await Promise.race([responseReader.read(), aborted]);
            if (chunk.done) { cleanup(); responseReader.releaseLock(); streamController.close(); return; }
            size += chunk.value.byteLength;
            if (size > limits.maxResponseBytes) throw new ConnectorTransportError('Connector response body exceeds limit');
            streamController.enqueue(chunk.value);
          } catch (error) {
            controller.abort(error); cleanup(); streamController.error(safeError(error));
          }
        },
        async cancel(reason) { controller.abort(reason); cleanup(); await responseReader.cancel(reason).catch(() => {}); },
      }, { highWaterMark: 0 });
      const result = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(result, 'url', { value: url.href });
      return result;
    } catch (error) {
      controller.abort(error); cleanup(); throw safeError(error);
    }
  };
}

/** Use only native Workers global fetch with global_fetch_strictly_public; never a service/private binding. */
export function createWorkersConnectorFetch(limits?: Partial<ConnectorTransportLimits>): ConnectorFetch {
  return createConnectorFetch({ runtime: 'workers-public', transport: globalThis.fetch.bind(globalThis), limits });
}
