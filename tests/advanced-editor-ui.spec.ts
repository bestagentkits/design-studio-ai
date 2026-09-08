import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocument } from '../src/shared/catalog';
import type { DesignDocument, Project } from '../src/shared/schema';
import type { DesignSystem } from '../src/shared/design-systems';

async function setup(page: Page, baseURL: string, document: DesignDocument) {
  const headers = { Origin: new URL(baseURL).origin };
  expect((await page.request.post('/api/auth/register', { headers, data: { email: `advanced-${randomUUID()}@studio.test`, password: randomUUID() + randomUUID() } })).status()).toBe(201);
  const response = await page.request.post('/api/projects', { headers, data: { name: document.name, kind: document.kind, document } });
  expect(response.status()).toBe(201);
  const project = (await response.json() as { project: Project }).project;
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByRole('button', { name: 'Back to workspace' })).toBeVisible();
  return project;
}
async function panel(page: Page, info: TestInfo, name: 'Canvas' | 'Design' | 'Chat & layers') {
  if (info.project.name === 'mobile') await page.locator('.mobile-editor-nav').getByRole('button', { name, exact: true }).click();
}
async function layer(page: Page, info: TestInfo, name: string) {
  await panel(page, info, 'Chat & layers');
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('tree', { name: 'Layers' }).getByRole('button', { name, exact: true }).click();
}
async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/projects/${id}`); expect(response.status()).toBe(200);
  return (await response.json() as { project: Project }).project;
}
async function save(page: Page, id: string) {
  const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${id}/document`) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
}
async function prepare(page: Page, info: TestInfo) {
  await panel(page, info, 'Canvas'); await page.getByRole('checkbox', { name: 'Live', exact: true }).uncheck();
}

test('primitive converts to editable geometry, extrudes, unwraps and saves weighted bones and material', async ({ page, baseURL }, info) => {
  const doc = createDocument('3d', 'Editable rig'); doc.timeline = { duration: 3, fps: 10, tracks: [] };
  doc.pages[0].nodes = [{ id: 'cube', name: 'Study cube', type: 'model3d', x: 100, y: 100, width: 400, height: 400, data: { geometry: 'box' }, scene: { position: [0, 0, 0], scale: [1, 1, 1] } }];
  const project = await setup(page, baseURL!, doc);
  try {
    await prepare(page, info); await layer(page, info, 'Study cube'); await panel(page, info, 'Canvas');
    await expect(page.locator('.scene-view canvas')).toBeVisible(); await expect(page.locator('.scene-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mesh / UV / Rig', exact: true }).click();
    const mesh = page.locator('.mesh-tools');
    await mesh.getByRole('button', { name: 'Convert primitive to editable mesh' }).click();
    await expect(mesh.getByText('24 vertices · 12 triangles.', { exact: false })).toBeVisible();
    await mesh.getByRole('combobox', { name: 'Selection', exact: true }).selectOption('face');
    await mesh.getByRole('textbox', { name: 'Selected geometry indices' }).fill('0');
    await mesh.getByRole('button', { name: 'extrude faces', exact: true }).click();
    await expect(mesh.getByText('27 vertices · 18 triangles.', { exact: false })).toBeVisible();
    await mesh.getByRole('button', { name: 'Planar unwrap', exact: true }).click();
    await expect(mesh.getByRole('button', { name: 'Planar unwrap', exact: true })).toBeEnabled();
    await expect(mesh.locator('.uv-editor circle')).toHaveCount(27);
    await mesh.getByRole('button', { name: 'Add bone', exact: true }).click();
    await mesh.getByRole('spinbutton', { name: 'Bone rotation Z', exact: true }).fill('15');
    await mesh.getByRole('button', { name: 'Add bone', exact: true }).click();
    await mesh.getByRole('spinbutton', { name: 'Bone weight', exact: true }).fill('0.75');
    await mesh.getByRole('button', { name: 'Bind all vertices with weights' }).click();
    await expect(mesh.getByRole('button', { name: 'Subdivide whole mesh' })).toBeDisabled();
    await page.getByRole('button', { name: 'Mesh / UV / Rig', exact: true }).click();
    await page.getByRole('combobox', { name: 'Animation property' }).selectOption('scene.bones.0.rotation.z');
    await page.getByRole('button', { name: 'Add property keyframe' }).click();
    await page.getByRole('spinbutton', { name: 'Keyframe scene.bones.0.rotation.z', exact: true }).fill('45');
    await panel(page, info, 'Design');
    await page.getByRole('textbox', { name: 'Material color', exact: true }).fill('#e26242');
    await page.getByRole('checkbox', { name: 'Wireframe', exact: true }).check();
    await save(page, project.id);
    const saved = (await read(page, project.id)).document, scene = saved.pages[0].nodes[0].scene!;
    expect(scene.mesh!.positions).toHaveLength(81); expect(scene.mesh!.indices).toHaveLength(54);
    expect(scene.mesh!.uv).toHaveLength(54); expect(scene.mesh!.uv!.every(Number.isFinite)).toBe(true);
    expect(scene.bones!.map(bone => bone.parent)).toEqual([-1, 0]); expect(scene.bones![0].rotation).toEqual([0, 0, 15]);
    expect(scene.mesh!.skinIndices!.slice(0, 4)).toEqual([1, 0, 0, 0]); expect(scene.mesh!.skinWeights!.slice(0, 4)).toEqual([0.75, 0.25, 0, 0]);
    expect(scene.material).toMatchObject({ color: '#e26242', wireframe: true });
    expect(saved.timeline!.tracks[0].keyframes[0].values).toEqual({ 'scene.bones.0.rotation.z': 45 });
    await page.reload(); await layer(page, info, 'Study cube'); await panel(page, info, 'Design');
    await expect(page.getByRole('textbox', { name: 'Material color', exact: true })).toHaveValue('#e26242');
    await expect(page.getByRole('checkbox', { name: 'Wireframe', exact: true })).toBeChecked();
  } finally { await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } }); }
});

