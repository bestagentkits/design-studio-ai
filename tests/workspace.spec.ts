import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Project } from '../src/shared/schema';

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'The page must not overflow horizontally').toBe(true);
}

test('register, sign in, edit and save a template, find, duplicate, publish and export it', async ({ page, baseURL }, testInfo) => {
  const email = `workspace-${randomUUID()}@studio.test`;
  const password = `${randomUUID()}-${randomUUID()}`;
  const name = `Workspace ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  const text = `A saved idea from ${testInfo.project.name}`;
  const mobile = testInfo.project.name === 'mobile';
  const ownedProjects = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = new URL(baseURL!).origin;
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'What should we create?' })).toBeVisible();
    await fitsViewport(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('Workspace tester');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password').fill(password);
    const registering = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect((await registering).status(), 'Use an isolated test server; registration is rate limited per IP').toBe(201);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Your next project starts here' })).toBeVisible();

    await page.getByRole('button', { name: 'Your account and settings', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Your account' }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('.template-card.template-web').click();
    await page.getByLabel('Project name', { exact: true }).fill(name);
    const creating = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Start from template', exact: true }).click();
    const created = await creating;
    expect(created.status()).toBe(201);
    const project = ((await created.json()) as { project: Project }).project;
    ownedProjects.add(project.id);
    expect(project.document.pages[0].nodes.length).toBeGreaterThan(3);
    await expect(page.getByRole('button', { name: 'Back to workspace' })).toBeVisible();
    // This workflow verifies the explicit Save response; live autosave has its own coverage.
    await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
    await fitsViewport(page);
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    if (mobile) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Design', exact: true }).click();
    await page.getByLabel('Text', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByLabel('Preset', { exact: true }).selectOption('moss');
    await page.getByLabel('Heading font', { exact: true }).fill('Arial');
    const saving = page.waitForResponse(response => response.url().endsWith(`/api/projects/${project.id}/document`) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await saving;
    expect(saved.status()).toBe(200);
    const savedProject = ((await saved.json()) as { project: Project }).project;
    expect(savedProject.document.theme.id).toBe('moss');
    expect(savedProject.document.theme.fonts.heading).toBe('Arial');
    expect(savedProject.document.pages[0].nodes.some(node => node.text === text)).toBe(true);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Back to workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to workspace' }).click();
    await expect(page.locator('.project-card').filter({ hasText: name })).toHaveCount(1);
    await page.getByLabel('Search your projects', { exact: true }).fill('no-project-matches-this-search');
    await expect(page.getByRole('heading', { name: 'No matching projects' })).toBeVisible();
    await page.getByLabel('Search your projects', { exact: true }).fill(name);
    await page.getByLabel('Filter project type', { exact: true }).selectOption('slides');
    await expect(page.getByRole('heading', { name: 'No matching projects' })).toBeVisible();
    await page.getByLabel('Filter project type', { exact: true }).selectOption('web');
    await expect(page.locator('.project-card')).toHaveCount(1);
    const duplicating = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByRole('button', { name: `Duplicate ${name}`, exact: true }).click();
    const duplicated = await duplicating;
    expect(duplicated.status()).toBe(201);
    const copy = ((await duplicated.json()) as { project: Project }).project;
    ownedProjects.add(copy.id);
    expect(copy.name).toBe(`${name} copy`);
    expect(copy.document.pages[0].nodes.some(node => node.text === text)).toBe(true);
    await expect(page.locator('.project-card')).toHaveCount(2);
    await page.locator('.project-card').filter({ has: page.getByText(name, { exact: true }) }).locator('.project-open').click();
    if (mobile) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Chat & layers', exact: true }).click();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page.getByRole('button', { name: 'Your text', exact: true }).click();
    if (mobile) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Design', exact: true }).click();
    await expect(page.getByLabel('Text', { exact: true })).toHaveValue(text);
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(page.getByLabel('Preset', { exact: true })).toHaveValue('moss');
    await expect(page.getByLabel('Heading font', { exact: true })).toHaveValue('Arial');
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByLabel('Public link')).toBeVisible();
    const publicUrl = await page.getByLabel('Public link').inputValue();
    const publicContext = await page.context().browser()!.newContext();
    try {
      const publicPage = await publicContext.newPage();
      const published = await publicPage.goto(publicUrl);
      expect(published?.status()).toBe(200);
      const textNode = savedProject.document.pages[0].nodes.find(node => node.text === text)!;
      const publishedText = publicPage.locator(`[data-design-node="${textNode.id}"]`);
      await expect(publishedText).toBeVisible();
      await expect(publishedText).toHaveText(text);
    } finally { await publicContext.close(); }
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exporting = page.waitForResponse(response => response.url().endsWith(`/api/projects/${project.id}/export`) && response.request().method() === 'POST');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PNG image Current page' }).click();
    const exported = await exporting;
    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-type']).toContain('image/png');
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const bytes = await readFile((await download.path())!);
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(project.document.pages[0].width);
    expect(bytes.readUInt32BE(20)).toBe(project.document.pages[0].height);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await fitsViewport(page);
    expect(errors).toEqual([]);
  } finally {
    // Keep cleanup possible after the workflow itself reaches its timeout.
    testInfo.setTimeout(testInfo.timeout + 20_000);
    for (const id of ownedProjects) {
      const response = await page.request.delete(`/api/projects/${id}`, { headers: { Origin: origin }, timeout: 10_000 });
      expect(response.status(), 'Remove the project created by this test').toBe(200);
    }
    await page.request.post('/api/auth/logout', { headers: { Origin: origin } });
  }
});
