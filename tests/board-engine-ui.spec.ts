import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { gif } from './helpers/gif-fixture';
let script: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['scripts/board-engine-probe.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.setContent('<!doctype html><html><body><main id="probe"></main></body></html>');
  await page.addScriptTag({ content: script });
});
test('native pressure stroke commits once and cancellation does not add a mark', async ({ page }) => {
  await page.getByLabel('Drawing surface').scrollIntoViewIfNeeded();
  const box = (await page.getByLabel('Drawing surface').boundingBox())!;
  await page.mouse.move(box.x + 30 * box.width / 512, box.y + 40 * box.height / 512); await page.mouse.down();
  await page.mouse.move(box.x + 160 * box.width / 512, box.y + 90 * box.height / 512, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('#marks path')).toHaveCount(1);
  const path = await page.locator('#marks path').getAttribute('d'); expect(path).toContain('M');
  await page.mouse.move(box.x + 30 * box.width / 512, box.y + 120 * box.height / 512); await page.mouse.down();
  await page.mouse.move(box.x + 200 * box.width / 512, box.y + 150 * box.height / 512, { steps: 5 });
  await page.getByLabel('Drawing surface').press('Escape'); await page.mouse.up();
  await expect(page.locator('#marks path')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#marks path')).toHaveCount(0);
});
test('paint previews real pixels before release and commits the same brush', async ({ page }) => {
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await page.getByRole('button', { name: 'Color #be563e' }).click();
  await page.getByLabel('Drawing surface').scrollIntoViewIfNeeded();
  const box = (await page.getByLabel('Drawing surface').boundingBox())!;
  await page.mouse.move(box.x + 40 * box.width / 512, box.y + 40 * box.height / 512); await page.mouse.down();
  await page.mouse.move(box.x + 180 * box.width / 512, box.y + 40 * box.height / 512, { steps: 16 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const live = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(70, 40, 1, 1).data[3]);
  expect(live).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('Paint committed');
  const pixel = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(70, 40, 1, 1).data]);
  expect(pixel[0]).toBeGreaterThan(pixel[2]); expect(pixel[3]).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(70, 40, 1, 1).data[3]);
  expect(undone).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const redone = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(70, 40, 1, 1).data]);
  expect(redone).toEqual(pixel);
});

test('release endpoint is retained and oversized input fails without a partial commit', async ({ page }) => {
  await page.getByLabel('Drawing surface').evaluate(surface => {
    // Register an actual pointer for capture before dispatching the release-only endpoint below.
    surface.setPointerCapture = () => {};
    surface.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'pen', button: 0, pressure: .8, clientX: 40, clientY: 200 }));
    surface.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'pen', pressure: 0, clientX: 220, clientY: 200 }));
  });
  await page.getByLabel('Drawing surface').scrollIntoViewIfNeeded();
  const box = (await page.getByLabel('Drawing surface').boundingBox())!;
  const bounds = await page.locator('#marks path').evaluate((path: SVGPathElement) => ({ x: path.getBBox().x, width: path.getBBox().width }));
  expect(bounds.x + bounds.width).toBeGreaterThan((220 - box.x) * 512 / box.width);
  await page.getByLabel('Drawing surface').evaluate(surface => {
    surface.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 10, button: 0, clientX: 50, clientY: 210 }));
    const event = new PointerEvent('pointermove', { pointerId: 10, clientX: 100, clientY: 210 });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => Array(4100).fill(event) });
    surface.dispatchEvent(event);
    surface.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10, clientX: 150, clientY: 210 }));
  });
  await expect(page.locator('#status')).toHaveText('Stroke too long; nothing committed');
  await expect(page.locator('#marks path')).toHaveCount(1);
});

test('three real GIFs seek deterministically and remain paused beneath vector content', async ({ page }) => {
  await page.locator('summary').click();
  await page.getByLabel('GIF files (up to three)').setInputFiles([0, 1, 2].map(index => ({ name: `motion-${index}.gif`, mimeType: 'image/gif', buffer: Buffer.from(gif(index)) })));
  await expect(page.getByText('3 GIFs loaded locally')).toBeVisible();
  const time = page.getByLabel('GIF time (ms)'); await time.fill('90');
  for (let index = 1; index <= 3; index++) {
    const pixels = await page.getByLabel(`GIF ${index}`, { exact: true }).evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 2, 1).data]);
    expect(pixels).toEqual([0, 255, 0, 255, 0, 0, 0, 0]);
  }
  await expect(time).toHaveValue('90');
  await page.getByRole('button', { name: 'Play GIFs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause GIFs' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause GIFs' }).click();
  const paused = await time.inputValue();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(time).toHaveValue(paused);
  const order = await page.getByLabel('GIF 1', { exact: true }).evaluate(canvas => Boolean(canvas.compareDocumentPosition(document.querySelector('#surface svg')!) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(order).toBe(true);
});

test('mouse speed changes rendered ink width and paint cancellation discards only the live draft', async ({ page }) => {
  const surface = page.getByLabel('Drawing surface');
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  for (const [row, interval] of [[80, 20], [150, 1]]) {
    await surface.evaluate(s => s.addEventListener('pointerdown', e => { s.dataset.pointer = String((e as PointerEvent).pointerId); s.dataset.time = String(e.timeStamp); }, { once: true }));
    await page.mouse.move(box.x + 30 * box.width / 512, box.y + row * box.height / 512); await page.mouse.down();
    await surface.evaluate((s, { row, interval }) => {
      const rect = s.getBoundingClientRect(), pointerId = Number(s.dataset.pointer), time = Number(s.dataset.time);
      for (let i = 1; i <= 80; i++) {
        const event = new PointerEvent('pointermove', { pointerId, pointerType: 'mouse', clientX: rect.left + (30 + i * 3) * rect.width / 512, clientY: rect.top + row * rect.height / 512, buttons: 1 });
        Object.defineProperty(event, 'timeStamp', { value: time + i * interval }); s.dispatchEvent(event);
      }
      const up = new PointerEvent('pointerup', { pointerId, pointerType: 'mouse', clientX: rect.left + 270 * rect.width / 512, clientY: rect.top + row * rect.height / 512 });
      Object.defineProperty(up, 'timeStamp', { value: time + 81 * interval }); s.dispatchEvent(up);
    }, { row, interval });
    await page.mouse.up();
  }
  const widths = await page.locator('#marks path').evaluateAll(paths => paths.map((path, index) => {
    const row = index ? 150 : 80;
    let covered = 0;
    for (let dy = -25; dy <= 25; dy += .25) if ((path as SVGGeometryElement).isPointInFill(new DOMPoint(180, row + dy))) covered++;
    return covered;
  }));
  expect(widths[0]).toBeGreaterThan(widths[1] * 1.5);
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await page.mouse.move(box.x + 40 * box.width / 512, box.y + 230 * box.height / 512); await page.mouse.down();
  await page.mouse.move(box.x + 200 * box.width / 512, box.y + 230 * box.height / 512, { steps: 20 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const alpha = () => page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(90, 230, 1, 1).data[3]);
  expect(await alpha()).toBeGreaterThan(0);
  await surface.press('Escape'); await page.mouse.up();
  expect(await alpha()).toBe(0);
  await expect(page.locator('#marks path')).toHaveCount(2);
});
