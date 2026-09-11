import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
async function pane(page: Page, name: string) { const nav = page.locator('.mobile-editor-nav'); if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click(); }

test('main navigation remains available on guide and documentation', async ({ page }, info) => {
  await mkdir('plans/260910-1813-studio-feedback/reports', { recursive: true });
  await page.goto('/');
  await expect(page.locator('.creation-section').getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: `plans/260910-1813-studio-feedback/reports/home-${info.project.name}.png` });
  for (const route of ['/guide', '/docs']) {
    await page.goto(route);
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await expect(nav.getByRole('link', { name: 'Templates', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Design systems', exact: true })).toHaveAttribute('href', '/design-systems');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
});
test('project, editor tabs, preview and component parameters survive navigation', async ({ page, baseURL }) => {
  const doc = createDocument('web', 'Feedback component'); doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { kind: doc.kind, name: doc.name, document: doc } });
  expect(response.status()).toBe(201); const { project } = await response.json();
  await page.goto('/'); await page.locator('.project-open').filter({ hasText: 'Feedback component' }).click();
  await expect(page).toHaveURL(/project=/); await expect(page.locator('.editor-shell')).toBeVisible(); await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  await pane(page, 'Chat & layers'); await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await page.locator('.component-catalog').getByRole('button', { name: 'Button', exact: true }).click();
  await pane(page, 'Design');
  const properties = page.locator('.component-properties');
  await properties.getByLabel('Label', { exact: true }).fill('Read the story');
  const saved = page.waitForResponse(r => r.url().includes(`/api/projects/${project.id}/operations/`) && r.url().endsWith('/result') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await saved).status()).toBe(200);
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes.at(-1).component.props.label).toBe('Read the story');
  await page.getByRole('button', { name: 'Preview', exact: true }).click(); await expect(page).toHaveURL(/mode=preview/);
  await page.reload(); await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.goBack();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await page.goForward(); await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
});
test('motion space playback, collapsible panes, and real saved thumbnails', async ({ page, baseURL }, info) => {
  const doc = createDocument('video', 'Feedback motion'); doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { kind: doc.kind, name: doc.name, document: doc } });
  const { project } = await response.json(); await page.goto(`/?project=${project.id}`);
  await expect(page.locator('.canvas-viewport')).toBeVisible(); await page.locator('.canvas-viewport').focus();
  await page.keyboard.press('Space'); await expect(page.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await page.keyboard.press('Space'); await expect(page.getByRole('button', { name: 'Play timeline', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse timeline', exact: true }).click(); await expect(page.locator('.motion-content')).toBeHidden();
  await page.getByRole('button', { name: 'Expand timeline', exact: true }).click(); await expect(page.locator('.motion-content')).toBeVisible();
  if (await page.locator('.pane-controls').isVisible()) {
    await page.getByRole('button', { name: 'Collapse properties', exact: true }).click(); await expect(page.locator('.inspector')).toBeHidden();
    await page.getByRole('button', { name: 'Expand properties', exact: true }).click(); await expect(page.locator('.inspector')).toBeVisible();
  }
  await page.screenshot({ path: `plans/260910-1813-studio-feedback/reports/motion-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await page.locator('.project-open').filter({ hasText: 'Feedback motion' }).scrollIntoViewIfNeeded();
  const image = page.getByRole('img', { name: 'Preview of Feedback motion', exact: true }); await image.scrollIntoViewIfNeeded(); await expect(image).toBeVisible({ timeout: 25000 });
  expect(await image.getAttribute('src')).toMatch(/\/thumbnail\?revision=1$/);
  expect(await image.evaluate(async (element: HTMLImageElement) => { await element.decode(); return element.naturalWidth > 0 && element.naturalWidth <= 480; })).toBe(true);
  await page.goBack(); await expect(page.locator('.editor-shell')).toBeVisible();
});
test('3D materials and 2D layers remain editable and ordered', async ({ page, baseURL }, testInfo) => {
  const doc = createDocument('3d', 'Feedback scene'); doc.theme.fonts = { heading: 'Arial', body: 'Arial' };
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { kind: doc.kind, name: doc.name, document: doc } });
  const { project } = await response.json(); await page.goto(`/?project=${project.id}`);
  await expect(page.locator('[data-scene-layer="3d"]')).toBeVisible(); await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  expect(await page.locator('.scene-view > [data-scene-layer]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-scene-layer')))).toEqual(['2d', '3d', '2d']);
  await pane(page, 'Chat & layers'); await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator('.layer-name').filter({ hasText: 'Sculptural object' }).click();
  await pane(page, 'Design'); await page.getByRole('button', { name: 'Metal', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'metalness', exact: true })).toHaveValue('1');
  const saved = page.waitForResponse(r => r.url().includes(`/api/projects/${project.id}/operations/`) && r.url().endsWith('/result') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await saved).status()).toBe(200);
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.document.pages[0].nodes.find((n: { type: string }) => n.type === 'model3d').scene.material.metalness).toBe(1);
  await pane(page, 'Chat & layers');
  const grip = page.getByRole('button', { name: 'Drag Sculptural object to reorder', exact: true });
  const target = page.locator('[data-layer-id]').last();
  const start = (await grip.boundingBox())!, end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height - 2, { steps: 6 }); await page.mouse.up();
  await pane(page, 'Canvas');
  await expect.poll(() => page.locator('.scene-view > [data-scene-layer]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-scene-layer')))).toEqual(['3d', '2d']);
  await expect.poll(() => page.locator('canvas[data-scene-layer="3d"]').evaluate((canvas: HTMLCanvasElement) => canvas.width > 0 && canvas.height > 0 && canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
  await mkdir('plans/260910-1813-studio-feedback/reports', { recursive: true });
  await page.screenshot({ path: `plans/260910-1813-studio-feedback/reports/scene-${testInfo.project.name}.png` });
});


test('template and design-library screens reload and follow browser history', async ({ page, baseURL }) => {
  await page.goto('/templates?template=workshop-deck');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack(); await expect(page.getByRole('dialog')).toBeVisible();
  const doc = createDocument('web', 'Library routes');
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { kind: doc.kind, name: doc.name, document: doc } });
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}&pane=inspector&inspector=theme&library=new`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Library name', { exact: true })).toBeVisible();
  await page.reload(); await expect(dialog.getByLabel('Library name', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(dialog).toHaveCount(0); await page.goBack(); await expect(dialog).toBeVisible();
});

test('3D picking follows composited layer order instead of camera distance', async ({ page, baseURL }) => {
  const doc = createDocument('3d', 'Layer picking');
  const base = doc.pages[0].nodes.find(n => n.type === 'model3d')!;
  doc.pages[0].nodes = [
    { ...base, id: 'near-model', name: 'Near model', data: { geometry: 'sphere' }, scene: { position: [0, 0, 2], scale: [1, 1, 1] } },
    { id: 'between', name: 'Between', type: 'text', x: 0, y: 0, width: 120, height: 30, text: 'Caption' },
    { ...base, id: 'front-layer', name: 'Front layer', data: { geometry: 'sphere' }, scene: { position: [0, 0, 0], scale: [1, 1, 1] } },
  ];
  doc.pages[0].scene = { camera: { position: [0, 0, 8], target: [0, 0, 0], fov: 45 }, ambient: 1, light: { color: '#ffffff', position: [3, 5, 5], intensity: 2 } };
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { kind: doc.kind, name: doc.name, document: doc } });
  expect(response.status()).toBe(201); const { project } = await response.json(); await page.goto(`/?project=${project.id}`);
  const surface = page.locator('.scene-view canvas:not([data-scene-layer])'); await expect(surface).toBeVisible();
  await surface.click(); await pane(page, 'Chat & layers'); await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.locator('.layer-name').filter({ hasText: 'Front layer' })).toHaveAttribute('aria-pressed', 'true');
});
