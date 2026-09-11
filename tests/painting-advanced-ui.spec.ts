import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const canvas = (page: Page) => page.getByLabel('Painting canvas', { exact: true });
const ready = async (page: Page) => { await expect(canvas(page)).toHaveAttribute('aria-busy', 'false'); };
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await canvas(page).scrollIntoViewIfNeeded();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 20 });
  await page.mouse.up();
}
async function alpha(page: Page, x: number, y: number) {
  return canvas(page).evaluate((element: HTMLCanvasElement, point) => element.getContext('2d')!.getImageData(Math.floor(element.width * point.x), Math.floor(element.height * point.y), 1, 1).data[3], { x, y });
}
async function open(page: Page, id: string) {
  await page.goto(`/?project=${id}`);
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Open painting studio', exact: true }).click();
  await ready(page);
}
async function save(page: Page, id: string) {
  await ready(page);
  await page.getByRole('button', { name: 'Close painting studio' }).click();
  const response = page.waitForResponse(r => r.url().includes(`/api/projects/${id}/operations/`) && r.url().endsWith('/result') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).ok()).toBe(true);
  return (await (await page.request.get(`/api/projects/${id}`)).json()).project.document;
}
async function register(page: Page, origin: string) {
  const credentials = { email: `paint-${randomUUID()}@studio.test`, password: randomUUID() + randomUUID() };
  expect((await page.request.post('/api/auth/register', { headers: { Origin: origin }, data: credentials })).status()).toBe(201);
  const response = await page.request.post('/api/projects', { headers: { Origin: origin }, data: { kind: 'web', name: 'Advanced paint acceptance' } });
  expect(response.status()).toBe(201);
  return { credentials, project: (await response.json()).project };
}

test('Paint resize, selection fill, group lock and mask brush survive undo and reload', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const { project } = await register(page, baseURL!);
  await open(page, project.id);
  await page.getByLabel('Painting width', { exact: true }).fill('256');
  await page.getByLabel('Painting height', { exact: true }).fill('256');
  await page.getByRole('button', { name: 'Resize canvas', exact: true }).click();
  await ready(page);
  await expect(canvas(page)).toHaveAttribute('width', '256');
  await expect(canvas(page)).toHaveAttribute('height', '256');
  await page.getByLabel('Painting tool', { exact: true }).selectOption('rectangle');
  await drag(page, [.2, .2], [.8, .8]);
  await expect(page.getByLabel('Active painting selection')).toBeVisible();
  await ready(page);
  await page.getByLabel('Painting tool', { exact: true }).selectOption('fill');
  await canvas(page).click({ position: { x: (await canvas(page).boundingBox())!.width / 2, y: (await canvas(page).boundingBox())!.height / 2 } });
  await ready(page);
  await expect.poll(() => alpha(page, .5, .5)).toBe(255);
  expect(await alpha(page, .1, .1)).toBe(0);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await ready(page);
  await page.getByLabel('Layer group', { exact: true }).selectOption({ label: 'Group 1' });
  await ready(page);
  await page.getByRole('checkbox', { name: 'Lock group', exact: true }).check();
  await ready(page);
  await page.getByLabel('Painting tool', { exact: true }).selectOption('brush');
  await drag(page, [.05, .1], [.9, .1]);
  await expect(page.getByRole('dialog', { name: 'Painting studio' }).getByRole('status')).toContainText(/lock/i);
  expect(await alpha(page, .5, .1)).toBe(0);
  await page.getByRole('checkbox', { name: 'Lock group', exact: true }).uncheck();
  await ready(page);
  await page.getByRole('button', { name: 'Mask from layer alpha', exact: true }).click();
  await ready(page);
  await page.getByLabel('Paint edit target', { exact: true }).selectOption('mask');
  await ready(page);
  await page.getByLabel('Paint brush', { exact: true }).selectOption('erase');
  await page.getByLabel('Paint flow', { exact: true }).press('End');
  await drag(page, [.3, .5], [.7, .5]);
  await ready(page);
  const maskedAlpha = await alpha(page, .5, .5);
  expect(maskedAlpha).toBeLessThan(255);
  await page.getByRole('button', { name: 'Undo painting', exact: true }).click();
  await ready(page);
  await expect.poll(() => alpha(page, .5, .5)).toBe(255);
  await page.getByRole('button', { name: 'Redo painting', exact: true }).click();
  await ready(page);
  await expect.poll(() => alpha(page, .5, .5)).toBe(maskedAlpha);
  const stored = await save(page, project.id);
  const painting = stored.paintings[0];
  expect([painting.width, painting.height]).toEqual([256, 256]);
  expect(painting.layers[0].groupId).toBe(painting.groups[0].id);
  expect(painting.groups[0].locked).toBe(false);
  expect(painting.layers[0].mask.enabled).toBe(true);
  expect(painting.layers[0].mask.tiles.length).toBeGreaterThan(0);
  expect(painting.composite.generation).toBe(painting.generation);
  await open(page, project.id);
  await expect.poll(() => alpha(page, .5, .5)).toBe(maskedAlpha);
  expect(await alpha(page, .1, .1)).toBe(0);
  await page.getByRole('checkbox', { name: 'Enable mask', exact: true }).uncheck();
  await ready(page);
  await expect.poll(() => alpha(page, .5, .5)).toBe(255);
});

test('failed paint upload survives reload and stays isolated across accounts in the same browser', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  const owner = await register(page, baseURL!);
  await open(page, owner.project.id);
  await save(page, owner.project.id);
  await open(page, owner.project.id);
  const uploads = `**/api/projects/${owner.project.id}/assets`;
  await page.route(uploads, route => route.abort('failed'));
  await page.getByLabel('Paint brush', { exact: true }).selectOption('ink');
  await drag(page, [.25, .5], [.75, .5]);
  await expect(page.getByRole('button', { name: 'Retry changes', exact: true })).toBeEnabled();
  const draftAlpha = await alpha(page, .5, .5);
  expect(draftAlpha).toBeGreaterThan(0);
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Open painting studio', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Painting studio' }).getByRole('status')).toContainText('Recovered local changes');
  await expect.poll(() => alpha(page, .5, .5)).toBe(draftAlpha);
  expect((await page.request.post('/api/auth/logout', { headers: { Origin: baseURL! } })).ok()).toBe(true);
  const other = await register(page, baseURL!);
  expect((await page.request.get(`/api/projects/${owner.project.id}`)).status()).toBe(404);
  await open(page, other.project.id);
  await expect(page.getByRole('button', { name: 'Retry changes', exact: true })).toHaveCount(0);
  expect(await alpha(page, .5, .5)).toBe(0);
  expect((await page.request.post('/api/auth/logout', { headers: { Origin: baseURL! } })).ok()).toBe(true);
  expect((await page.request.post('/api/auth/login', { headers: { Origin: baseURL! }, data: owner.credentials })).ok()).toBe(true);
  await page.goto(`/?project=${owner.project.id}`);
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Open painting studio', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Painting studio' }).getByRole('status')).toContainText('Recovered local changes');
  await expect.poll(() => alpha(page, .5, .5)).toBe(draftAlpha);
  await page.unroute(uploads);
  await page.getByRole('button', { name: 'Retry changes', exact: true }).click();
  await ready(page);
  const stored = await save(page, owner.project.id);
  expect(stored.paintings[0].layers[0].tiles.length).toBeGreaterThan(0);
  await open(page, owner.project.id);
  await expect(page.getByRole('button', { name: 'Retry changes', exact: true })).toHaveCount(0);
  await expect.poll(() => alpha(page, .5, .5)).toBe(draftAlpha);
});
