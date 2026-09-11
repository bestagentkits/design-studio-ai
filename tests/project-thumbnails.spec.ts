import { test, expect } from './authenticated-browser';
import type { Locator } from '@playwright/test';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument } from '../src/shared/schema';

async function pixels(image: Locator) {
  await expect(image).toBeVisible({ timeout: 25000 });
  return image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = 48;
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0, 48, 48);
    const data = context.getImageData(0, 0, 48, 48).data, colors = new Set<string>();
    let opaque = 0, blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 240) opaque++;
      if (data[i + 2] > data[i] + 45 && data[i + 2] > data[i + 1] + 20 && data[i + 3] > 240) blue++;
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    return { center: [...context.getImageData(24, 24, 1, 1).data], opaque, blue, colors: colors.size };
  });
}
function solidDocument(kind: 'web' | 'video', name: string) {
  const document = createDocument(kind, name);
  document.theme.fonts = { heading: 'Arial', body: 'Arial' };
  document.pages = [{ id: 'cover', name: 'Cover', width: 800, height: 600, background: '#ffffff', nodes: [
    { id: 'red', name: 'Red artwork', type: 'shape', x: 0, y: 0, width: 800, height: 600, style: { fill: '#e02030' } },
  ] }];
  if (kind === 'video') document.timeline = { duration: 4, fps: 30, tracks: [{ id: 'fade', nodeId: 'red', keyframes: [
    { time: 0, values: { opacity: 0 } }, { time: 1, values: { opacity: 1 } }, { time: 4, values: { opacity: 1 } },
  ] }] };
  return document;
}

test('saved thumbnails contain design pixels, reuse their revision and refresh after edits', async ({ page, baseURL }) => {
  const document = solidDocument('web', 'Thumbnail pixel regression');
  const headers = { Origin: baseURL! };
  const created = await page.request.post('/api/projects', { headers, data: { name: document.name, kind: document.kind, document } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  let reads = 0;
  page.on('request', request => { if (request.method() === 'GET' && request.url() === `${baseURL}/api/projects/${project.id}`) reads++; });
  const image = page.getByRole('img', { name: `Preview of ${document.name}`, exact: true });
  try {
    await page.goto('/');
    await page.locator('.project-open').filter({ hasText: document.name }).scrollIntoViewIfNeeded();
    const initial = await pixels(image);
    expect(initial.center[3]).toBe(255); expect(initial.center[0]).toBeGreaterThan(180); expect(initial.center[1]).toBeLessThan(80);
    const src = await image.getAttribute('src');
    expect(src).toContain('/thumbnail?revision=1');
    expect(reads).toBe(0);
    await page.reload();
    await page.locator('.project-open').filter({ hasText: document.name }).scrollIntoViewIfNeeded();
    expect((await pixels(image)).center).toEqual(initial.center);
    expect(reads).toBe(0);
    await page.locator('.project-open').filter({ hasText: document.name }).click();
    await expect(page.getByRole('button', { name: 'Back to workspace', exact: true })).toBeVisible();
    const before = reads;
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
    await expect(image).toHaveAttribute('src', src!); expect(reads).toBe(before);
    await page.locator('.project-open').filter({ hasText: document.name }).click();
    await expect(page.getByRole('button', { name: 'Back to workspace', exact: true })).toBeVisible();
    const changed = structuredClone(project.document);
    changed.pages[0].nodes[0].style = { fill: '#2040e0' };
    const updated = await page.request.put(`/api/projects/${project.id}/document`, { headers, data: { document: changed, expectedRevision: project.revision } });
    expect(updated.status()).toBe(200);
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
    await page.locator('.project-open').filter({ hasText: document.name }).scrollIntoViewIfNeeded();
    await expect(image).not.toHaveAttribute('src', src!);
    const fresh = await pixels(image); expect(fresh.center[2]).toBeGreaterThan(180); expect(fresh.center[0]).toBeLessThan(80);
    await expect(page.locator('body > div[aria-hidden="true"] > section')).toHaveCount(0);
  } finally { await page.request.delete(`/api/projects/${project.id}`, { headers }); }
});

test('DOM, slides, motion and 3D covers render artwork rather than blank images', async ({ page, baseURL }, info) => {
  const documents: DesignDocument[] = [createDocument('web', 'DOM cover'), createDocument('slides', 'Slide cover'), solidDocument('video', 'Motion cover'), createDocument('3d', 'Scene cover')];
  documents[0].pages[0].layout = { mode: 'absolute' };
  const headers = { Origin: baseURL! }, ids: string[] = [];
  try {
    for (const document of documents) {
      document.theme.fonts = { heading: 'Arial', body: 'Arial' };
      const created = await page.request.post('/api/projects', { headers, data: { name: document.name, kind: document.kind, document } });
      expect(created.status()).toBe(201); ids.push((await created.json()).project.id);
    }
    await page.goto('/');
    for (const document of documents) {
      await page.locator('.project-open').filter({ hasText: document.name }).scrollIntoViewIfNeeded();
      const actual = await pixels(page.getByRole('img', { name: `Preview of ${document.name}`, exact: true }));
      expect(actual.opaque).toBeGreaterThan(2200);
      if (document.kind === 'video') { expect(actual.center[0]).toBeGreaterThan(180); expect(actual.center[1]).toBeLessThan(80); }
      else expect(actual.colors).toBeGreaterThan(8);
      if (document.kind === '3d') expect(actual.blue).toBeGreaterThan(50);
    }
    await page.locator('.projects-section').screenshot({ path: `plans/260911-1206-persistent-thumbnails/projects-${info.project.name}.png` });
  } finally { for (const id of ids) await page.request.delete(`/api/projects/${id}`, { headers }); }
});
