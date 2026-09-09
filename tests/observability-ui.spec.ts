import { test, expect } from './authenticated-browser';
import { randomUUID } from 'node:crypto';

test('workspace deep links survive reload and browser history without creating designs', async ({ page }) => {
  const before = (await (await page.request.get('/api/projects')).json()).projects.length;
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Find your starting point' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Find your starting point' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Design systems', exact: true }).click();
  await expect(page).toHaveURL(/\/design-systems$/);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Design systems', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(page.getByRole('heading', { name: 'Find your starting point' })).toBeVisible();
  const after = (await (await page.request.get('/api/projects')).json()).projects.length;
  expect(after).toBe(before);
});

test('activity displays real actions, trace errors and unavailable measurements', async ({ page, baseURL }, testInfo) => {
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: `Activity ${randomUUID()}`, kind: 'web' } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).project;
  const failed = await page.request.put(`/api/projects/${project.id}/document`, { headers: { Origin: baseURL! }, data: { expectedRevision: 99, document: project.document } });
  expect(failed.status()).toBe(409);
  const traceId = failed.headers()['x-request-id'];
  expect(traceId).toBeTruthy();
  await page.goto(`/activity?projectId=${project.id}`);
  await expect(page.getByRole('heading', { name: 'Activity & usage' })).toBeVisible();
  await expect(page.getByText('revision_conflict', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Not reported', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Request or trace ID').fill(traceId);
  await page.getByRole('button', { name: 'Find trace' }).click();
  await expect(page.getByRole('dialog')).toContainText(traceId);
  await expect(page.getByRole('dialog')).toContainText('revision_conflict');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Filter activity status').selectOption('error');
  await expect(page).toHaveURL(/status=error/);
  await page.reload();
  await expect(page.getByLabel('Filter activity status')).toHaveValue('error');
  await expect(page.getByText('revision_conflict', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `plans/260909-0952-observability-editor/reports/activity-${testInfo.project.name}.png`, fullPage: true });
  const privileged = await page.request.get('/api/observability/summary?scope=all');
  expect(privileged.status()).toBe(403);
  await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } });
});
