import { test, expect } from './authenticated-browser';
import { randomUUID } from 'node:crypto';

test('custom connections persist and appear in editor provider choices without a reload', async ({ page, baseURL }, info) => {
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: 'Provider workflow' } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).project;
  await page.goto(`/?project=${project.id}`);
  if ((page.viewportSize()?.width ?? 1440) < 768) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Chat & layers', exact: true }).click();
  await page.locator('.provider-settings').click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Google Gemini', 'LeonardoAI', 'Grok (xAI)', 'DeepSeek']) await expect(dialog.getByRole('button').filter({ has: page.getByText(name, { exact: true }) })).toHaveCount(1);
  await dialog.getByRole('button', { name: /Add custom provider/ }).click();
  await dialog.getByLabel('Provider name', { exact: true }).fill('Team custom');
  await dialog.getByLabel('Provider ID', { exact: true }).fill('browser-team');
  await dialog.getByLabel('API format', { exact: true }).selectOption('openai');
  await dialog.getByLabel('Base URL', { exact: true }).fill('https://unlisted.example/v1');
  await dialog.getByLabel('Authentication method', { exact: true }).selectOption('none');
  await dialog.getByRole('combobox', { name: 'Default model', exact: true }).fill('team-model');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('allowlisted');
  await dialog.getByLabel('Base URL', { exact: true }).fill('https://browser-provider.example/v1');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Team custom connected.' })).toBeVisible();
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveCount(0);
  const data = (await (await page.request.get('/api/providers')).json()).providers;
  expect(data.find((p: {provider:string}) => p.provider === 'custom-browser-team').authMethod).toBe('none');
  await page.keyboard.press('Escape');
  const selector = page.getByLabel('Generation provider', { exact: true });
  await expect(selector.locator('option[value="custom-browser-team"]')).toHaveText('Team custom');
  await expect(selector.locator('option[value="deepseek"]')).toHaveText('DeepSeek');
  await expect(selector.locator('option[value="leonardo"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  const mediaProvider = page.getByLabel('Provider', { exact: true });
  for (const id of ['gemini', 'grok', 'leonardo', 'custom-browser-team']) await expect(mediaProvider.locator(`option[value="${id}"]`)).toHaveCount(1);
  await mediaProvider.selectOption('leonardo');
  await expect(page.getByLabel('Source asset', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('.provider-settings').click();
  await dialog.getByRole('button', { name: /Team custom/ }).click();
  await expect(dialog.getByLabel('Base URL', { exact: true })).toHaveValue('https://browser-provider.example/v1');
  await expect(dialog.getByLabel('Authentication method', { exact: true })).toHaveValue('none');
  await dialog.getByRole('combobox', { name: 'Default model', exact: true }).fill('updated-model');
  await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Team custom connected.' })).toBeVisible();
  await page.screenshot({ path: `plans/260910-1828-provider-integrations/provider-settings-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  const briefResponse = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: 'Provider brief workflow' } });
  const briefProject = (await briefResponse.json()).project;
  expect((await page.request.put(`/api/projects/${briefProject.id}/brief`, { headers: { Origin: baseURL! }, data: { expectedRevision: 0, request: 'Design a welcoming library homepage' } })).status()).toBe(200);
  await page.goto(`/?project=${briefProject.id}`);
  const interviewProvider = page.getByLabel('Interview provider', { exact: true });
  await interviewProvider.selectOption('custom-browser-team');
  await expect(interviewProvider).toHaveValue('custom-browser-team');
  await expect(interviewProvider.locator('option[value="custom-browser-team"]')).toHaveText('Team custom');
  await page.goto(`/?project=${project.id}`);
  if ((page.viewportSize()?.width ?? 1440) < 768) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Chat & layers', exact: true }).click();
  await page.locator('.provider-settings').click();
  await dialog.getByRole('button', { name: /Team custom/ }).click();
  await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Provider disconnected.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selector.locator('option[value="custom-browser-team"]')).toHaveCount(0);
  await page.request.delete(`/api/projects/${briefProject.id}`, { headers: { Origin: baseURL! } });
  await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } });
});

test('credential-authenticated custom connections send the key without ever returning it', async ({ page, baseURL }) => {
  const secret = `sk-e2e-${randomUUID()}`;
  const created = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: 'Credential provider' } });
  expect(created.status()).toBe(201);
  const project = (await created.json()).project;
  await page.goto(`/?project=${project.id}`);
  if ((page.viewportSize()?.width ?? 1440) < 768) await page.locator('.mobile-editor-nav').getByRole('button', { name: 'Chat & layers', exact: true }).click();
  await page.locator('.provider-settings').click();
  const dialog = page.getByRole('dialog');
  try {
    await dialog.getByRole('button', { name: /Add custom provider/ }).click();
    await dialog.getByLabel('Provider name', { exact: true }).fill('Keyed custom');
    await dialog.getByLabel('Provider ID', { exact: true }).fill('browser-keyed');
    await dialog.getByLabel('API format', { exact: true }).selectOption('openai');
    await dialog.getByLabel('Base URL', { exact: true }).fill('https://browser-provider.example/v1');
    await dialog.getByLabel('Authentication method', { exact: true }).selectOption('api-key');
    await dialog.getByLabel('Authentication header', { exact: true }).fill('X-API-Key');
    await dialog.getByRole('combobox', { name: 'Default model', exact: true }).fill('keyed-model');
    const request = page.waitForRequest(r => r.url().endsWith('/api/providers/custom-browser-keyed') && r.method() === 'PUT');
    await dialog.getByLabel('API key', { exact: true }).fill(secret);
    await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
    const sent = (await request).postDataJSON();
    expect(sent.authMethod).toBe('api-key');
    expect(sent.authHeader).toBe('X-API-Key');
    expect(sent.apiKey).toBe(secret);
    await expect(dialog.getByRole('status').filter({ hasText: 'Keyed custom connected.' })).toBeVisible();
    // The credential is submitted from the password field, then cleared and never re-rendered.
    await expect(dialog.getByLabel('API key', { exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain(secret);
    const providers = (await (await page.request.get('/api/providers')).json()).providers;
    const connection = providers.find((p: { provider: string }) => p.provider === 'custom-browser-keyed');
    // The connection is accepted against the allowlisted test origin and reports masked metadata only.
    expect(connection.baseUrl).toBe('https://browser-provider.example/v1');
    expect(connection.authMethod).toBe('api-key');
    expect(connection.authHeader).toBe('X-API-Key');
    expect(connection.apiKey).toBe('••••••••');
    expect(JSON.stringify(providers)).not.toContain(secret);
    // Re-opening the saved connection keeps the credential out of the form.
    await dialog.getByRole('button', { name: /Keyed custom/ }).click();
    await expect(dialog.getByLabel('API key', { exact: true })).toHaveValue('');
    // Changing the authentication contract without re-entering a credential is rejected.
    await dialog.getByLabel('Authentication method', { exact: true }).selectOption('basic');
    await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a credential');
  } finally {
    await page.keyboard.press('Escape');
    await page.request.delete('/api/providers/custom-browser-keyed', { headers: { Origin: baseURL! } });
    await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } });
  }
});
