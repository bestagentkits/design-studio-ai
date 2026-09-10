import { test, expect, type Page } from '@playwright/test';

const publicPaths = ['/', '/guide', '/docs', '/docs/revisions', '/docs/motion', '/docs/api', '/docs/cli', '/docs/mcp', '/docs/webmcp', '/docs/api-keys', '/docs/observability', '/docs/self-hosting'];
const markdownPaths = ['/docs.md', '/guide.md', '/docs/index.md', '/docs/quickstart.md', '/docs/revisions.md', '/docs/motion.md', '/docs/api.md', '/docs/cli.md', '/docs/mcp.md', '/docs/webmcp.md', '/docs/api-keys.md', '/docs/observability.md', '/docs/self-hosting.md'];
async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('public HTML and agent references have real content, correct types, and public-only discovery', async ({ request }) => {
  const titles = new Set<string>();
  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    expect(html, path).toMatch(/<h1\b/);
    expect(html.match(/rel="canonical"/g), path).toHaveLength(1);
    expect(html.match(/type="application\/ld\+json"/g), path).toHaveLength(1);
    expect(html, path).toContain('type="module"');
    expect(html, path).toContain('design-studio:appearance');
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
    expect(new URL(canonical!).pathname, path).toBe(path);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    expect(title, path).toBeTruthy();
    titles.add(title!);
  }
  expect(titles.size).toBe(publicPaths.length);
  for (const path of markdownPaths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');
    expect(await response.text(), path).toMatch(/^# /);
  }
  const apiMarkdown = await (await request.get('/docs/api.md')).text();
  expect(apiMarkdown).toContain('## POST /api/projects/:id/brief/approve');
  expect(apiMarkdown).toContain('## GET /api/projects/:id/checks');
  expect(apiMarkdown).toContain('expectedRevision');
  const schema = await (await request.get('/api/schema')).json();
  expect(Object.keys(schema).sort()).toEqual(['clientEvent', 'designSystem', 'document', 'documentWrite', 'exportInput', 'generationInput', 'interview', 'mediaInput', 'motionProposal', 'observabilityQuery', 'operations', 'providerId', 'providerInterview', 'providerSettings', 'providers', 'scope']);
  expect(schema.documentWrite.properties.expectedBriefRevision).toBeDefined();
  expect(schema.exportInput.properties.format.enum).toEqual(expect.arrayContaining(['motion', 'png-sequence', 'spritesheet']));
  expect(schema.motionProposal.maxItems).toBe(100);
  expect(schema.providerSettings.properties.authMethod.enum).toEqual(['bearer', 'api-key', 'basic', 'none']);
  expect(schema.clientEvent.additionalProperties).toBe(false);
  expect(schema.observabilityQuery.properties.scope.enum).toEqual(['owner', 'all']);
  expect(schema.designSystem.properties.components.items.properties.src).toBeDefined();
  const openapi = await (await request.get('/api/openapi')).json();
  expect(Object.keys(openapi.components.schemas).every(name => /^[\w.-]+$/.test(name))).toBe(true);
  expect(openapi.paths['/api/projects/{id}/assets'].post.requestBody.content['multipart/form-data'].schema.properties.file.format).toBe('binary');
  expect(openapi.paths['/api/fonts'].get.parameters).toContainEqual(expect.objectContaining({ name: 'q', in: 'query' }));
  expect(openapi.paths['/api/design-systems/{id}'].get.parameters).toContainEqual(expect.objectContaining({ name: 'version', in: 'query' }));
  expect(apiMarkdown).toContain('## POST /api/design-systems');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  const locations = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
  expect(locations.sort()).toEqual([...publicPaths].sort());
  const llms = await request.get('/llms.txt');
  expect(llms.headers()['content-type']).toContain('text/plain');
  const llmsText = await llms.text();
  expect(llmsText).toMatch(/^# Design Studio AI\s+>/);
  expect(llmsText.lastIndexOf('## Optional')).toBeGreaterThan(llmsText.indexOf('## Reference'));
  const full = await (await request.get('/llms-full.txt')).text();
  expect(full).toContain('approve_design_brief');
  expect(full).toContain('studio_inspect_design');
  const robots = await request.get('/robots.txt');
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toContain('Sitemap:');
  expect((await request.get('/not-a-real-public-page')).status()).toBe(404);
});

test('documentation and visual guide remain readable and navigable without JavaScript', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: testInfo.project.use.viewport, baseURL });
  const page = await context.newPage();
  try {
    await page.goto('/docs/api');
    await expect(page.getByRole('heading', { name: 'REST API', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Documentation sections' })).toBeVisible();
    const endpoint = page.locator('details').filter({ has: page.locator('summary code', { hasText: '/api/projects/:id/brief/approve' }) });
    await endpoint.locator('summary').click();
    await expect(endpoint.getByRole('heading', { name: 'Approve the current scope' })).toBeVisible();
    await fitsViewport(page);
    await page.getByRole('navigation', { name: 'Documentation sections' }).getByRole('link', { name: 'Network MCP' }).click();
    await expect(page.getByRole('heading', { name: 'Network MCP', exact: true })).toBeVisible();
    await page.goto('/guide');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your first idea');
    const steps = page.getByRole('navigation', { name: 'Guide steps' }).getByRole('link');
    await expect(steps).toHaveCount(6);
    await steps.nth(2).click();
    await expect(page.locator('#conversation')).toBeInViewport();
    await expect(page.locator('#conversation')).toContainText('Approve scope');
    await fitsViewport(page);
    for (const image of await page.locator('.guide-screenshot img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
  } finally { await context.close(); }
});

test('docs search, endpoint keyboard controls, copy, theme, and history work on each viewport', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/docs');
  await expect(page.locator('.docs-app')).toHaveAttribute('data-interactive', 'true');
  await page.getByRole('button', { name: 'Copy Install and discover' }).click();
  await expect(page.getByRole('button', { name: 'Copy Install and discover' })).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`DESIGN_STUDIO_URL=${baseURL}`);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox', { name: 'Search documentation' });
  await expect(search).toBeFocused();
  await search.fill('no-such-section-at-all');
  await expect(page.getByRole('heading', { name: 'No matches yet' })).toBeVisible();
  await search.fill('/api/projects/:id/brief');
  await page.getByRole('region', { name: 'Search results' }).getByRole('link', { name: /REST API/ }).click();
  await expect(page).toHaveURL(/\/docs\/api$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.getByRole('textbox', { name: 'Filter API endpoints' }).fill('/brief/approve');
  const endpoint = page.locator('.docs-endpoint');
  await expect(endpoint).toHaveCount(1);
  await endpoint.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(endpoint).toHaveAttribute('open', '');
  await page.getByRole('button', { name: /^Appearance:/ }).click();
  await page.getByRole('menuitemradio', { name: /Dark/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await fitsViewport(page);
  await page.reload();
  await expect(page.locator('.docs-app')).toHaveAttribute('data-interactive', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goBack();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { name: 'Quickstart', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('guide starter briefs copy the selected content and preserve keyboard-accessible disclosure', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/guide');
  await expect(page.locator('.guide-app')).toHaveAttribute('data-interactive', 'true');
  await page.getByRole('combobox', { name: 'Choose a starter brief' }).selectOption('Slides');
  await page.getByRole('button', { name: 'Copy starter brief' }).click();
  await expect(page.getByRole('status')).toHaveText('Starter brief copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('six-slide product introduction');
  const question = page.locator('.guide-faq summary').first();
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.guide-faq details').first()).toHaveAttribute('open', '');
  await fitsViewport(page);
});
