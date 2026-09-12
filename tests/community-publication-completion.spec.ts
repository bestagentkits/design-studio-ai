import { randomUUID } from 'node:crypto';
import { test, expect } from './authenticated-browser';
import type { CommunityJob } from '../src/shared/community';

test('congratulations appears only after the actual publication job succeeds and Done clears its receipt', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const headers = { Origin: baseURL! };
  const previous = await page.request.get('/api/community/me/profile');
  expect(previous.ok()).toBe(true);
  const profile = await page.request.put('/api/community/me/profile', { headers, data: {
    displayName: 'Publication completion author', handle: `completion-${randomUUID().slice(0, 8)}`, bio: 'Sharing an editable local design.', expectedProfileRevision: (await previous.json()).profile?.revision ?? 0,
  } });
  expect(profile.ok()).toBe(true);
  const created = await page.request.post('/api/projects', { headers, data: { name: 'Real completed publication', kind: 'web' } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('button', { name: 'Publish to Community', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Publish to Community', exact: true });
  await details.getByLabel('Description', { exact: true }).fill('A local publication with real exported files.');
  await details.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await details.getByRole('checkbox', { name: /I have the rights/ }).check();
  await details.getByRole('checkbox', { name: /I reviewed the public content/ }).check();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let completed: CommunityJob | undefined;
  // Delay only delivery of a real completed server response. Publication,
  // rendering, artifact storage, polling and all returned job data stay real.
  await page.route('**/api/community/jobs/*', async route => {
    const response = await route.fetch();
    const result = await response.json() as { job: CommunityJob };
    if (result.job?.status === 'succeeded') { completed = result.job; await held; }
    await route.fulfill({ response });
  });
  await details.getByRole('button', { name: 'Confirm and publish', exact: true }).click();
  const progress = page.getByRole('dialog', { name: 'Publishing to Community', exact: true });
  await expect(progress).toBeVisible();
  await expect(progress.getByRole('button', { name: 'Back to details', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Congratulations!', exact: true })).toHaveCount(0);
  await expect.poll(() => completed?.status, { timeout: 120_000 }).toBe('succeeded');
  expect(completed).toMatchObject({ kind: 'publish', status: 'succeeded' });
  expect(completed!.projectId).toBeUndefined();
  expect(completed!.listingId).toBeTruthy();
  await expect(progress).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Published to Community', exact: true })).toHaveCount(0);
  release();
  const success = page.getByRole('dialog', { name: 'Published to Community', exact: true });
  await expect(success.getByRole('heading', { name: 'Congratulations!', exact: true })).toBeVisible();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(success.getByRole('link', { name: 'View published design', exact: true })).toHaveAttribute('href', `/community/designs/${completed!.listingId}`);
  const listingResponse = await page.request.get(`/api/community/listings/${completed!.listingId}`);
  expect(listingResponse.ok()).toBe(true);
  const { listing } = await listingResponse.json();
  const file = listing.files.find((item: { format: string }) => item.format === 'package');
  expect(file).toBeTruthy();
  const download = await page.request.get(file.url);
  expect(download.ok()).toBe(true);
  expect(download.headers()['content-type']).toContain('zip');
  expect((await download.body()).subarray(0, 2).toString()).toBe('PK');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1440, 840, 375]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await success.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(success.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
      await page.screenshot({ path: `plans/260912-1741-community-publish/reports/success-${testInfo.project.name}-${theme}-${width}.png` });
    }
  }
  const receiptKeys = await page.evaluate(id => Object.keys(sessionStorage).filter(key => key.startsWith('design-studio:community-build:') && key.endsWith(`:${id}`)), project.id);
  expect(receiptKeys).toHaveLength(1);
  await success.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(success).toHaveCount(0);
  expect(await page.evaluate(keys => keys.map(key => sessionStorage.getItem(key)), receiptKeys)).toEqual([null]);
});

test('a failed-status transport fixture returns to fresh listing details and retries a real release', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const headers = { Origin: baseURL! };
  const previous = await page.request.get('/api/community/me/profile');
  expect(previous.ok()).toBe(true);
  const profile = await page.request.put('/api/community/me/profile', { headers, data: {
    displayName: 'Publication retry author', handle: `retry-${randomUUID().slice(0, 8)}`, bio: 'Testing local publication recovery.', expectedProfileRevision: (await previous.json()).profile?.revision ?? 0,
  } });
  expect(profile.ok()).toBe(true);
  const created = await page.request.post('/api/projects', { headers, data: { name: 'Publication retry design', kind: 'web' } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('button', { name: 'Publish to Community', exact: true }).click();
  let details = page.getByRole('dialog', { name: 'Publish to Community', exact: true });
  await details.getByLabel('Description', { exact: true }).fill('Recover publication with a fresh listing revision.');
  await details.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await details.getByRole('checkbox', { name: /I have the rights/ }).check();
  await details.getByRole('checkbox', { name: /I reviewed the public content/ }).check();
  let firstOperation: string | undefined;
  let firstJob: CommunityJob | undefined;
  // Only this failure status is a UI transport fixture. Both publication builds,
  // listing revision reads and the retry release request use the real local API.
  await page.route('**/api/community/jobs/*', async route => {
    const response = await route.fetch();
    const result = await response.json() as { job: CommunityJob };
    firstOperation ??= result.job?.operationId;
    if (result.job && result.job.operationId === firstOperation && result.job.status === 'succeeded') {
      firstJob = result.job;
      await route.fulfill({ response, json: { job: { ...result.job, status: 'failed', stage: 'failed', error: { code: 'render_failed', message: 'Test transport: publication renderer failed.' } } } });
    } else await route.fulfill({ response });
  });
  await details.getByRole('button', { name: 'Confirm and publish', exact: true }).click();
  const progress = page.getByRole('dialog', { name: 'Publishing to Community', exact: true });
  await expect(progress.getByRole('alert')).toHaveText('Test transport: publication renderer failed.', { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Congratulations!', exact: true })).toHaveCount(0);
  const refresh = page.waitForResponse(response => response.url().endsWith('/api/community/me/listings') && response.request().method() === 'GET');
  await progress.getByRole('button', { name: 'Back to details', exact: true }).click();
  const refreshed = await refresh;
  expect(refreshed.ok()).toBe(true);
  const owned = (await refreshed.json()).listings.find((listing: { sourceProjectId: string }) => listing.sourceProjectId === project.id);
  expect(owned.id).toBe(firstJob!.listingId);
  details = page.getByRole('dialog', { name: 'Update Community design', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { name: 'What will be shared' })).toHaveCount(0);
  expect(await page.evaluate(id => Object.keys(sessionStorage).some(key => key.startsWith('design-studio:community-build:') && key.endsWith(`:${id}`)), project.id)).toBe(false);
  await details.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  const rights = details.getByRole('checkbox', { name: /I have the rights/ });
  const reviewed = details.getByRole('checkbox', { name: /I reviewed the public content/ });
  await expect(rights).not.toBeChecked(); await expect(reviewed).not.toBeChecked();
  await rights.check(); await reviewed.check();
  const release = page.waitForResponse(response => response.url().endsWith(`/api/community/listings/${owned.id}/releases`) && response.request().method() === 'POST');
  await details.getByRole('button', { name: 'Publish updated version', exact: true }).click();
  const retried = await release;
  expect(retried.ok()).toBe(true);
  expect(retried.request().postDataJSON().expectedListingRevision).toBe(owned.revision);
  const success = page.getByRole('dialog', { name: 'Published to Community', exact: true });
  await expect(success.getByRole('heading', { name: 'Congratulations!', exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(success.getByRole('link', { name: 'View published design', exact: true })).toHaveAttribute('href', `/community/designs/${owned.id}`);
  await success.getByRole('button', { name: 'Done', exact: true }).click();
});
