import { test, expect } from './authenticated-browser';
import type { Project } from '../src/shared/schema';

test('thumbnail arrow keys select slides, retain focus, and preserve canvas and text controls', async ({ page, baseURL }, testInfo) => {
  const headers = { Origin: baseURL! };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const created = await page.request.post('/api/projects', {
    headers, data: { name: 'Slide navigation', kind: 'slides', templateId: 'product-deck' },
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json() as { project: Project };
  try {
    await page.goto(`/?project=${project.id}`);
    const thumbnails = page.locator('.page-thumbnail');
    await expect(thumbnails).toHaveCount(3);
    await thumbnails.nth(0).click();
    await page.keyboard.press('ArrowRight');
    await expect(thumbnails.nth(1)).toHaveClass(/selected/);
    await expect(thumbnails.nth(1)).toBeFocused();
    await expect(page.locator('.canvas-svg')).toContainText(project.document.pages[1]!.nodes.find(node => node.type === 'text')!.text!);
    await page.keyboard.press('ArrowRight');
    await expect(thumbnails.nth(2)).toHaveClass(/selected/);
    await page.keyboard.press('ArrowRight');
    await expect(thumbnails.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(thumbnails.nth(0)).toHaveClass(/selected/);
    await expect(thumbnails.nth(0)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    // Tabbing can focus an unselected endpoint; Home/End must select it too.
    await thumbnails.nth(1).click();
    await page.keyboard.press('Shift+Tab');
    await expect(thumbnails.nth(0)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(thumbnails.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await thumbnails.nth(1).click();
    await page.keyboard.press('Tab');
    await expect(thumbnails.nth(2)).toBeFocused();
    await page.keyboard.press('End');
    await expect(thumbnails.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Home');

    // Arrow keys still edit a focused canvas object and move the text caret.
    const target = page.locator('.node-target:not(.locked)').first();
    await target.focus();
    const left = await target.evaluate(element => parseFloat((element as HTMLElement).style.left));
    await page.keyboard.press('ArrowRight');
    await expect(target).toHaveCSS('left', `${left + 1}px`);
    const name = page.getByLabel('Project name', { exact: true });
    await name.fill('Slide navigation');
    await name.press('ArrowLeft');
    expect(await name.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(15);
    await expect(thumbnails.nth(0)).toHaveClass(/selected/);

    // Use real added pages to force overflow on both viewports.
    for (let index = 0; index < 7; index++) await page.getByRole('button', { name: 'Add page', exact: true }).click();
    await thumbnails.nth(0).click();
    for (let index = 1; index < 10; index++) {
      await page.keyboard.press('ArrowRight');
      await expect(thumbnails.nth(index)).toHaveClass(/selected/);
      await expect(thumbnails.nth(index)).toBeFocused();
    }
    await expect(thumbnails.nth(9)).toBeInViewport();
    const strip = page.locator('.page-strip');
    const scrollLeft = await strip.evaluate(element => element.scrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight');
    // Wait for browser scrolling to settle before checking the boundary.
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBe(scrollLeft);
    await expect(thumbnails.nth(9)).toHaveClass(/selected/);
    await page.screenshot({ path: `plans/reports/slide-navigation-${testInfo.project.name}.png` });
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`/api/projects/${project.id}`, { headers });
  }
});
