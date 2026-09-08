import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import JSZip from 'jszip';
import { chromium } from '@playwright/test';
import { createDocument } from '../src/shared/catalog';
import { createReactArchive } from '../src/shared/react-export';

const run = promisify(execFile);
test('structured pages render actual controls and rasterize them in PowerPoint', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: await readFile('public/studio-renderer.js', 'utf8') });
    const doc = createDocument('web', 'Component export');
    await page.evaluate(doc => (globalThis as any).studioRenderer.present(doc), doc);
    assert.ok(await page.locator('button').count());
    const layout = await page.locator('.studio-document').evaluate(el => getComputedStyle(el).display);
    assert.equal(layout, 'flex');
    const png = await page.screenshot(); assert.ok(png.length > 5000);
    const encoded = await page.evaluate(doc => (globalThis as any).studioRenderer.pptx(doc), doc);
    const zip = await JSZip.loadAsync(encoded, { base64: true });
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string'); assert.ok(xml.includes('<p:pic>'));
    const image = Object.keys(zip.files).find(path => /^ppt\/media\/.*\.png$/.test(path)); assert.ok(image);
    assert.ok((await zip.file(image)!.async('uint8array')).length > 5000);
  } finally { await browser.close(); }
});

test('React source archive builds a real prototype with bundled local assets', { timeout: 60000 }, async () => {
  const doc = createDocument('web', 'Source prototype');
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9R8AAAAASUVORK5CYII=';
  doc.assets.push({ id: 'logo', name: 'Logo', type: 'image', mimeType: 'image/png', url: image });
  const runtime = JSON.parse(await readFile('public/studio-react-runtime.json', 'utf8'));
  const zip = await JSZip.loadAsync(await createReactArchive(doc, runtime));
  assert.ok(zip.file('src/app/design-component.tsx'));
  assert.ok(zip.file('public/assets/media-1.png'));
  const exported = JSON.parse(await zip.file('document.json')!.async('string'));
  assert.equal(exported.assets[0].url, '/assets/media-1.png');
  const directory = await mkdtemp(join(tmpdir(), 'studio-react-export-'));
  try {
    for (const entry of Object.values(zip.files)) if (!entry.dir) { const target = join(directory, entry.name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await entry.async('uint8array')); }
    await symlink(resolve('node_modules'), join(directory, 'node_modules'));
    await run(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], { cwd: directory, timeout: 45000 });
    assert.ok((await readFile(join(directory, 'dist/index.html'), 'utf8')).includes('/assets/index-'));
    assert.ok((await readdir(join(directory, 'dist/assets'))).some(name => name.endsWith('.js')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('browser GLB and glTF exports contain real mesh geometry and animation tracks', { timeout: 60000 }, async () => {
  const { build } = await import('esbuild');
  const bundle = await build({ stdin: { contents: "import { exportScene } from './src/shared/scene-runtime'; globalThis.exportStudioScene = exportScene;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const doc = createDocument('3d', 'Animated cube'), node = doc.pages[0].nodes.find(n => n.type === 'model3d')!;
    node.scene = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    doc.timeline = { duration: 1, fps: 24, tracks: [{ id: 'spin', nodeId: node.id, keyframes: [{ time: 0, values: { 'scene.rotation.y': 0 } }, { time: 1, values: { 'scene.rotation.y': 90 } }] }] };
    const binary = await page.evaluate(async doc => Array.from(new Uint8Array(await (globalThis as any).exportStudioScene(doc, 0, true))), doc);
    const bytes = Buffer.from(binary); assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const content = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(content.meshes.length); assert.ok(content.animations[0].channels.length);
    const gltf = await page.evaluate(doc => (globalThis as any).exportStudioScene(doc, 0, false), doc);
    assert.ok(gltf.buffers[0].uri.startsWith('data:')); assert.ok(gltf.meshes[0].primitives.length);
  } finally { await browser.close(); }
});

test('exported skinned scene roundtrips material and animated pose through GLTFLoader', { timeout: 60000 }, async () => {
  const { build } = await import('esbuild');
  const bundle = await build({ stdin: { contents: `
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { buildScene, exportScene, disposeScene } from './src/shared/scene-runtime';
    globalThis.roundtripScene = async (doc, binary) => {
      const source = await buildScene(doc, 0, .5);
      const encoded = await exportScene(doc, 0, binary);
      const loaded = await new GLTFLoader().parseAsync(binary ? encoded : JSON.stringify(encoded), '');
      const mixer = new THREE.AnimationMixer(loaded.scene); mixer.clipAction(loaded.animations[0]).play(); mixer.setTime(.5);
      const sample = scene => {
        scene.updateMatrixWorld(true); const mesh = scene.getObjectByName('rigged');
        const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0);
        mesh.applyBoneTransform(0, vertex); mesh.localToWorld(vertex);
        return { vertex: vertex.toArray(), color: mesh.material.color.getHexString(), roughness: mesh.material.roughness, metalness: mesh.material.metalness, joints: mesh.skeleton.bones.length };
      };
      try { return { source: sample(source.scene), loaded: sample(loaded.scene), clips: loaded.animations.length }; }
      finally { mixer.stopAllAction(); disposeScene(source.scene); disposeScene(loaded.scene); }
    };`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<html><body></body></html>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const doc = createDocument('3d', 'Rigged export');
    doc.pages[0].nodes = [{ id: 'rigged', type: 'model3d', name: 'Rigged triangle', x: 0, y: 0, width: 400, height: 400, scene: {
      position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material: { color: '#ff0000', metalness: .3, roughness: .7 },
      mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], skinIndices: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], skinWeights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
      bones: [{ name: 'Root', parent: -1, position: [0, 0, 0] }],
    } }];
    doc.timeline = { duration: 1, fps: 24, tracks: [{ id: 'bone-move', nodeId: 'rigged', keyframes: [{ time: 0, values: { 'scene.bones.0.position.y': 1 } }, { time: 1, values: { 'scene.bones.0.position.y': 2 } }] }] };
    for (const binary of [true, false]) {
      const result = await page.evaluate(({ doc, binary }) => (globalThis as any).roundtripScene(doc, binary), { doc, binary });
      assert.equal(result.clips, 1); assert.equal(result.loaded.joints, 1); assert.equal(result.loaded.color, 'ff0000');
      assert.ok(Math.abs(result.loaded.roughness - .7) < .00001); assert.ok(Math.abs(result.loaded.metalness - .3) < .00001);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(result.loaded.vertex[i] - result.source.vertex[i]) < .0001, `${binary ? 'GLB' : 'glTF'} pose differs: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(result.source.vertex[1] - 1.5) < .0001, 'Animation must move away from the unanimated bind pose.');
    }
  } finally { await browser.close(); }
});

test('DOM measurements preserve layout boxes and align rotated overlays at pivots and animated nested parents', { timeout: 60000 }, async () => {
  const { build } = await import('esbuild');
  const bundle = await build({ stdin: { contents: `
    import { createElement } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import { DocumentView } from './src/app/document-view';
    const host = document.createElement('div'); host.style.cssText = 'position:relative;width:800px;transform:scale(.65);transform-origin:0 0'; document.body.append(host);
    const content = document.createElement('div'); host.append(content); const root = createRoot(content);
    const onBounds = nodes => globalThis.measuredLayout = nodes;
    const onOverlayBounds = nodes => globalThis.measuredOverlay = nodes;
    globalThis.measureDocument = (doc, time) => { globalThis.sourceDocument ??= doc; flushSync(() => root.render(createElement(DocumentView, { doc: globalThis.sourceDocument, time, onBounds, onOverlayBounds }))); };
    globalThis.compareOverlays = () => globalThis.measuredOverlay.filter(n => n.visible).map(n => {
      const actual = host.querySelector('[data-design-node="' + n.id + '"]');
      const overlay = document.createElement('div'); Object.assign(overlay.style, { position: 'absolute', left: n.x + 'px', top: n.y + 'px', width: n.width + 'px', height: n.height + 'px', transform: 'rotate(' + n.rotation + 'deg)', transformOrigin: ((n.pivot?.[0] ?? .5) * 100) + '% ' + ((n.pivot?.[1] ?? .5) * 100) + '%' });
      host.append(overlay); const a = actual.getBoundingClientRect(), b = overlay.getBoundingClientRect();
      const differences = ['left', 'top', 'right', 'bottom'].map(k => Math.abs(a[k] - b[k])); overlay.remove(); return { id: n.id, differences, rotation: n.rotation };
    });`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<html><body style="margin:0"></body></html>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const doc = createDocument('web', 'Measured transforms'); doc.pages[0].width = 800; doc.pages[0].height = 600; doc.pages[0].layout = { mode: 'absolute' };
    doc.pages[0].nodes = [
      { id: 'standalone', name: 'Custom pivot', type: 'shape', x: 60, y: 40, width: 120, height: 80, rotation: 45, pivot: [0, 1] },
      { id: 'parent', name: 'Rotated parent', type: 'frame', x: 300, y: 200, width: 250, height: 180, rotation: 30, pivot: [.25, .8], layout: { mode: 'absolute' } },
      { id: 'child', name: 'Rotated child', type: 'shape', parentId: 'parent', x: 20, y: 40, width: 100, height: 60, rotation: -20, pivot: [.1, .9] },
    ];
    doc.timeline = { duration: 1, fps: 24, tracks: [{ id: 'child-move', nodeId: 'child', keyframes: [{ time: 0, values: { x: 20, rotation: -20 } }, { time: 1, values: { x: 60, rotation: 20 } }] }] };
    for (const time of [0, .5, 1]) {
      await page.evaluate(({ doc, time }) => (globalThis as any).measureDocument(doc, time), { doc, time });
      const result = await page.evaluate(() => ({ layout: (globalThis as any).measuredLayout, overlay: (globalThis as any).compareOverlays(), raw: (globalThis as any).sourceDocument.pages[0].nodes.find((n: { id: string }) => n.id === 'child') }));
      assert.equal(result.raw.x, 20); assert.equal(result.raw.rotation, -20);
      const child = result.layout.find((n: { id: string }) => n.id === 'child');
      assert.ok(Math.abs(child.x - (320 + time * 40)) < .001); assert.ok(Math.abs(child.y - 240) < .001);
      const standalone = result.layout.find((n: { id: string }) => n.id === 'standalone');
      assert.ok(Math.abs(standalone.x - 60) < .001); assert.ok(Math.abs(standalone.y - 40) < .001);
      assert.equal(result.overlay.find((n: { id: string }) => n.id === 'child').rotation, 10 + time * 40);
      // Chromium quantizes positioned CSS boxes to 1/64 px; nested rotations remain subpixel-aligned.
      for (const measured of result.overlay) assert.ok(measured.differences.every((delta: number) => delta < .03), `Overlay diverged at ${time}: ${JSON.stringify(measured)}`);
    }
    const original = doc.pages[0].nodes.find(n => n.id === 'child')!; assert.equal(original.x, 20); assert.equal(original.rotation, -20);
  } finally { await browser.close(); }
});
