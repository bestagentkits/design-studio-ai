import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { assertPublicConnectorAddresses, validateConnectorUrl } from './connector-network-policy';
import { createConnectorFetch, connectorTransportDefaults, type ConnectorTransportLimits, type ConnectorFetch } from './connector-transport';

/** Server-only resolver injection supports deterministic tests; never bind it to caller configuration. */
export function createNodeConnectorFetch(limits?: Partial<ConnectorTransportLimits>, resolve = lookup): ConnectorFetch {
  const maxHeaderSize = limits?.maxHeaderBytes ?? connectorTransportDefaults.maxHeaderBytes;
  const pinned: ConnectorFetch = async (input, init) => {
    const url = validateConnectorUrl(input instanceof Request ? input.url : input);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const addresses = family ? [{ address: hostname, family }] : await resolve(hostname, { all: true, verbatim: true });
    assertPublicConnectorAddresses(addresses);
    init?.signal?.throwIfAborted();
    const selected = addresses[0];
    return new Promise<Response>((accept, reject) => {
      // Per-request socket and fixed lookup result prevent stale pooled connections or second DNS answers.
      const outgoing = httpsRequest(url, {
        method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)),
        agent: false, maxHeaderSize, signal: init?.signal ?? undefined,
        servername: family ? undefined : hostname,
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [selected]); else callback(null, selected.address, selected.family);
        },
      }, incoming => {
        try {
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        const status = incoming.statusCode ?? 502;
        const empty = init?.method === 'HEAD' || [204, 205, 304].includes(status);
        const stream = empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        if (empty) incoming.resume();
        accept(new Response(stream, { status, statusText: incoming.statusMessage, headers }));
        } catch (error) { incoming.destroy(); outgoing.destroy(); reject(error); }
      });
      outgoing.once('error', reject);
      outgoing.end(init?.body);
    });
  };
  return createConnectorFetch({ runtime: 'node-pinned', transport: pinned, limits });
}
