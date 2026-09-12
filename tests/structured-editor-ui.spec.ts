import { test, expect } from './authenticated-browser';
import type { Page, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument, Project } from '../src/shared/schema';

async function createProject(page: Page, baseURL: string, document: DesignDocument) {
  const headers = { Origin: new URL(baseURL).origin };
  const response = await page.request.post('/api/projects', { headers, data: { name: document.name, kind: document.kind, document } });
  expect(response.status()).toBe(201);
  return (await response.json() as { project: Project }).project;
}
async function readProject(page: Page, id: string): Promise<Project> {
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json() as { project: Project }).project;
}
async function mobilePanel(page: Page, info: TestInfo, name: 'Chat & layers' | 'Design' | 'Canvas') {
  if (await page.locator('.mobile-editor-nav').isVisible()) await page.locator('.mobile-editor-nav').getByRole('button', { name, exact: true }).click();
}
async function selectLayer(page: Page, info: TestInfo, name: string) {
  await mobilePanel(page, info, 'Chat & layers');
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('tree', { name: 'Layers' }).getByRole('button', { name, exact: true }).click();
}
async function openProject(page: Page, id: string) {
  await page.goto(`/?project=${id}`);
  await expect(page.getByRole('button', { name: 'Back to workspace' })).toBeVisible();
}
async function saveProject(page: Page, id: string) {
  const response = page.waitForResponse(response => response.url().includes(`/api/projects/${id}/operations/`) && response.url().endsWith('/result') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
}
function editorDocument() {
  const doc = createDocument('web', 'Structured editor browser verification');
  doc.pages = [{ id: 'page', name: 'Main page', width: 600, height: 500, background: '#fff', nodes: [
    { id: 'frame', name: 'Content frame', type: 'frame', x: 30, y: 30, width: 400, height: 200 },
    { id: 'alpha', name: 'Alpha layer', type: 'shape', parentId: 'frame', x: 50, y: 70, width: 80, height: 40, style: { fill: '#2563eb' } },
    { id: 'beta', name: 'Beta layer', type: 'shape', parentId: 'frame', x: 170, y: 70, width: 80, height: 40, style: { fill: '#16a34a' } },
    { id: 'checkbox', name: 'Email preference', type: 'component', x: 50, y: 280, width: 250, height: 50, component: { name: 'Checkbox', system: 'shadcn', props: { label: 'Email updates', checked: false } } },
  ] }];
  return doc;
}

test('hierarchical grouping saves and reloads, numeric shortcuts and canvas controls work, components preview interactively', async ({ page, baseURL }, info) => {
  const document = editorDocument();
  document.pages[0].nodes.find(node => node.id === 'alpha')!.interactions = [{ trigger: 'click', action: 'toggle', target: 'beta' }, { trigger: 'hover', action: 'navigate', target: 'page' }];
  const project = await createProject(page, baseURL!, document), headers = { Origin: baseURL! };
  try {
    await openProject(page, project.id);
    await mobilePanel(page, info, 'Canvas');
    await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
    await selectLayer(page, info, 'Alpha layer');
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.getByRole('button', { name: 'Expand Content frame', exact: true }).click();
    await expect(tree.getByRole('button', { name: 'Alpha layer', exact: true })).toHaveCount(0);
    await tree.getByRole('button', { name: 'Expand Content frame', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Alpha layer for grouping', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select Beta layer for grouping', exact: true }).check();
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect(tree.getByRole('button', { name: 'Group', exact: true })).toBeVisible();
    await saveProject(page, project.id);
    const grouped = await readProject(page, project.id), group = grouped.document.pages[0].nodes.find(node => node.type === 'group')!;
    expect(group.parentId).toBe('frame');
    expect(grouped.document.pages[0].nodes.filter(node => node.parentId === group.id).map(node => node.id).sort()).toEqual(['alpha', 'beta']);
    await page.reload(); await expect(page.getByRole('button', { name: 'Back to workspace' })).toBeVisible();
    await mobilePanel(page, info, 'Canvas'); await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
    await selectLayer(page, info, 'Group');
    await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
    await saveProject(page, project.id);
    const ungrouped = (await readProject(page, project.id)).document.pages[0].nodes;
    expect(ungrouped.some(node => node.type === 'group')).toBe(false);
    const alpha = ungrouped.find(node => node.id === 'alpha')!;
    expect(alpha.parentId).toBe('frame'); expect(alpha.x).toBeCloseTo(50, 3); expect(alpha.y).toBeCloseTo(70, 3);
    await selectLayer(page, info, 'Alpha layer');
    await mobilePanel(page, info, 'Design');
    const x = page.getByLabel('X', { exact: true });
    await x.focus(); await x.press('Shift+ArrowUp'); await expect(x).toHaveValue('60');
    await x.press('Shift+ArrowDown'); await expect(x).toHaveValue('50');
    await mobilePanel(page, info, 'Canvas');
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) await expect(page.getByRole('button', { name: `Transform ${handle}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transform rotate', exact: true })).toBeVisible();
    const beforeResize = (await readProject(page, project.id)).document.pages[0].nodes.find(node => node.id === 'alpha')!;
    const alphaBox = (await page.getByRole('button', { name: 'Alpha layer, shape', exact: true }).boundingBox())!, seBox = (await page.getByRole('button', { name: 'Transform se', exact: true }).boundingBox())!;
    const canvasScale = alphaBox.width / beforeResize.width, resizeX = 24, resizeY = 16;
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2); await page.mouse.down();
    await page.mouse.move(seBox.x + seBox.width / 2 + resizeX, seBox.y + seBox.height / 2 + resizeY, { steps: 8 }); await page.mouse.up();
    const zoom = page.locator('.zoom-value'), before = await zoom.textContent();
    await page.locator('.canvas-viewport').hover();
    if (info.project.name === 'webkit' && info.project.use.isMobile) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    else { await page.keyboard.down('Control'); await page.mouse.wheel(0, -80); await page.keyboard.up('Control'); }
    await expect(zoom).not.toHaveText(before!);
    await page.getByRole('button', { name: 'Fit to canvas', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Email updates', exact: true });
    await expect(checkbox).not.toBeChecked(); await checkbox.click(); await expect(checkbox).toBeChecked();
    expect((await readProject(page, project.id)).document.pages[0].nodes.find(node => node.id === 'checkbox')!.component!.props!.checked).toBe(false);
    await page.getByRole('button', { name: 'Edit', exact: true }).click(); await mobilePanel(page, info, 'Design');
    await page.locator('.inspector').getByRole('button', { name: 'Page', exact: true }).click();
    await page.getByRole('button', { name: 'Copy page', exact: true }).click(); await saveProject(page, project.id);
    const pages = (await readProject(page, project.id)).document.pages; expect(pages).toHaveLength(2);
    const resized = pages.find(candidate => candidate.id === 'page')!.nodes.find(node => node.id === 'alpha')!;
    expect(resized.x).toBeCloseTo(beforeResize.x, 3); expect(resized.y).toBeCloseTo(beforeResize.y, 3);
    expect(Math.abs(resized.width - (beforeResize.width + resizeX / canvasScale))).toBeLessThan(2);
    expect(Math.abs(resized.height - (beforeResize.height + resizeY / canvasScale))).toBeLessThan(2);
    const copied = pages.find(candidate => candidate.id !== 'page')!, copiedAlpha = copied.nodes.find(node => node.name === 'Alpha layer')!;
    const copiedBeta = copied.nodes.find(node => node.name === 'Beta layer')!, copiedFrame = copied.nodes.find(node => node.name === 'Content frame')!;
    expect(copiedAlpha.id).not.toBe('alpha'); expect(copiedAlpha.parentId).toBe(copiedFrame.id);
    expect(copiedAlpha.interactions).toEqual([{ trigger: 'click', action: 'toggle', target: copiedBeta.id }, { trigger: 'hover', action: 'navigate', target: copied.id }]);
    expect(pages.find(candidate => candidate.id === 'page')!.nodes.find(node => node.id === 'alpha')!.interactions).toEqual(document.pages[0].nodes.find(node => node.id === 'alpha')!.interactions);
  } finally { info.setTimeout(info.timeout + 10_000); expect((await page.request.delete(`/api/projects/${project.id}`, { headers })).status()).toBe(200); }
});

test('live remote changes appear without reload and undo preserves the remote edit', async ({ page, baseURL }, info) => {
  const project = await createProject(page, baseURL!, editorDocument()), headers = { Origin: baseURL! };
  try {
    await openProject(page, project.id); await selectLayer(page, info, 'Alpha layer'); await mobilePanel(page, info, 'Design');
    let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.getByLabel('X', { exact: true }).fill('80');
    await expect.poll(async () => (await readProject(page, project.id)).document.pages[0].nodes.find(node => node.id === 'alpha')!.x).toBe(80);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const latest = await readProject(page, project.id), remote = structuredClone(latest.document);
    remote.pages[0].nodes.find(node => node.id === 'alpha')!.y = 100;
    const saved = await page.request.put(`/api/projects/${project.id}/document`, { headers, data: { document: remote, expectedRevision: latest.revision } });
    expect(saved.status()).toBe(200);
    await expect(page.getByLabel('Y', { exact: true })).toHaveValue('100');
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('80');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('50');
    await expect(page.getByLabel('Y', { exact: true })).toHaveValue('100');
    await expect.poll(async () => { const node = (await readProject(page, project.id)).document.pages[0].nodes.find(node => node.id === 'alpha')!; return [node.x, node.y]; }).toEqual([50, 100]);
    expect(navigations).toBe(0);
  } finally { info.setTimeout(info.timeout + 10_000); expect((await page.request.delete(`/api/projects/${project.id}`, { headers })).status()).toBe(200); }
});

test('manual Save merges a remote edit and Undo changes only the human field', async ({ page, baseURL }, info) => {
  const project = await createProject(page, baseURL!, editorDocument()), headers = { Origin: baseURL! };
  try {
    await openProject(page, project.id); await mobilePanel(page, info, 'Canvas');
    await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
    await selectLayer(page, info, 'Alpha layer'); await mobilePanel(page, info, 'Design');
    await page.getByLabel('X', { exact: true }).fill('80');
    const remote = structuredClone(project.document); remote.pages[0].nodes.find(node => node.id === 'alpha')!.y = 100;
    expect((await page.request.put(`/api/projects/${project.id}/document`, { headers, data: { document: remote, expectedRevision: project.revision } })).status()).toBe(200);
    await mobilePanel(page, info, 'Canvas');
    await page.getByRole('checkbox', { name: 'Live', exact: true }).check();
    const saving = page.waitForResponse(response => response.url().endsWith(`/api/projects/${project.id}/merge`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await mobilePanel(page, info, 'Design');
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('50');
    await expect(page.getByLabel('Y', { exact: true })).toHaveValue('100');
    await expect.poll(async () => { const node = (await readProject(page, project.id)).document.pages[0].nodes.find(node => node.id === 'alpha')!; return [node.x, node.y]; }).toEqual([50, 100]);
  } finally { info.setTimeout(info.timeout + 10_000); expect((await page.request.delete(`/api/projects/${project.id}`, { headers })).status()).toBe(200); }
});

test('API playground sends authenticated real GET and POST requests and displays persisted results', async ({ page, baseURL }, info) => {
  const project = await createProject(page, baseURL!, editorDocument()), headers = { Origin: baseURL! }, ids = [project.id];
  try {
    await page.goto('/docs/api');
    const playground = page.locator('.api-playground');
    await expect(playground.locator('pre').last()).toContainText(`${baseURL}/api/health`);
    await expect(playground.locator('pre').last()).toContainText('$DESIGN_STUDIO_API_KEY');
    await playground.getByRole('textbox', { name: 'Query parameters' }).fill('q=Inter&version=1');
    await expect(playground.locator('pre').last()).toContainText('?q=Inter&version=1');
    await playground.getByRole('combobox', { name: 'Endpoint', exact: true }).selectOption({ label: 'POST /api/projects/{id}/assets — Upload a file (WebMCP converts base64 to multipart)' });
    await expect(playground.locator('pre').last()).toContainText("-F 'file=@/path/to/asset'");
    await expect(playground.locator('pre').last()).not.toContainText('application/json');
    await playground.getByRole('textbox', { name: 'Query parameters' }).fill('');
    await playground.getByRole('combobox', { name: 'Endpoint', exact: true }).selectOption({ label: 'GET /api/projects — List your projects' });
    await playground.getByRole('button', { name: 'Execute GET', exact: true }).click();
    await expect(playground.locator('pre').first()).toContainText(project.id);
    await expect(playground.locator('[aria-live="polite"]')).toContainText('200');
    await playground.getByRole('combobox', { name: 'Endpoint', exact: true }).selectOption({ label: 'POST /api/projects — Create a project' });
    const name = `Created in API playground ${randomUUID()}`;
    await playground.getByRole('textbox', { name: 'JSON body', exact: true }).fill(JSON.stringify({ name, kind: 'slides' }));
    const creating = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await playground.getByRole('button', { name: 'Execute POST', exact: true }).click();
    const response = await creating; expect(response.status()).toBe(201);
    const created = (await response.json() as { project: Project }).project; ids.push(created.id);
    await expect(playground.locator('pre').first()).toContainText(created.id);
    await expect(playground.locator('[aria-live="polite"]')).toContainText('201');
    expect(await readProject(page, created.id)).toMatchObject({ name, kind: 'slides', revision: 1 });
  } finally { info.setTimeout(info.timeout + 10_000); for (const id of ids) expect((await page.request.delete(`/api/projects/${id}`, { headers })).status()).toBe(200); }
});

test('published slides navigate and show overview while presenter notes stay owner-only', async ({ page, baseURL }, info) => {
  const doc = createDocument('slides', 'Presentation browser verification'), privateNote = `Private presenter note ${randomUUID()}`;
  doc.pages = [1, 2].map(index => ({ id: `slide-${index}`, name: `Slide ${index}`, width: 800, height: 450, background: '#fff', notes: privateNote, nodes: [{ id: `title-${index}`, name: `Slide ${index} heading`, type: 'text', x: 60, y: 60, width: 650, height: 80, text: `Public slide ${index}`, style: { fill: '#111', fontSize: 40 } }] }));
  const project = await createProject(page, baseURL!, doc), headers = { Origin: baseURL! };
  try {
    await openProject(page, project.id); await mobilePanel(page, info, 'Canvas');
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Presenter window', exact: true }).click();
    const presenter = await popupPromise; await expect(presenter.locator('#notes')).toContainText(privateNote); await presenter.close();
    await page.getByRole('button', { name: 'Close presentation', exact: true }).click();
    const response = await page.request.post(`/api/projects/${project.id}/publish`, { headers }); expect(response.status()).toBe(200);
    const { url } = await response.json() as { url: string };
    const publicContext = await page.context().browser()!.newContext();
    try {
      const publicPage = await publicContext.newPage(), html = await publicPage.goto(url + '#slide=1.5');
      expect(html?.status()).toBe(200); expect(await html!.text()).not.toContain(privateNote);
      await expect(publicPage.getByRole('navigation', { name: 'Presentation controls' })).toBeVisible();
      await expect(publicPage.locator('main')).toContainText('Public slide 1');
      await publicPage.getByRole('button', { name: 'Next slide', exact: true }).click();
      await expect(publicPage.locator('main')).toContainText('Public slide 2');
      await expect(publicPage).toHaveURL(/slide=2/);
      await publicPage.getByLabel('Presentation mode', { exact: true }).selectOption('overview');
      await expect(publicPage).toHaveURL(/view=overview/);
      await publicPage.reload();
      await expect(publicPage.getByLabel('Presentation mode', { exact: true })).toHaveValue('overview');
      await expect(publicPage.getByRole('button', { name: 'Go to slide 1', exact: true })).toBeVisible();
      await expect(publicPage.getByRole('button', { name: 'Go to slide 2', exact: true })).toBeVisible();
      await publicPage.getByRole('button', { name: 'Go to slide 1', exact: true }).press('Enter');
      await expect(publicPage.getByLabel('Presentation mode', { exact: true })).toHaveValue('present');
      await expect(publicPage.locator('main')).toContainText('Public slide 1');
      await expect(publicPage.getByRole('button', { name: 'Presenter window', exact: true })).toHaveCount(0);
      expect(await publicPage.content()).not.toContain(privateNote);
    } finally { await publicContext.close(); }
  } finally { info.setTimeout(info.timeout + 10_000); expect((await page.request.delete(`/api/projects/${project.id}`, { headers })).status()).toBe(200); }
});
