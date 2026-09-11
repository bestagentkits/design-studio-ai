import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { registerDesignTools } from '../src/app/browser-design-tools';
import { createDocument } from '../src/shared/catalog';
import { operationsSchema } from '../src/shared/operations';
import { documentWriteSchema } from '../src/shared/document-write';

test('browser registration stays compact while retaining canonical validation and discovery', async () => {
  let document = createDocument('web');
  type Tool = Parameters<Parameters<typeof registerDesignTools>[0]['registerTool']>[0];
  const tools = new Map<string, Tool>();
  const unregister = registerDesignTools({ registerTool: tool => tools.set(tool.name, tool), unregisterTool: name => { tools.delete(name); } }, () => document, next => { document = next; });
  // Conservative regression budgets, not a claim about every host's exact limits.
  const metadata = [...tools.values()].map(({ execute, ...tool }) => tool);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata)) < 32000);
  for (const tool of metadata) assert.ok(Buffer.byteLength(JSON.stringify(tool)) < 4096, tool.name);
  const capabilities = await tools.get('studio_capabilities')!.execute({}) as { content: { text: string }[] };
  const schemas = JSON.parse(capabilities.content[0].text);
  assert.deepEqual(schemas.operations, z.toJSONSchema(operationsSchema));
  assert.deepEqual(schemas.documentWrite, z.toJSONSchema(documentWriteSchema));
  const apply = tools.get('studio_apply_operations')!;
  await apply.execute({ operations: [{ op: 'rename', name: 'Editable through WebMCP' }] });
  assert.equal(document.name, 'Editable through WebMCP');
  const before = structuredClone(document);
  await assert.rejects(apply.execute({ operations: [{ op: 'rename', name: 'Must not apply' }, { op: 'add-node', pageId: document.pages[0].id, node: { id: 'invalid' } }] }));
  assert.deepEqual(document, before, 'invalid nested nodes must reject the whole batch');
  await assert.rejects(apply.execute({ operations: [{ op: 'unknown-operation' }] }));
  assert.deepEqual(document, before);
  assert.ok(tools.has('studio_api_put_projects_id_document'));
  assert.ok(tools.has('studio_api_post_projects_id_assets'));
  assert.ok(![...tools.keys()].some(name => name.includes('tokens') || name.includes('auth')));
  unregister();
  assert.equal(tools.size, 0);
});