test('timeline authors and moves property keys, saves custom easing, respects locks and deletes keys', async ({ page, baseURL }, info) => {
  const doc = createDocument('video', 'Motion editing'); doc.timeline = { duration: 3, fps: 10, tracks: [] };
  doc.pages[0].nodes = [{ id: 'moving', name: 'Moving shape', type: 'shape', x: 50, y: 50, width: 100, height: 100, style: { fill: '#2563eb' } }];
  const project = await setup(page, baseURL!, doc);
  try {
    await prepare(page, info);
    const motion = page.getByRole('region', { name: 'Animation timeline', exact: true });
    await motion.getByRole('combobox', { name: 'Animation layer' }).selectOption('moving');
    await motion.getByRole('combobox', { name: 'Animation property' }).selectOption('x');
    await motion.getByRole('button', { name: 'Add property keyframe' }).click();
    await expect(motion.getByRole('spinbutton', { name: 'Keyframe x', exact: true })).toHaveValue('50');
    await page.getByRole('slider', { name: 'Timeline time', exact: true }).press('End');
    await motion.getByRole('button', { name: 'Add property keyframe' }).click();
    await motion.getByRole('spinbutton', { name: 'Keyframe x', exact: true }).fill('150');
    await motion.getByRole('spinbutton', { name: 'Keyframe time', exact: true }).fill('2');
    await motion.getByRole('button', { name: 'Moving shape x keyframe 2', exact: true }).press('ArrowLeft');
    await expect(motion.getByRole('spinbutton', { name: 'Keyframe time', exact: true })).toHaveValue('1.9');
    await motion.getByRole('combobox', { name: 'Keyframe easing' }).selectOption('custom');
    await motion.getByRole('spinbutton', { name: 'Bezier X1', exact: true }).fill('0.4');
    await motion.getByRole('button', { name: 'Lock Moving shape', exact: true }).click();
    await expect(motion.getByRole('spinbutton', { name: 'Keyframe x', exact: true })).toBeDisabled();
    await expect(motion.getByRole('button', { name: 'Delete selected keys' })).toBeDisabled();
    await save(page, project.id);
    const track = (await read(page, project.id)).document.timeline!.tracks[0];
    expect(track.locked).toBe(true); expect(track.keyframes).toEqual([{ time: 0, values: { x: 50 } }, { time: 1.9, values: { x: 150 }, easing: [0.4, 0.1, 0.25, 1] }]);
    await motion.getByRole('button', { name: 'Lock Moving shape', exact: true }).click();
    await motion.getByRole('button', { name: 'Delete selected keys' }).click(); await save(page, project.id);
    expect((await read(page, project.id)).document.timeline!.tracks[0].keyframes).toEqual([{ time: 0, values: { x: 50 } }]);
    await page.reload(); await panel(page, info, 'Canvas');
    await expect(page.getByRole('button', { name: 'Moving shape x keyframe 0', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Moving shape x keyframe 1.9', exact: true })).toHaveCount(0);
  } finally { await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } }); }
});

