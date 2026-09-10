import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker';

export async function probeClient(endpoint, modern) {
  const client = new Client({ name: 'studio-interoperability-probe', version: '1.0' }, {
    versionNegotiation: { mode: modern ? { pin: '2026-07-28' } : 'legacy' },
    jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  try {
    await client.connect(transport, { timeout: 5000 });
    const catalog = await client.listTools({}, { timeout: 5000 });
    const result = await client.callTool({ name: 'sum', arguments: { a: 17, b: 25 } }, undefined, { timeout: 5000 });
    if (catalog.tools[0]?.name !== 'sum' || result.content[0]?.text !== '42') throw new Error('Unexpected tool output');
    return { protocol: client.getNegotiatedProtocolVersion(), era: client.getProtocolEra(), result: result.content[0].text };
  } finally {
    await client.close();
  }
}
