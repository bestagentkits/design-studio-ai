import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument, Project } from '../src/shared/schema';

const generationPath = '/api/community/metadata/generate';
const suggestion = { title: 'Paper Lantern', description: 'An editable study of color and everyday shapes.', tags: ['paper', 'color'] };
const providers = [
  { provider: 'fal', name: 'Image only', model: 'image-model', configured: true },
  { provider: 'deepseek', name: 'My text provider', model: 'saved-model', configured: true },
  { provider: 'openai', name: 'Second text provider', model: 'another-model', configured: true },
];

async function openPublication(page: Page, baseURL: string, configured = providers, document?: DesignDocument) {
  const previous = await page.request.get('/api/community/me/profile');
  expect(previous.ok()).toBe(true);
  const saved = await page.request.put('/api/community/me/profile', {
    headers: { Origin: baseURL }, data: { displayName: 'Metadata browser author', handle: `metadata-${randomUUID().slice(0, 8)}`, bio: 'Exploring editable design.', expectedProfileRevision: (await previous.json()).profile?.revision ?? 0 },
  });
  expect(saved.ok()).toBe(true);
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL }, data: { name: 'Manual listing title', kind: document?.kind ?? 'web', ...(document ? { document } : {}) } });
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
  // Thumbnail readiness is derived from a background render, not a project edit.
  const { thumbnailRevision: _originalThumbnail, ...original } = project;
  const { thumbnailRevision: _currentThumbnail, ...saved } = (await current.json()).project as Project;
  expect(saved).toEqual(original);
  const listings = await page.request.get('/api/community/me/listings');
  expect(listings.ok()).toBe(true);
  expect((await listings.json()).listings.some((listing: { sourceProjectId?: string }) => listing.sourceProjectId === project.id)).toBe(false);
}

test('publication review fits the dialog and keeps consent labels and close control reachable', async ({ page, baseURL }, testInfo) => {
  const { project, dialog, ai } = await openPublication(page, baseURL!);
  const title = 'UnbrokenDesignTitle'.repeat(12).slice(0, 200);
  const description = 'A detailed editable design with carefully arranged sections and reusable visual content. '.repeat(50).slice(0, 4000);
  const tags = Array.from({ length: 8 }, (_, index) => `${index}${'longtag'.repeat(5)}`.slice(0, 32)).join(', ');
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Description', { exact: true }).fill(description);
  await dialog.getByLabel('Tags', { exact: true }).fill(tags);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1440, 840, 375]) {
      await page.setViewportSize({ width, height: 844 });
      await dialog.locator('.community-publish').evaluate(element => { element.scrollTop = 0; });
      await expect(dialog.getByRole('heading', { name: 'Publish to Community', exact: true })).toBeInViewport();
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `plans/260912-1741-community-publish/reports/initial-${testInfo.project.name}-${theme}-${width}.png` });
    }
  }
  await dialog.getByRole('button', { name: 'Review public preflight', exact: true }).click();
  const rights = dialog.getByRole('checkbox', { name: /I have the rights/ });
  await expect(rights).toBeEnabled();
  const formats = dialog.getByRole('group', { name: 'Download formats' });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1440, 840, 375]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await dialog.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
        overflowing: [...element.querySelectorAll('.community-publish, .community-public-review, fieldset')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className || node.tagName) }));
      expect(overflow.scroll, `${theme} ${width}: dialog horizontal overflow`).toBeLessThanOrEqual(overflow.width + 1);
      expect(overflow.overflowing, `${theme} ${width}: child horizontal overflow`).toEqual([]);
      for (const checkbox of await dialog.getByRole('checkbox').all()) {
        const size = await checkbox.boundingBox();
        const label = await checkbox.locator('..').boundingBox();
        const text = await checkbox.locator('..').locator('span').first().boundingBox();
        expect(size!.width).toBeLessThanOrEqual(24);
        expect(size!.height).toBeLessThanOrEqual(24);
        expect(label!.height).toBeGreaterThanOrEqual(44);
        expect(text!.x).toBeGreaterThanOrEqual(size!.x + size!.width + 8);
        expect(text!.x + text!.width).toBeLessThanOrEqual(label!.x + label!.width + 1);
      }
      await dialog.locator('.community-publish').evaluate(element => { element.scrollTop = 0; });
      await expect(dialog.getByRole('heading', { name: 'Publish to Community', exact: true })).toBeInViewport();
      await page.screenshot({ path: `plans/260912-1741-community-publish/reports/review-top-${testInfo.project.name}-${theme}-${width}.png` });
      await formats.scrollIntoViewIfNeeded();
      const close = await dialog.getByRole('button', { name: 'Close dialog', exact: true }).boundingBox();
      expect(close!.y).toBeGreaterThanOrEqual(0);
      expect(close!.y + close!.height).toBeLessThanOrEqual(844);
      await page.screenshot({ path: `plans/260912-1741-community-publish/reports/formats-${testInfo.project.name}-${theme}-${width}.png` });
      await rights.check();
      await dialog.getByRole('checkbox', { name: /I reviewed the public content/ }).check();
      const publish = dialog.getByRole('button', { name: 'Confirm and publish', exact: true });
      await expect(publish).toBeEnabled();
      await publish.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `plans/260912-1741-community-publish/reports/review-${testInfo.project.name}-${theme}-${width}.png` });
      await rights.uncheck();
      await expect(publish).toBeDisabled();
    }
  }
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(description);
  await expect(dialog.getByLabel('Tags', { exact: true })).toHaveValue(tags);
  await page.setViewportSize({ width: 840, height: 500 });
  await rights.scrollIntoViewIfNeeded();
  await rights.focus();
  await page.keyboard.press('Space');
  await expect(rights).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Confirm and publish', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('heading', { name: 'Publish to Community', exact: true })).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `plans/260912-1741-community-publish/reports/review-short-${testInfo.project.name}.png` });
  await page.keyboard.press('Space');
  await expect(rights).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Confirm and publish', exact: true })).toBeDisabled();
  await expectProjectUnchanged(page, project);
  await ai.locator('summary').focus();
  await page.keyboard.press('Shift+Tab');
  if (await dialog.locator('.community-publish').evaluate(element => element === document.activeElement)) {
    // Firefox includes native scroll containers in sequential keyboard navigation.
    await page.keyboard.press('Shift+Tab');
  }
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
});

