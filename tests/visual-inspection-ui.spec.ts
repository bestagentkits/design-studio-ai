import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';

test('visual tools follow workspace/editor navigation and return real saved images', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const registry = new Map<string, any>();
    (window as any).inspectionRegistry = registry;
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: (tool: any) => { if (registry.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`); registry.set(tool.name, tool); },
      unregisterTool: (name: string) => registry.delete(name),
    } });
  });
  const document = createDocument('slides', 'Visual navigation');
  document.theme.fonts = { heading: 'Arial', body: 'Arial' };
  document.pages = [{ id: 'cover', name: 'Cover', width: 320, height: 240, background: '#2468ac', nodes: [] }];
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: document.name, kind: document.kind, document } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const toolNames = () => page.evaluate(() => [...(window as any).inspectionRegistry.keys()] as string[]);
  const inspect = () => page.evaluate(async (id: string) => {
    const result = await (window as any).inspectionRegistry.get('studio_api_post_projects_id_inspect').execute({ parameters: { id }, body: { mode: 'page', pageId: 'cover', expectedRevision: 1, maxDimension: 256 } });
    return { types: result.content.map((item: any) => item.type), metadata: JSON.parse(result.content[0].text), signature: result.content[1]?.data.slice(0, 11) };
  }, project.id);
  await page.goto('/');
  await expect.poll(toolNames).toContain('studio_api_post_projects_id_inspect');
  let result = await inspect();
  expect(result.types).toEqual(['text', 'image']); expect(result.signature).toBe('iVBORw0KGgo');
  expect(result.metadata.items[0].revision).toBe(1); expect(result.metadata.images[0].width).toBe(256);
  // Client-side navigation exercises cleanup order between parent workspace and child editor.
  await page.evaluate(id => { history.pushState({}, '', `/?project=${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, project.id);
  await expect.poll(toolNames).toContain('studio_get_design');
  await expect.poll(toolNames).toContain('studio_api_post_projects_id_inspect');
  result = await inspect(); expect(result.types).toEqual(['text', 'image']);
  await page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect.poll(toolNames).not.toContain('studio_get_design');
  await expect.poll(toolNames).toContain('studio_api_post_projects_inspect');
  result = await inspect(); expect(result.metadata.source).toBe('saved');
  await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } });
});
