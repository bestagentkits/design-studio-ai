import type { Page } from '@playwright/test';
import { test, expect } from './authenticated-browser';

test.beforeEach(async ({ page, baseURL }) => {
  const headers = { Origin: baseURL! };
  const response = await page.request.post('/api/projects', {
    headers, data: { name: 'Keyboard UX', kind: 'slides', templateId: 'product-deck' },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}`);
  await expect(page.locator('.node-target').first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
});

async function mobilePanel(page: Page, name: string) {
  const nav = page.locator('.mobile-editor-nav');
  if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click();
}

test('layers and panel choices navigate without modifying the selected object', async ({ page }, testInfo) => {
  await mobilePanel(page, 'Chat & layers');
  const tabs = page.locator('.left-panel .panel-tabs');
  await tabs.getByRole('button', { name: 'Layers', exact: true }).click();
  const layers = page.locator('.layer-row .layer-name');
  await layers.first().click();
  await page.keyboard.press('ArrowDown');
  await expect(layers.nth(1)).toBeFocused();
  await expect(layers.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `plans/260908-1716-keyboard-ux/reports/layers-${testInfo.project.name}.png` });
  await page.keyboard.press('End');
  await expect(layers.last()).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(layers.first()).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await tabs.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('button', { name: 'Assets', exact: true })).toBeFocused();
  await expect(page.getByLabel('Upload asset')).toHaveCount(1);
  await mobilePanel(page, 'Design');
  const inspectorTabs = page.locator('.inspector .panel-tabs');
  await inspectorTabs.getByRole('button', { name: 'Design', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(inspectorTabs.getByRole('button', { name: 'Theme', exact: true })).toBeFocused();
  await expect(page.getByLabel('Preset', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  const mobile = page.locator('.mobile-editor-nav');
  if (await mobile.isVisible()) {
    await mobile.getByRole('button', { name: 'Design', exact: true }).click();
    await page.keyboard.press('ArrowLeft');
    await expect(mobile.getByRole('button', { name: 'Canvas', exact: true })).toBeFocused();
    await expect(page.locator('.canvas-region')).toBeVisible();
  }
});

test('dialog keys cannot modify the canvas and closing restores opener focus', async ({ page }) => {
  const target = page.locator('.node-target').first();
  await target.focus();
  const geometry = await target.getAttribute('style');
  const count = await page.locator('.node-target').count();
  const opener = page.getByRole('button', { name: 'Export', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(target).toHaveAttribute('style', geometry!);
  await page.keyboard.press('Control+d');
  await expect(page.locator('.node-target')).toHaveCount(count);
  await page.keyboard.press('Delete');
  await expect(page.locator('.node-target')).toHaveCount(count);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(target).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await opener.click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(opener).toBeFocused();

  // Hold delivery of a real export response to exercise the busy dialog's close guard.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/export', async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await opener.click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Design JSON Fully editable source' }).click();
  try {
    await expect(page.getByRole('button', { name: 'Design JSON Fully editable source' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  expect(await (await download).failure()).toBeNull();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('ordinary controls and preview do not inherit destructive canvas shortcuts', async ({ page }) => {
  const target = page.locator('.node-target').first();
  await target.focus();
  const count = await page.locator('.node-target').count();
  const geometry = await target.getAttribute('style');
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await zoom.focus();
  await page.keyboard.press('ArrowRight');
  await expect(target).toHaveAttribute('style', geometry!);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.node-target')).toHaveCount(count);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+d');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.node-target')).toHaveCount(count);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  // Click the body away from the new middle-edge transform handles, which
  // overlap the center of short text nodes at the mobile fit scale.
  const bounds = (await target.boundingBox())!;
  await target.click({ position: { x: bounds.width / 4, y: bounds.height / 2 } });
  await expect(target).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(target).toHaveAttribute('style', geometry!);
  await page.keyboard.press('Control+d');
  await expect(page.locator('.node-target')).toHaveCount(count + 1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.node-target')).toHaveCount(count);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(page.locator('.canvas-viewport')).toBeFocused();
  const added = page.locator('.node-target.selected');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(added).toHaveCSS('left', '74px');
  await added.dblclick();
  const text = page.getByLabel('Edit selected text', { exact: true });
  await expect(text).toBeFocused();
  await text.fill('Text editing');
  await text.press('ArrowLeft');
  await expect(added).toHaveCSS('left', '74px');
  await text.press('Backspace');
  await expect(text).toHaveValue('Text editig');
});

test('appearance menu navigation leaves canvas geometry and selection intact', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Compact editor hides the appearance trigger.');
  const target = page.locator('.node-target').first();
  await target.focus();
  const geometry = await target.getAttribute('style');
  const trigger = page.getByRole('button', { name: 'Appearance: System', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'System', exact: true })).toBeFocused();
  await expect(target).toHaveAttribute('style', geometry!);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(target).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(target).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});
