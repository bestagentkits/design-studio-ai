import { extractSourcePdf } from '../../../../server/connectors/google-content';

/** Isolated benchmark: accept only authenticated, size-bounded PDF input. */
export default {
  async fetch(request: Request, env: { PROBE_TOKEN?: string }) {
    if (!env.PROBE_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.PROBE_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const reader = request.body?.getReader();
    if (!reader) return new Response('PDF required', { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 2097153) { await reader.cancel(); return Response.json({ code: 'limit_exceeded' }, { status: 413 }); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try {
      const result = await extractSourcePdf(bytes);
      return Response.json({ inputBytes: size, extractedBytes: result.length, hasExpectedText: new TextDecoder().decode(result).includes('Studio PDF runtime acceptance') });
    } catch (error) {
      const failure = error as { status?: number; code?: string };
      return Response.json({ code: failure.code || 'unexpected_failure' }, { status: failure.status || 500 });
    }
  },
};
