// Regenerate committed PNG/ICO assets after editing the SVG sources.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const asset = name => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [source, output, width, height] of [
    ['social-card.svg', 'social-card.png', 1200, 630],
    ['favicon.svg', 'apple-touch-icon.png', 180, 180],
    ['favicon.svg', 'favicon.ico', 48, 48],
  ]) {
    await page.setViewportSize({ width, height });
    const svg = (await readFile(asset(source), 'utf8')).replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`);
    await page.setContent(`<style>html,body{margin:0;overflow:hidden}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground: true });
    if (output.endsWith('.ico')) {
      const header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
      header[6] = width; header[7] = height;
      header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
      await writeFile(asset(output), Buffer.concat([header, png]));
    } else await writeFile(asset(output), png);
  }
} finally { await browser.close(); }
