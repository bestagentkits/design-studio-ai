import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';

test('sidebar toggles control preview independently and preserve edit preferences', async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop pane controls; mobile uses panel navigation.');
  const document = createDocument('web', 'Sidebar preview');
  const response = await page.request.post('/api/projects', {
    headers: { Origin: baseURL! }, data: { kind: document.kind, name: document.name, document },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}`);
  const left = page.locator('.left-panel'), right = page.locator('.inspector');
  const toggle = (name: string) => page.getByRole('button', { name, exact: true }).click();
  await expect(left).toBeVisible(); await expect(right).toBeVisible();
  await toggle('Collapse left sidebar'); await expect(left).toBeHidden();
  await toggle('Preview');
  await expect(left).toBeHidden(); await expect(right).toBeHidden();
  await toggle('Expand left sidebar');
  await expect(left).toBeVisible(); await expect(right).toBeHidden();
  await toggle('Expand properties');
  await expect(left).toBeVisible(); await expect(right).toBeVisible();
  const boxes = await Promise.all([left.boundingBox(), page.locator('.canvas-region').boundingBox(), right.boundingBox()]);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
  await page.reload();
  await expect(left).toBeVisible(); await expect(right).toBeVisible();
  await toggle('Collapse properties'); await expect(right).toBeHidden();
  await page.goBack(); await expect(right).toBeVisible();
  await page.goForward(); await expect(right).toBeHidden();
  await toggle('Collapse left sidebar'); await expect(left).toBeHidden();
  await page.getByRole('button', { name: 'Expand properties', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(right).toBeVisible(); await expect(left).toBeHidden();
  await expect(page.getByRole('button', { name: 'Collapse properties', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await toggle('Edit');
  await expect(left).toBeHidden(); await expect(right).toBeVisible();
  await toggle('Expand left sidebar'); await expect(left).toBeVisible();
  await toggle('Collapse properties'); await expect(right).toBeHidden();
  await toggle('Expand properties'); await expect(right).toBeVisible();
});

test('mobile preview stays canvas-only when desktop preview panes are open', async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== 'mobile', 'Mobile panel navigation.');
  const document = createDocument('web', 'Mobile sidebar preview');
  const response = await page.request.post('/api/projects', {
    headers: { Origin: baseURL! }, data: { kind: document.kind, name: document.name, document },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}&mode=preview&pane=chat&previewLeft=open&previewRight=open`);
  await expect(page.locator('.canvas-region')).toBeVisible();
  await expect(page.locator('.left-panel')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.left-panel')).toBeVisible();
  await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.locator('.inspector')).toBeVisible();
});
