import { test, expect } from './authenticated-browser';
import { createDocument } from '../src/shared/catalog';
import type { Project } from '../src/shared/schema';
import type { Page } from '@playwright/test';
async function panel(page: Page, name: string) { const nav = page.locator('.mobile-editor-nav'); if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click(); }
async function setup(page: Page, origin: string) {
  const document = createDocument('slides', 'Editor interactions');
  document.theme.fonts = { heading: 'Georgia', body: 'Arial' };
  document.pages = [{ id: 'page', name: 'Page', width: 600, height: 400, background: '#17202a', nodes: [
    { id: 'alpha', type: 'text', name: 'Alpha', x: 35, y: 40, width: 220, height: 90, text: 'Original text', style: { fontFamily: '$heading', fontSize: 25, fontWeight: 700, fontStyle: 'italic', fill: '#fefefe', lineHeight: 1.4, letterSpacing: 1, textAlign: 'center' } },
    { id: 'beta', type: 'shape', name: 'Beta', x: 350, y: 60, width: 160, height: 80, style: { fill: '#d77654' } },
    { id: 'locked', type: 'shape', name: 'Locked', x: 35, y: 250, width: 130, height: 80, locked: true, style: { fill: '#446688' } },
  ] }];
  const response = await page.request.post('/api/projects', { headers: { Origin: origin }, data: { name: document.name, kind: document.kind, document } });
  expect(response.status()).toBe(201);
  const { project } = await response.json() as { project: Project };
  await page.goto(`/?project=${project.id}`);
  await expect(page.locator('.node-target')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  return project;
}
async function save(page: Page, id: string) {
  const request = page.waitForResponse(response => response.url().includes(`/api/projects/${id}/operations/`) && response.url().endsWith('/result') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await request).status()).toBe(200);
  return (await (await page.request.get(`/api/projects/${id}`)).json() as { project: Project }).project;
}
test('canvas Shift selection and layer checkboxes share batch actions with one undo', async ({ page, baseURL }) => {
  await setup(page, baseURL!);
  const alpha = page.getByRole('button', { name: 'Alpha, text', exact: true }), beta = page.getByRole('button', { name: 'Beta, shape', exact: true });
  await alpha.click(); await beta.click({ modifiers: ['Shift'] });
  await expect(page.locator('.node-target.selected')).toHaveCount(2);
  await beta.press('Shift+ArrowRight');
  await expect(alpha).toHaveCSS('left', '45px'); await expect(beta).toHaveCSS('left', '360px');
  await beta.press('Control+z'); await expect(alpha).toHaveCSS('left', '35px'); await expect(beta).toHaveCSS('left', '350px');
  await panel(page, 'Chat & layers'); await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Alpha for grouping' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Select Beta for grouping' }).uncheck();
  await page.getByRole('checkbox', { name: 'Select Beta for grouping' }).check();
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(page.locator('.node-target')).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Select Alpha for grouping' }).check();
  await panel(page, 'Canvas');
  const group = page.getByRole('button', { name: 'Group, group', exact: true });
  const initialBox = (await group.boundingBox())!;
  await group.click({ trial: true, position: { x: initialBox.width * .6, y: initialBox.height * .5 } });
  const groupBefore = await group.evaluate(element => parseFloat((element as HTMLElement).style.left));
  const alphaBefore = await alpha.evaluate(element => parseFloat((element as HTMLElement).style.left));
  const box = (await group.boundingBox())!;
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .8);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .7 + 12, box.y + box.height * .8 + 6); await page.mouse.up();
  const groupDelta = await group.evaluate((element, before) => parseFloat((element as HTMLElement).style.left) - before, groupBefore);
  const childDelta = await alpha.evaluate((element, before) => parseFloat((element as HTMLElement).style.left) - before, alphaBefore);
  expect(groupDelta, `group before=${groupBefore}; child before=${alphaBefore}; child delta=${childDelta}`).toBeGreaterThan(0); expect(childDelta).toBeCloseTo(groupDelta, 3);
  await page.keyboard.press('Control+z');
  await panel(page, 'Chat & layers');
  await page.getByRole('button', { name: 'Ungroup' , exact: true }).click();
  await expect(page.locator('.node-target')).toHaveCount(3);
  await panel(page, 'Canvas'); await page.locator('.canvas-viewport').focus();
  await page.keyboard.press('Control+d'); await expect(page.locator('.node-target')).toHaveCount(5);
  await page.keyboard.press('Delete'); await expect(page.locator('.node-target')).toHaveCount(3);
  await page.keyboard.press('Control+a'); await expect(page.locator('.node-target.selected')).toHaveCount(2);
  await page.keyboard.press('Delete'); await expect(page.locator('.node-target')).toHaveCount(1);
  const locked = page.getByRole('button', { name: 'Locked, shape', exact: true });
  await expect(locked).toBeVisible(); await locked.focus();
  await panel(page, 'Design'); await page.getByRole('button', { name: 'Unlock layer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock layer', exact: true })).toBeVisible();
});
test('inline draft preserves document typography, cancels cleanly and commits one undo step', async ({ page, baseURL }) => {
  const project = await setup(page, baseURL!);
  const alpha = page.getByRole('button', { name: 'Alpha, text', exact: true });
  await alpha.focus(); await alpha.press('Enter');
  const text = page.getByRole('textbox', { name: 'Edit selected text', exact: true });
  await expect(text).toBeFocused();
  await expect(text).toHaveCSS('font-family', 'Georgia'); await expect(text).toHaveCSS('font-weight', '700');
  await expect(text).toHaveCSS('font-style', 'italic'); await expect(text).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(text).toHaveCSS('width', '220px'); await expect(text).toHaveCSS('height', '90px');
  await expect(text).toHaveCSS('line-height', '35px'); await expect(text).toHaveCSS('text-align', 'center');
  await text.fill('Cancelled change'); await text.press('Escape');
  await expect(text).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('Enter'); await text.fill('Xin chào\nNew line'); await text.press('Control+Enter');
  await expect(text).toHaveCount(0); await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  const saved = await save(page, project.id);
  expect(saved.document.pages[0].nodes[0].text).toBe('Xin chào\nNew line');
  expect(saved.document.pages[0].nodes[0].style).toEqual(project.document.pages[0].nodes[0].style);
});
test('font preview combobox is keyboard accessible and custom font changes commit on blur', async ({ page, baseURL }) => {
  const project = await setup(page, baseURL!);
  await panel(page, 'Design'); await page.locator('.inspector .panel-tabs').getByRole('button', { name: 'Theme', exact: true }).click();
  const font = page.getByRole('combobox', { name: 'Heading font', exact: true });
  await font.click(); await font.fill('Georgia');
  const option = page.getByRole('option', { name: 'Georgia', exact: false });
  await expect(option).toHaveCSS('font-family', 'Georgia');
  await font.press('ArrowDown'); await expect(font).toHaveAttribute('aria-activedescendant', /-0$/); await font.press('Enter');
  await font.fill('Arial');
  await page.getByRole('combobox', { name: 'Body font', exact: true }).focus();
  const saved = await save(page, project.id); expect(saved.document.theme.fonts.heading).toBe('Arial');
  await expect(font).toHaveValue('Arial');
  await font.click(); await font.fill('Helvetica Neue');
  await expect(page.getByRole('listbox', { name: 'Heading font choices' }).getByRole('option')).toHaveCount(0);
  await font.press('ArrowDown'); await font.press('Enter');
  const custom = await save(page, project.id); expect(custom.document.theme.fonts.heading).toBe('Helvetica Neue');
  await panel(page, 'Canvas'); await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Editor shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Keyboard shortcuts', exact: true })).toBeFocused();
});

