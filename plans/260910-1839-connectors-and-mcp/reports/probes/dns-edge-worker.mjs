const targets = {
  control: 'https://example.com',
  loopback: 'https://d5cf-egress-loopback.beta.studio.agentkit.best',
  private: 'https://d5cf-egress-private.beta.studio.agentkit.best',
  linklocal: 'https://d5cf-egress-linklocal.beta.studio.agentkit.best',
  ipv6: 'https://d5cf-egress-ipv6.beta.studio.agentkit.best',
  mapped: 'https://d5cf-egress-mapped.beta.studio.agentkit.best',
  cname: 'https://d5cf-egress-cname.beta.studio.agentkit.best',
  rebind: 'https://d5cf-egress-rebind.beta.studio.agentkit.best',
};
export default {
  async fetch(request) {
    const label = new URL(request.url).pathname.slice(1);
    const target = targets[label];
    if (!target) return new Response('Unknown probe', { status: 404 });
    const started = Date.now();
    try {
      const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const body = await response.text();
      return Response.json({ label, target, status: response.status, elapsedMs: Date.now() - started,
        errorCode: body.match(/error code: (\d+)/i)?.[1] ?? null,
        title: body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null });
    } catch (error) {
      return Response.json({ label, target, elapsedMs: Date.now() - started, error: error.message });
    }
  },
};
