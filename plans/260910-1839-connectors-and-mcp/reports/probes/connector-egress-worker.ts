import { createWorkersConnectorFetch } from '../../../../server/connector-transport';
export default {
  async fetch() {
    const endpoint = 'https://beta.studio.agentkit.best/api/health';
    const healthy = await createWorkersConnectorFetch()(endpoint);
    const result = await healthy.json();
    let bounded = false;
    try { await (await createWorkersConnectorFetch({ maxResponseBytes: 1 })(endpoint)).text(); }
    catch { bounded = true; }
    let privateRejected = false;
    try { await createWorkersConnectorFetch()('https://127.0.0.1/'); }
    catch { privateRejected = true; }
    return Response.json({ healthy: healthy.status === 200, result, bounded, privateRejected });
  },
};
