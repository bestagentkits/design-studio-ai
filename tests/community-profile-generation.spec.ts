import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './authenticated-browser';
import type { CommunityProfile } from '../src/shared/community';

const profilePath = '/api/community/me/profile';
const generationPath = `${profilePath}/generate`;
const newHandle = () => `artist-${randomUUID().slice(0, 8)}`;
const providers = [
  { provider: 'fal', name: 'Image only', model: 'image-model', configured: true },
  { provider: 'deepseek', name: 'My text provider', model: 'saved-model', configured: true },
  { provider: 'openai', name: 'Second text provider', model: 'another-model', configured: true },
];

async function currentProfile(page: Page): Promise<CommunityProfile | null> {
  const response = await page.request.get(profilePath);
  expect(response.ok()).toBe(true);
  return (await response.json()).profile;
}

async function openProfile(page: Page, baseURL: string, configured = providers) {
  // Shared worker authentication does not imply shared test profile state.
  // Seed a fresh baseline through the actual revision-checked save endpoint.
  const previous = await currentProfile(page);
  const seed = { displayName: 'Manual artist', handle: newHandle(), bio: 'My manually written bio.' };
  const saved = await page.request.put(profilePath, {
    headers: { Origin: baseURL }, data: { ...seed, expectedProfileRevision: previous?.revision ?? 0 },
  });
  expect(saved.ok()).toBe(true);
  const baseline = (await saved.json()).profile as CommunityProfile;
  // These browser tests isolate provider discovery and generation transport.
  // Authentication, profile reads and explicit saves use the real local API;
  // the generation service and provider contract have separate SQLite tests.
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: configured } }));
  await page.goto('/community/publishing');
  await page.getByText('Edit public profile', { exact: true }).click();
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue(seed.displayName);
  await expect(page.getByLabel('Public handle', { exact: true })).toHaveValue(seed.handle);
  return baseline;
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('a new creator generates and saves a public profile from the project publication dialog', async ({ page, baseURL }) => {
  // Keep this first: the fresh authenticated worker has no public profile yet.
  expect(await currentProfile(page)).toBeNull();
  const created = await page.request.post('/api/projects', {
    headers: { Origin: baseURL! }, data: { name: 'First Community profile', kind: 'web' },
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const suggestion = { displayName: 'New Paper Artist', handle: newHandle(), bio: 'Playing with paper and color.' };
  const generationRequests: unknown[] = [], writes: unknown[] = [];
  // Only provider metadata and generation transport are isolated in this UI test.
  await page.route('**/api/providers', route => route.fulfill({ json: { providers } }));
  await page.route(`**${generationPath}`, route => {
    generationRequests.push(route.request().postDataJSON());
    return route.fulfill({ json: { suggestion, provider: 'deepseek' } });
  });
  page.on('request', request => {
    if (request.url().endsWith(profilePath) && request.method() === 'PUT') writes.push(request.postDataJSON());
  });
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('button', { name: 'Publish to Community', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to Community', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Choose your public identity', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Public display name', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Public handle', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  expect(generationRequests).toEqual([{ provider: 'deepseek', displayName: '', handle: '', bio: '', prompt: '' }]);
  expect(writes).toEqual([]);
  expect(await currentProfile(page)).toBeNull();
  await dialog.getByRole('button', { name: 'Use suggestion', exact: true }).click();
  await expect(dialog.getByLabel('Public display name', { exact: true })).toHaveValue(suggestion.displayName);
  await expect(dialog.getByLabel('Public handle', { exact: true })).toHaveValue(suggestion.handle);
  expect(writes).toEqual([]);
  expect(await currentProfile(page)).toBeNull();
  const saved = page.waitForResponse(response => response.url().endsWith(profilePath) && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save public profile', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  expect(writes).toEqual([{ ...suggestion, expectedProfileRevision: 0 }]);
  expect(await currentProfile(page)).toMatchObject({ ...suggestion, revision: 1 });
  await expect(dialog.getByText(/Publishing as New Paper Artist/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review public preflight', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('heading', { name: 'Choose your public identity', exact: true })).toHaveCount(0);
  const listings = await page.request.get('/api/community/me/listings');
  expect(listings.ok()).toBe(true);
  expect((await listings.json()).listings).toEqual([]);
});

test('manual profile saving remains available without a text provider and Settings opens separately', async ({ page, baseURL }) => {
  const baseline = await openProfile(page, baseURL!, [providers[0]]);
  await expect(page.getByText('No text provider connected. Connect one in Settings to generate a profile.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate with AI', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Profile AI provider', { exact: true })).toHaveCount(0);
  const settings = page.getByRole('link', { name: 'Provider Settings (new tab)', exact: true });
  await expect(settings).toHaveAttribute('href', '/?settings=providers');
  await expect(settings).toHaveAttribute('target', '_blank');
  const popupPromise = page.waitForEvent('popup');
  await settings.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\?settings=providers/);
  await popup.close();
  await page.bringToFront();
  await page.getByLabel('Public display name', { exact: true }).fill('Entirely manual profile');
  await page.getByLabel('Bio', { exact: true }).fill('Written without generation.');
  const saved = page.waitForResponse(response => response.url().endsWith(profilePath) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save public profile', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  expect(await currentProfile(page)).toMatchObject({
    displayName: 'Entirely manual profile', handle: baseline.handle, bio: 'Written without generation.', revision: baseline.revision + 1,
  });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNoOverflow(page);
  }
});

test('generation works with blank required fields, reviews a separate draft and only saves on explicit submission', async ({ page, baseURL }) => {
  const baseline = await openProfile(page, baseURL!);
  const choice = page.getByLabel('Profile AI provider', { exact: true });
  await expect(choice).toHaveValue('deepseek');
  await expect(choice.getByRole('option')).toHaveText(['My text provider', 'Second text provider']);
  const suggestion = { displayName: 'Paper Lantern', handle: newHandle(), bio: 'Exploring color and everyday shapes.' };
  const generated: unknown[] = [], writes: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith(profilePath) && request.method() === 'PUT') writes.push(request.postDataJSON());
  });
  await page.route(`**${generationPath}`, route => {
    generated.push(route.request().postDataJSON());
    return route.fulfill({ json: { suggestion, provider: 'deepseek' } });
  });
  for (const label of ['Public display name', 'Public handle', 'Bio']) await page.getByLabel(label, { exact: true }).fill('');
  await page.getByLabel('Writing instructions (optional)', { exact: true }).fill('A playful identity for paper art.');
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  expect(generated).toEqual([{ provider: 'deepseek', displayName: '', handle: '', bio: '', prompt: 'A playful identity for paper art.' }]);
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Public handle', { exact: true })).toHaveValue('');
  expect(writes).toEqual([]);
  expect(await currentProfile(page)).toEqual(baseline);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: 'Use suggestion', exact: true })).toBeVisible();
    await expectNoOverflow(page);
  }
  await page.getByRole('button', { name: 'Use suggestion', exact: true }).click();
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue(suggestion.displayName);
  await expect(page.getByLabel('Public handle', { exact: true })).toHaveValue(suggestion.handle);
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue(suggestion.bio);
  await expect(page.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(await currentProfile(page)).toEqual(baseline);
  await page.getByLabel('Public display name', { exact: true }).fill('Edited before saving');
  const saved = page.waitForResponse(response => response.url().endsWith(profilePath) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save public profile', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  expect(writes).toEqual([{ ...suggestion, displayName: 'Edited before saving', expectedProfileRevision: baseline.revision }]);
  expect(await currentProfile(page)).toMatchObject({ ...suggestion, displayName: 'Edited before saving', revision: baseline.revision + 1 });
});

test('generation errors preserve manual fields and permit retry and discard without saving', async ({ page, baseURL }) => {
  const baseline = await openProfile(page, baseURL!);
  let attempts = 0;
  await page.route(`**${generationPath}`, route => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 502, json: { error: { code: 'provider_error', message: 'Provider quota unavailable. Try again.' } } })
      : route.fulfill({ json: { suggestion: { displayName: 'Retry draft', handle: newHandle(), bio: 'A reviewed draft.' }, provider: 'openai' } });
  });
  await page.getByLabel('Profile AI provider', { exact: true }).selectOption('openai');
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Provider quota unavailable. Try again.' })).toBeVisible();
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue(baseline.displayName);
  await expect(page.getByLabel('Public handle', { exact: true })).toHaveValue(baseline.handle);
  await page.getByRole('button', { name: 'Retry generation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  await expect(page.getByText('Draft from Second text provider. Nothing has been saved.', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue(baseline.bio);
  expect(await currentProfile(page)).toEqual(baseline);
});

