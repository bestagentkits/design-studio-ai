import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('artifacts/creative-probe.html')).href);
  const box = await page.locator('#surface').boundingBox();
  async function stroke(y, height, delay, count = 60) {
    await page.mouse.move(box.x + 55, box.y + y); await page.mouse.down();
    for (let i = 1; i <= count; i++) {
      await page.mouse.move(box.x + 55 + i * 370 / count, box.y + y + Math.sin(i / count * Math.PI * 3) * height);
      if (delay) await page.waitForTimeout(delay);
    }
    await page.mouse.up();
  }
  await stroke(90, 28, 20, 80); await stroke(165, 28, 0, 18);
  await page.getByRole('button', { name: 'Paint', exact: true }).click();
  await page.getByRole('button', { name: 'Color #be563e' }).click(); await stroke(270, 24, 8);
  await page.selectOption('#preset', 'wash'); await page.getByRole('button', { name: 'Color #4e806f' }).click();
  await page.locator('#size').fill('72'); await stroke(360, 25, 8);
  await page.selectOption('#preset', 'dry'); await page.getByRole('button', { name: 'Color #ce994b' }).click(); await stroke(427, 18, 8);
  await page.mouse.move(30, 30); await page.screenshot({ path: 'artifacts/drawing-quality.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/drawing-quality-mobile.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Actual mouse input rendered; Chromium ${browser.version()}; no page errors. Saved desktop/mobile captures.`);
} finally { await browser.close(); }
