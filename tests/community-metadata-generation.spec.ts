import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './authenticated-browser';
import type { Project } from '../src/shared/schema';

const generationPath = '/api/community/metadata/generate';
const suggestion = { title: 'Paper Lantern', description: 'An editable study of color and everyday shapes.', tags: ['paper', 'color'] };
const providers = [
  { provider: 'fal', name: 'Image only', model: 'image-model', configured: true },
  { provider: 'deepseek', name: 'My text provider', model: 'saved-model', configured: true },
  { provider: 'openai', name: 'Second text provider', model: 'another-model', configured: true },
];

async function openPublication(page: Page, baseURL: string, configured = providers) {
  const previous = await page.request.get('/api/community/me/profile');
  expect(previous.ok()).toBe(true);
  const saved = await page.request.put('/api/community/me/profile', {
    headers: { Origin: baseURL }, data: { displayName: 'Metadata browser author', handle: `metadata-${randomUUID().slice(0, 8)}`, bio: 'Exploring editable design.', expectedProfileRevision: (await previous.json()).profile?.revision ?? 0 },
  });
  expect(saved.ok()).toBe(true);
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL }, data: { name: 'Manual listing title', kind: 'web' } });
  expect(created.status()).toBe(201);
  const { project } = await created.json() as { project: Project };
  // Provider discovery and generation are isolated here; project/profile reads,
  // saved revisions and publication preflight use the actual local API.
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: configured } }));
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('button', { name: 'Publish to Community', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to Community', exact: true });
  const ai = dialog.getByRole('region', { name: 'AI listing suggestions' });
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(project.name);
  expect((await ai.boundingBox())!.y).toBeLessThan((await dialog.getByLabel('Title', { exact: true }).boundingBox())!.y);
  await dialog.getByLabel('Description', { exact: true }).fill('My manual description.');
  await dialog.getByLabel('Tags', { exact: true }).fill('manual, draft');
  return { project, dialog, ai };
}

async function expectProjectUnchanged(page: Page, project: Project) {
  const current = await page.request.get(`/api/projects/${project.id}`);
  expect(current.ok()).toBe(true);
  expect((await current.json()).project).toEqual(project);
  const listings = await page.request.get('/api/community/me/listings');
  expect(listings.ok()).toBe(true);
  expect((await listings.json()).listings.some((listing: { sourceProjectId?: string }) => listing.sourceProjectId === project.id)).toBe(false);
}

test('listing generation stays a separate draft and applying it clears actual preflight and consent', async ({ page, baseURL }, testInfo) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!);
  const requests: unknown[] = [];
  await page.route(`**${generationPath}`, route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { suggestion, provider: 'deepseek', projectRevision: project.revision } });
  });
  await dialog.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'What will be shared', exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /I have the rights/ }).check();
  await dialog.getByRole('checkbox', { name: /I reviewed the public content/ }).check();
  await expect(dialog.getByRole('button', { name: 'Confirm and publish', exact: true })).toBeEnabled();
  await ai.locator('summary').click();
  const choice = ai.getByLabel('Listing AI provider', { exact: true });
  await expect(choice).toHaveValue('deepseek');
  await expect(choice.getByRole('option')).toHaveText(['My text provider', 'Second text provider']);
  await ai.getByLabel('Writing instructions (optional)', { exact: true }).fill('Keep it concise and friendly.');
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(ai.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  expect(requests).toEqual([{ projectId: project.id, expectedProjectRevision: project.revision, provider: 'deepseek', title: project.name, description: 'My manual description.', tags: ['manual', 'draft'], prompt: 'Keep it concise and friendly.' }]);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(project.name);
  await expect(dialog.getByRole('checkbox', { name: /I have the rights/ })).toBeChecked();
  await expectProjectUnchanged(page, project);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ai.screenshot({ path: `plans/2026-09-12-community-ai-metadata/reports/metadata-suggestion-${testInfo.project.name}.png` });
  if (testInfo.project.name === 'mobile') {
    await ai.getByRole('button', { name: 'Use suggestion', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'plans/2026-09-12-community-ai-metadata/reports/metadata-suggestion-mobile-actions.png' });
  }
  await ai.getByRole('button', { name: 'Use suggestion', exact: true }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(suggestion.title);
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(suggestion.description);
  await expect(dialog.getByLabel('Tags', { exact: true })).toHaveValue('paper, color');
  await expect(dialog.getByRole('heading', { name: 'What will be shared', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Confirm and publish', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: /I have the rights/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /I reviewed the public content/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Confirm and publish', exact: true })).toBeDisabled();
  await expectProjectUnchanged(page, project);
});