test('manual edits during pending generation survive the response and prevent applying a stale suggestion', async ({ page, baseURL }) => {
  const baseline = await openProfile(page, baseURL!);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: Record<string, string>[] = [];
  await page.route(`**${generationPath}`, async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await pending;
    await route.fulfill({ json: { suggestion: { displayName: 'Generated draft', handle: newHandle(), bio: 'Suggested bio.' }, provider: 'deepseek' } });
  });
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Generating profile…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Profile AI provider', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Public display name', { exact: true })).toBeEditable();
  await page.getByLabel('Public display name', { exact: true }).fill('Manual edits during generation');
  await page.getByLabel('Bio', { exact: true }).fill('Keep this new manual bio.');
  release();
  await expect(page.getByRole('heading', { name: 'Review AI suggestion', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'You edited your profile after generation started.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use suggestion', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue('Manual edits during generation');
  await expect(page.getByLabel('Bio', { exact: true })).toHaveValue('Keep this new manual bio.');
  expect(await currentProfile(page)).toEqual(baseline);
  await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use suggestion', exact: true })).toBeEnabled();
  expect(requests[1]).toMatchObject({ displayName: 'Manual edits during generation', bio: 'Keep this new manual bio.' });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByLabel('Public display name', { exact: true })).toHaveValue('Manual edits during generation');
  expect(await currentProfile(page)).toEqual(baseline);
});
