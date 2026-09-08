import { test, expect } from './authenticated-browser';

test('settings choices follow their layout and appearance remains keyboard selectable', async ({ page }, testInfo) => {
  await page.goto('/?settings=agents');
  const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
  const providers = nav.getByRole('button', { name: 'AI providers', exact: true });
  await providers.click();
  await page.keyboard.press(testInfo.project.name === 'mobile' ? 'ArrowRight' : 'ArrowDown');
  await expect(nav.getByRole('button', { name: 'Agent connections', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(nav.getByRole('button', { name: 'Your account' })).toBeFocused();
  const appearance = page.getByRole('group', { name: 'Appearance preference', exact: true });
  await appearance.getByRole('button', { name: 'System', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(appearance.getByRole('button', { name: 'Light', exact: true })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('End');
  await expect(appearance.getByRole('button', { name: 'Dark', exact: true })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await providers.click();
  const choices = page.locator('.provider-list > button');
  await choices.first().click();
  await page.keyboard.press('ArrowDown');
  await expect(choices.nth(1)).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Connect Anthropic', exact: true })).toBeVisible();
  await page.screenshot({ path: `plans/260908-1716-keyboard-ux/reports/settings-${testInfo.project.name}.png` });
  await page.keyboard.press('Home');
  await expect(choices.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Escape closes the appearance menu without clearing documentation search', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.locator('.docs-app')).toHaveAttribute('data-interactive', 'true');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox', { name: 'Search documentation' });
  await search.fill('tokens');
  const trigger = page.getByRole('button', { name: 'Appearance: System', exact: true });
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue('tokens');
  await trigger.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue('tokens');
});

test('selecting a 3D object retains a stable keyboard editing focus', async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! };
  const created = await page.request.post('/api/projects', {
    headers, data: { name: 'Scene focus', kind: '3d' },
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}`);
  const canvas = page.locator('.scene-view canvas');
  await expect(canvas).toBeVisible();
  await canvas.click();
  await expect(page.locator('.canvas-viewport')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});
