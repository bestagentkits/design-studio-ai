import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { gif } from './helpers/gif-fixture';

async function newBoard(page: Page, baseURL: string) {
  const signup = await page.request.post('/api/auth/register', { headers: { Origin: baseURL }, data: { email: `board-${randomUUID()}@studio.test`, password: randomUUID() + randomUUID(), name: 'Board verification' } });
  expect(signup.status()).toBe(201);
  await page.goto('/'); await page.getByRole('button', { name: 'New Board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Board workflow');
  await page.getByRole('button', { name: 'Start from template', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open creative board', exact: true })).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get('project')!; expect(projectId).toBeTruthy();
  await expect(page.getByRole('dialog', { name: 'Creative board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close creative board', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Open creative board', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Creative board', exact: true })).toBeVisible(); return projectId;
}
async function saveBoard(page: Page, id: string, predicate: (doc: any) => boolean) {
  await page.getByRole('button', { name: 'Close creative board', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => predicate((await (await page.request.get(`/api/projects/${id}`)).json()).project.document)).toBe(true);
  return (await (await page.request.get(`/api/projects/${id}`)).json()).project.document;
}

test('New Board keeps searchable Elements, keyboard transforms, order and diagram layouts after reopening', async ({ page, baseURL }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const id = await newBoard(page, baseURL!);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  await page.getByRole('button', { name: 'elements mode', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search elements' }).fill('award');
  await page.getByRole('button', { name: 'Celebration star', exact: true }).click();
  await expect(page.getByLabel('Element x', { exact: true })).toHaveValue('80');
  await page.getByLabel('Sticker color', { exact: true }).fill('#22aa66');
  await page.getByRole('button', { name: 'Recolor selected sticker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recolor selected sticker', exact: true })).toBeEnabled();
  await canvas.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Element x', { exact: true })).toHaveValue('81');
  await page.getByRole('searchbox', { name: 'Search elements' }).fill('👍');
  await page.getByLabel('Hand variant').selectOption('2');
  await page.getByRole('button', { name: 'Thumbs up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Elements library' })).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Arrange selection').selectOption('back');
  await canvas.focus(); await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByLabel('Element y', { exact: true })).toHaveValue('90');
  await canvas.click({ position: { x: 8, y: 8 } });
  await page.getByRole('button', { name: 'diagram mode', exact: true }).click();
  for (const family of ['flowchart', 'architecture', 'user-flow', 'mind-map']) {
    await page.getByLabel('Diagram family').selectOption(family);
    await page.getByRole('button', { name: `Insert ${family} example`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'layered layout', exact: true }).click();
  const saved = await saveBoard(page, id, doc => doc.boards?.[0]?.elements.filter((e: any) => e.diagram).length === 19);
  const elements = saved.boards[0].elements;
  expect(elements.find((e: any) => e.type === 'emoji').unicode).toBe('👍🏼');
  expect(elements.find((e: any) => e.type === 'sticker').attribution).toContain('MIT');
  expect(elements.findIndex((e: any) => e.type === 'emoji')).toBeLessThan(elements.findIndex((e: any) => e.type === 'sticker'));
  expect(new Set(elements.filter((e: any) => e.diagram).map((e: any) => e.diagram.family)).size).toBe(4);
  expect(elements.filter((e: any) => e.type === 'connector').every((e: any) => e.start.binding && e.end.binding)).toBe(true);
  await page.reload(); await expect(page.getByRole('dialog', { name: 'Creative board', exact: true })).toBeVisible();
  await expect(canvas.locator('[data-board-element]')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('owned GIF stays paused, plays real frames, saves selected poster and imports safe SVG as PNG', async ({ page, baseURL }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const id = await newBoard(page, baseURL!);
  await page.getByRole('button', { name: 'elements mode', exact: true }).click();
  const upload = page.getByLabel('Upload image or GIF', { exact: true });
  await upload.setInputFiles({ name: 'motion.gif', mimeType: 'image/gif', buffer: Buffer.from(gif(0)) });
  await expect(page.getByRole('button', { name: 'Play GIF', exact: true })).toBeVisible();
  const gifCanvas = page.getByRole('dialog', { name: 'Creative board', exact: true }).getByLabel('motion.gif', { exact: true });
  await expect.poll(() => gifCanvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(2);
  await page.getByLabel('Poster time (ms)', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Set GIF poster', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set GIF poster', exact: true })).toBeEnabled();
  const pixels = () => gifCanvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 2, 1).data));
  await expect.poll(pixels).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Play GIF', exact: true }).click();
  await expect.poll(pixels).not.toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  await page.getByRole('button', { name: 'Pause GIF', exact: true }).click();
  const paused = await pixels();
  await gifCanvas.evaluate(() => new Promise<void>(resolve => { let ticks = 0; const next = () => ++ticks === 12 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next); }));
  expect(await pixels()).toEqual(paused);
  await page.getByLabel('Loop GIF', { exact: true }).uncheck();
  await upload.setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="https://example.com/tracker.png"/></svg>') });
  await expect(page.getByRole('alert')).toContainText('Unsupported SVG element');
  await upload.setInputFiles({ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#ee4455"/></svg>') });
  await expect(page.getByRole('status').filter({ hasText: 'SVG imported as a PNG' })).toBeVisible();
  const saved = await saveBoard(page, id, doc => doc.boards?.[0]?.elements.some((e: any) => e.name === 'vector.png'));
  const animation = saved.boards[0].elements.find((e: any) => e.type === 'gif');
  expect(animation.playing).toBe(false); expect(animation.loop).toBe(false); expect(animation.posterTime).toBe(20);
  expect(saved.assets.find((a: any) => a.id === animation.assetId).mimeType).toBe('image/gif');
  expect(saved.assets.find((a: any) => a.id === animation.posterAssetId).mimeType).toBe('image/png');
  const image = saved.boards[0].elements.find((e: any) => e.name === 'vector.png');
  expect(image.width / image.height).toBe(2); expect(saved.assets.find((a: any) => a.id === image.assetId).mimeType).toBe('image/png');
  await page.reload(); await expect(page.getByRole('dialog', { name: 'Creative board', exact: true })).toBeVisible();
  await expect.poll(() => gifCanvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(2);
  const reopened = await pixels(); await gifCanvas.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); expect(await pixels()).toEqual(reopened);
  expect(errors).toEqual([]);
});

test('unsaved Board draft survives repeated reload and Save Board persists the restored stroke', async ({ page, baseURL }) => {
  const id = await newBoard(page, baseURL!);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 100, { steps: 20 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => { const request = indexedDB.open('design-studio-board-drafts', 1); request.onsuccess = () => { const db = request.result, read = db.transaction('drafts').objectStore('drafts').count(); read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => reject(read.error); }; request.onerror = () => reject(request.error); }))).toBe(1);
  page.on('dialog', dialog => dialog.accept());
  await page.reload(); await expect(page.getByRole('button', { name: 'Restore draft', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save Board', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).project.document.boards[0].elements.filter((e: any) => e.type === 'stroke').length).toBe(1);
  await page.reload(); await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore draft', exact: true })).toHaveCount(0);
});