test('All selects supported optional downloads and partial or cleared selections require new consent', async ({ page, baseURL }) => {
  const { project, dialog } = await openPublication(page, baseURL!);
  const review = dialog.getByRole('button', { name: 'Review public preflight', exact: true });
  await review.click();
  const formats = dialog.getByRole('group', { name: 'Download formats' });
  const all = formats.getByRole('checkbox', { name: 'All', exact: true });
  const required = formats.getByRole('checkbox', { name: /Studio project package/ });
  const optional = formats.locator('label:not(.community-select-all):not(.community-required-format) input[type="checkbox"]');
  const rights = dialog.getByRole('checkbox', { name: /I have the rights/ });
  const confirm = dialog.getByRole('checkbox', { name: /I reviewed the public content/ });
  await expect(all).not.toBeChecked();
  await expect(required).toBeChecked();
  await expect(required).toBeDisabled();
  await rights.check(); await confirm.check();
  await all.check();
  for (const checkbox of await optional.all()) await expect(checkbox).toBeChecked();
  await expect(dialog.getByRole('heading', { name: 'What will be shared' })).toHaveCount(0);
  await review.click();
  await expect(rights).not.toBeChecked(); await expect(confirm).not.toBeChecked();
  await rights.check(); await confirm.check();
  await formats.getByRole('checkbox', { name: 'SVG', exact: true }).uncheck();
  await expect(all).toHaveJSProperty('indeterminate', true);
  await expect(dialog.getByRole('heading', { name: 'What will be shared' })).toHaveCount(0);
  await all.check();
  await expect(all).toHaveJSProperty('indeterminate', false);
  for (const checkbox of await optional.all()) await expect(checkbox).toBeChecked();
  await all.uncheck();
  for (const checkbox of await optional.all()) await expect(checkbox).not.toBeChecked();
  await expect(required).toBeChecked();
  await review.click();
  await expect(rights).not.toBeChecked(); await expect(confirm).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Confirm and publish' })).toBeDisabled();
  await expectProjectUnchanged(page, project);
});

test('frame archives use fitting full-duration FPS and invalid explicit FPS cannot pass preflight', async ({ page, baseURL }) => {
  const document = createDocument('video', 'Frame archive browser check');
  document.pages[0].width = 1280; document.pages[0].height = 800;
  document.timeline = { duration: 9.25, fps: 30, tracks: [] };
  const { project, dialog } = await openPublication(page, baseURL!, providers, document);
  const requests: { formats: { format: string; fps: number }[] }[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/community/preflight') && request.method() === 'POST') requests.push(request.postDataJSON()); });
  const review = dialog.getByRole('button', { name: 'Review public preflight', exact: true });
  await review.click();
  const formats = dialog.getByRole('group', { name: 'Download formats' });
  await formats.getByRole('checkbox', { name: 'All', exact: true }).check();
  const fps = formats.getByLabel('Frame archive FPS', { exact: true });
  await expect(fps).toHaveValue('7');
  await review.click();
  await expect(dialog.getByRole('heading', { name: 'What will be shared' })).toBeVisible();
  const sent = requests.at(-1)!.formats;
  expect(sent.filter(option => ['png-sequence', 'spritesheet'].includes(option.format))).toEqual([
    { format: 'png-sequence', pageIndex: 0, start: 0, fps: 7 }, { format: 'spritesheet', pageIndex: 0, start: 0, fps: 7 },
  ]);
  expect(sent.filter(option => !['png-sequence', 'spritesheet'].includes(option.format)).every(option => option.fps === 30)).toBe(true);
  const rights = dialog.getByRole('checkbox', { name: /I have the rights/ });
  await rights.check(); await dialog.getByRole('checkbox', { name: /I reviewed the public content/ }).check();
  await fps.fill('30');
  await expect(dialog.getByRole('heading', { name: 'What will be shared' })).toHaveCount(0);
  const rejected = page.waitForResponse(response => response.url().endsWith('/api/community/preflight') && response.request().method() === 'POST');
  await review.click();
  expect((await rejected).status()).toBe(413);
  await expect(dialog.getByRole('alert').filter({ hasText: 'Use at most 7 fps' })).toBeVisible();
  await expect(fps).toHaveValue('30');
  await expect(dialog.getByRole('button', { name: 'Confirm and publish' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Congratulations!', exact: true })).toHaveCount(0);
  await fps.fill('6');
  await review.click();
  await expect(dialog.getByRole('heading', { name: 'What will be shared' })).toBeVisible();
  await expect(fps).toHaveValue('6');
  await expect(rights).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /I reviewed the public content/ })).not.toBeChecked();
  expect(requests.at(-1)!.formats.filter(option => ['png-sequence', 'spritesheet'].includes(option.format)).every(option => option.fps === 6)).toBe(true);
  await expectProjectUnchanged(page, project);
});

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
