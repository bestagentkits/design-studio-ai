import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server/index';
import { promptTemplateSchema, promptTemplates } from '../src/shared/prompt-templates';

test('prompt templates validate and expose through the public catalog', async () => {
  const ids = promptTemplates.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'prompt ids are unique');
  for (const prompt of promptTemplates) {
    assert.doesNotThrow(() => promptTemplateSchema.parse(prompt), `prompt ${prompt.id} is valid`);
    assert.ok(prompt.provider && prompt.model && prompt.aspectRatio, `prompt ${prompt.id} declares provider/model/aspect`);
  }
  assert.ok(promptTemplates.some(p => p.kind === 'image') && promptTemplates.some(p => p.kind === 'motion'), 'both kinds are seeded');

  const response = await app.request('https://studio.example/api/catalog');
  assert.equal(response.status, 200);
  const catalog = await response.json() as { prompts: typeof promptTemplates };
  assert.deepEqual(catalog.prompts, promptTemplates);
});