test('structured rotated text uses measured bounds and retains the canvas background', async ({ page, baseURL }, info) => {
  const document = createDocument('web', 'Nested text'); document.theme.fonts = { heading: 'Georgia', body: 'Arial' };
  document.pages = [{ id: 'nested', name: 'Nested', width: 600, height: 400, background: '#142b2d', nodes: [
    { id: 'frame', name: 'Frame', type: 'frame', x: 20, y: 20, width: 500, height: 300, rotation: 10, opacity: .8, layout: { mode: 'absolute' }, style: { fill: '#274d43' } },
    { id: 'text', name: 'Nested label', type: 'text', parentId: 'frame', x: 40, y: 50, width: 190, height: 80, rotation: 20, opacity: .7, text: 'Nested typography', style: { fontFamily: '$heading', fontSize: 22, fontWeight: 700, fill: '#ffffff', lineHeight: 1.3 } },
  ] }];
  const response = await page.request.post('/api/projects', { headers: { Origin: baseURL! }, data: { name: document.name, kind: document.kind, document } });
  expect(response.status()).toBe(201); const { project } = await response.json() as { project: Project };
  await page.goto(`/?project=${project.id}`); await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
  const target = page.getByRole('button', { name: 'Nested label, text', exact: true });
  await expect(target).toHaveCSS('transform', 'matrix(0.866025, 0.5, -0.5, 0.866025, 0, 0)');
  const geometry = await target.evaluate(element => { const style = (element as HTMLElement).style; return { left: style.left, top: style.top, width: style.width, height: style.height, transform: style.transform }; });
  await target.focus(); await target.press('Enter'); const editor = page.getByRole('textbox', { name: 'Edit selected text' });
  expect(await editor.evaluate(element => { const style = (element as HTMLElement).style; return { left: style.left, top: style.top, width: style.width, height: style.height, transform: style.transform }; })).toEqual(geometry);
  await expect(editor).toHaveCSS('opacity', '0.56'); await expect(editor).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('[data-design-node="text"]')).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await editor.fill('Preserved layout');
  await page.screenshot({ path: `plans/260909-0952-observability-editor/reports/inline-text-${info.project.name}.png` });
  await editor.press('Control+Enter'); const saved = await save(page, project.id);
  expect(saved.document.pages[0].nodes[1]).toEqual({ ...project.document.pages[0].nodes[1], text: 'Preserved layout' });
});
