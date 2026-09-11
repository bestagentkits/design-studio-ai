import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { gif } from './helpers/gif-fixture';

let script: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: "import { mountGifProbe } from './scripts/board-gif-probe'; mountGifProbe(document.querySelector('main'), document.querySelector('#surface'));", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife',
  });
  script = result.outputFiles[0].text;
});

test('invalid GIF time is normalized with feedback and playback recovers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><main><div id="surface"><svg></svg></div></main></body></html>');
  await page.addScriptTag({ content: script });
  await page.getByLabel('GIF files (up to three)').setInputFiles({ name: 'motion.gif', mimeType: 'image/gif', buffer: Buffer.from(gif(0)) });
  await expect(page.locator('output')).toHaveText('1 GIFs loaded locally');
  const time = page.getByLabel('GIF time (ms)');
  for (const [input, normalized] of [['-1', '0'], ['60001', '60000'], ['', '0']]) {
    await time.fill(input);
    await expect(time).toHaveValue(normalized);
    await expect(page.locator('output')).toContainText('Invalid GIF time');
    await page.getByRole('button', { name: 'Play GIFs', exact: true }).click();
    await expect.poll(() => time.inputValue()).not.toBe(normalized);
    await expect(page.getByRole('button', { name: 'Pause GIFs', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause GIFs', exact: true }).click();
  }
  // A script/autofill can alter the input without firing input; Play must also normalize.
  await time.evaluate((input: HTMLInputElement) => { input.value = '1e309'; });
  await page.getByRole('button', { name: 'Play GIFs', exact: true }).click();
  await expect(page.locator('output')).toContainText('Invalid GIF time');
  await expect.poll(async () => Number(await time.inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause GIFs', exact: true }).click();
  await time.fill('20');
  const pixels = await page.getByLabel('GIF 1', { exact: true }).evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(0, 0, 2, 1).data]);
  expect(pixels).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  expect(errors).toEqual([]);
});