test('design-system library creates versions, applies a historical version and inserts a saved component', async ({ page, baseURL }, info) => {
  const project = await setup(page, baseURL!, createDocument('web', 'Library authoring')); let systemId: string | undefined;
  const openLibrary = async () => { await panel(page, info, 'Design'); await page.locator('.inspector').getByRole('button', { name: 'Theme', exact: true }).click(); await page.getByRole('button', { name: 'Manage design systems' }).click(); };
  try {
    await prepare(page, info); await openLibrary();
    const modal = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Design systems', exact: true }) });
    await modal.getByRole('textbox', { name: 'Library name', exact: true }).fill('Browser library');
    await modal.getByRole('combobox', { name: 'Component system', exact: true }).selectOption('antd');
    await modal.getByRole('textbox', { name: 'accent token', exact: true }).fill('#ff4422');
    await modal.getByRole('combobox', { name: 'New library component' }).selectOption('Button');
    await modal.getByRole('textbox', { name: 'Component name 1', exact: true }).fill('Main action');
    const created = page.waitForResponse(r => r.url().endsWith('/api/design-systems') && r.request().method() === 'POST');
    await modal.getByRole('button', { name: 'Create library', exact: true }).click(); expect((await created).status()).toBe(201);
    const system = (await (await created).json() as { system: DesignSystem }).system; systemId = system.id;
    await expect(modal.getByRole('combobox', { name: 'Saved version', exact: true })).toHaveValue('1');
    await modal.getByRole('textbox', { name: 'accent token', exact: true }).fill('#2244ff');
    await modal.getByRole('button', { name: 'Save new version' }).click();
    await expect(modal.getByRole('combobox', { name: 'Saved version', exact: true })).toHaveValue('2');
    await modal.getByRole('combobox', { name: 'Saved version', exact: true }).selectOption('1');
    await expect(modal.getByRole('textbox', { name: 'accent token', exact: true })).toHaveValue('#ff4422');
    await modal.getByRole('button', { name: 'Apply saved version' }).click(); await save(page, project.id);
    const applied = (await read(page, project.id)).document;
    expect(applied.designSystem).toMatchObject({ id: systemId, version: 1 }); expect(applied.theme.colors.accent).toBe('#ff4422');
    await openLibrary();
    await modal.getByRole('navigation', { name: 'Design system library' }).getByRole('button', { name: /Browser library/ }).click();
    await modal.getByRole('button', { name: 'Insert', exact: true }).click(); await save(page, project.id);
    const inserted = (await read(page, project.id)).document.pages[0].nodes.find(node => node.name === 'Main action')!;
    expect(inserted.component).toMatchObject({ name: 'Button', system: 'antd' }); expect(inserted.id).not.toBe(system.definition.components[0].id);
    await page.reload(); await panel(page, info, 'Design'); await page.locator('.inspector').getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(page.getByText('Browser library · version 1', { exact: true })).toBeVisible();
  } finally {
    if (systemId) await page.request.delete(`/api/design-systems/${systemId}`, { headers: { Origin: baseURL! } });
    await page.request.delete(`/api/projects/${project.id}`, { headers: { Origin: baseURL! } });
  }
});
