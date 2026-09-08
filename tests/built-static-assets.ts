import { readFile } from 'node:fs/promises';

// Integration tests serve the actual built viewer instead of assuming every document is static.
export const builtStaticAssets = {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (!['/studio-viewer.js', '/studio-renderer.js', '/studio-geometry-worker.js', '/studio-react-runtime.json'].includes(path)) return new Response('Not found', { status: 404 });
    return new Response(await readFile(new URL(`../public${path}`, import.meta.url)), { headers: { 'Content-Type': path.endsWith('.json') ? 'application/json' : 'text/javascript' } });
  },
};
