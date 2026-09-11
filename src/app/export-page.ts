import { sampleCreativeGifs } from './creative-elements-export';
import { mountSceneComposition } from '../shared/scene-composition';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toCanvas } from 'html-to-image';
import * as THREE from 'three';
import type { DesignDocument } from '../shared/schema';
import { renderSvg } from '../shared/render';
import { buildScene, disposeScene, animateScene } from '../shared/scene-runtime';
import { DocumentView, usesDom } from './document-view';
import { loadDocumentFonts } from '../shared/font-loading';

/** Render trusted components with browser layout before capture. Call dispose after capture. */
export async function mountExportPage(doc: DesignDocument, index = 0, time: number | undefined = undefined, offscreen = false) {
  doc = await sampleCreativeGifs(doc, time); time ??= 0;
  const page = doc.pages[index], host = document.createElement('section');
  host.style.cssText = `position:relative;width:${page.width}px;height:${page.height}px;overflow:hidden;flex:none;break-after:page`;
  // Offset an outer stage, never the captured root: html-to-image copies root
  // positioning into its SVG, which would move every pixel outside the image.
  const stage = offscreen ? document.createElement('div') : host;
  if (offscreen) {
    stage.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none';
    stage.setAttribute('aria-hidden', 'true');
    stage.inert = true;
    stage.append(host);
  }
  document.body.append(stage);
  let composition: ReturnType<typeof mountSceneComposition> | undefined;
  let root: ReturnType<typeof createRoot> | undefined;
  let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene | undefined, camera: THREE.PerspectiveCamera | undefined;
  try {
    await loadDocumentFonts(doc);
    if (doc.kind==='3d'||page.scene || page.nodes.some(n=>n.scene)) {
      const built = await buildScene(doc, index, time); scene = built.scene; camera = built.camera;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(page.width, page.height);
      host.append(renderer.domElement); composition = mountSceneComposition(host, doc, index, renderer, scene, built.camera); composition.draw(time);
    } else if (usesDom(page)) {
      root = createRoot(host); flushSync(() => root!.render(createElement(DocumentView, { doc, pageIndex: index, time })));
    } else host.innerHTML = renderSvg(doc, index, time);
    await document.fonts.ready;
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.decode()));
    const deadline=performance.now()+15000;
    while(host.querySelector('[data-character-ready="false"]')) {if(host.querySelector('[data-character-error]')||performance.now()>deadline)throw new Error('Character assets failed to load');await new Promise(resolve=>setTimeout(resolve,16));}
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { host, draw: (time: number) => { if (scene && renderer && camera) { animateScene(scene, doc, index, time); composition?.draw(time); } }, dispose: () => { composition?.dispose(); root?.unmount(); if (scene) disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); stage.remove(); } };
  } catch (error) { composition?.dispose(); root?.unmount(); if (scene) disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); stage.remove(); throw error; }
}
/** Paint scene canvases directly; WebKit can omit their cloned images inside foreignObject. */
export async function rasterizeExportPage(host: HTMLElement, width: number, height: number) {
  const options = { pixelRatio: 1, canvasWidth: width, canvasHeight: height, skipFonts: true };
  const layers = Array.from(host.querySelectorAll<HTMLElement>(':scope > [data-scene-layer]'));
  if (!layers.length) return toCanvas(host, options);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = getComputedStyle(host).backgroundColor;
  context.fillRect(0, 0, width, height);
  // Keep the same paint order as the editor, including 2D layers between 3D segments.
  for (const layer of layers) {
    const source = layer instanceof HTMLCanvasElement ? layer : await toCanvas(layer, options);
    context.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}
export async function captureExportPage(doc: DesignDocument, index = 0, time: number | undefined = undefined) {
  const mounted = await mountExportPage(doc, index, time);
  try { return await rasterizeExportPage(mounted.host, doc.pages[index].width, doc.pages[index].height); }
  finally { mounted.dispose(); }
}