test('manual listing preflight stays available without text providers and provider Settings opens separately', async ({ page, baseURL }) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!, [providers[0]]);
  await expect(ai.getByText('No text provider connected. Connect one in Settings, or write your listing details below.')).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Generate with AI', exact: true })).toBeDisabled();
  const settings = ai.getByRole('link', { name: 'Provider Settings (new tab)', exact: true });
  await expect(settings).toHaveAttribute('href', '/?settings=providers');
  await expect(settings).toHaveAttribute('target', '_blank');
  const popupPromise = page.waitForEvent('popup');
  await settings.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\?settings=providers/);
  await popup.close();
  await page.bringToFront();
  await expect(dialog.getByLabel('Title', { exact: true })).toBeEditable();
  await dialog.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'What will be shared', exact: true })).toBeVisible();
  await expectProjectUnchanged(page, project);
});

test('provider discovery errors recover and generation errors preserve blank fields through retry and discard', async ({ page, baseURL }) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!);
  await page.route('**/api/providers', route => route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Provider discovery unavailable.' } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('studio-providers-updated')));
  await expect(ai.getByRole('alert').filter({ hasText: 'Could not load your providers.' })).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Generate with AI', exact: true })).toBeDisabled();
  await page.route('**/api/providers', route => route.fulfill({ json: { providers } }));
  await ai.getByRole('button', { name: 'Retry providers', exact: true }).click();
  await expect(ai.getByRole('button', { name: 'Generate with AI', exact: true })).toBeEnabled();
  const requests: Record<string, unknown>[] = [];
  await page.route(`**${generationPath}`, route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1
      ? route.fulfill({ status: 502, json: { error: { code: 'provider_error', message: 'Provider quota unavailable. Try again.' } } })
      : route.fulfill({ json: { suggestion, provider: 'openai', projectRevision: project.revision } });
  });
  for (const label of ['Title', 'Description', 'Tags']) await dialog.getByLabel(label, { exact: true }).fill('');
  await ai.locator('summary').click();
  await ai.getByLabel('Listing AI provider', { exact: true }).selectOption('openai');
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(ai.getByRole('alert').filter({ hasText: 'Provider quota unavailable. Try again.' })).toBeVisible();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('');
  await ai.getByRole('button', { name: 'Retry generation', exact: true }).click();
  await expect(ai.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  expect(requests).toEqual(Array.from({ length: 2 }, () => ({ projectId: project.id, expectedProjectRevision: project.revision, provider: 'openai', title: '', description: '', tags: [], prompt: '' })));
  await expect(ai.getByText('Draft from Second text provider. Nothing has been saved or published.', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(ai.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toHaveCount(0);
  for (const label of ['Title', 'Description', 'Tags']) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
  await expectProjectUnchanged(page, project);
});

test('manual edits while generation is pending survive the response and block applying the old suggestion', async ({ page, baseURL }) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: Record<string, unknown>[] = [];
  await page.route(`**${generationPath}`, async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await pending;
    await route.fulfill({ json: { suggestion, provider: 'deepseek', projectRevision: project.revision } });
  });
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(ai.getByRole('button', { name: 'Generating listing…', exact: true })).toBeDisabled();
  for (const label of ['Title', 'Description', 'Tags']) await expect(dialog.getByLabel(label, { exact: true })).toBeEditable();
  await dialog.getByLabel('Title', { exact: true }).fill('Keep my newer title');
  await dialog.getByLabel('Description', { exact: true }).fill('Keep my newer description');
  release();
  await expect(ai.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  await expect(ai.getByRole('status').filter({ hasText: 'Your fields or saved revision changed after generation started.' })).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Use suggestion', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Keep my newer title');
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(ai.getByRole('button', { name: 'Use suggestion', exact: true })).toBeEnabled();
  expect(requests[1]).toMatchObject({ title: 'Keep my newer title', description: 'Keep my newer description' });
  await ai.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Keep my newer title');
  await expectProjectUnchanged(page, project);
});

test('a saved revision change invalidates the draft and generation conflicts offer reload without losing fields', async ({ page, baseURL }) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!);
  let attempts = 0;
  await page.route(`**${generationPath}`, route => {
    attempts++;
    const request = route.request().postDataJSON();
    return attempts === 2
      ? route.fulfill({ status: 409, json: { error: { code: 'revision_conflict', message: 'The saved design changed during generation.' } } })
      : route.fulfill({ json: { suggestion, provider: 'deepseek', projectRevision: request.expectedProjectRevision } });
  });
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(ai.getByRole('button', { name: 'Use suggestion', exact: true })).toBeEnabled();
  const saved = await page.request.put(`/api/projects/${project.id}/document`, { headers: { Origin: baseURL! }, data: { document: project.document, expectedRevision: project.revision } });
  expect(saved.ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Save or reload this project before publishing.' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Load current saved revision', exact: true }).click();
  await expect(dialog.getByText(`Saved revision ${project.revision + 1} loaded. Your draft text was kept. Review it, then run preflight again.`, { exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Use suggestion', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(project.name);
  await ai.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(ai.getByRole('alert').filter({ hasText: 'The saved design changed during generation.' })).toBeVisible();
  await expect(ai.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: 'Load current saved revision', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: 'Load current saved revision', exact: true }).click();
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue('My manual description.');
});
