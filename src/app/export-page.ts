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
export async function mountExportPage(doc: DesignDocument, index = 0, time = 0) {
  const page = doc.pages[index], host = document.createElement('section');
  host.style.cssText = `position:relative;width:${page.width}px;height:${page.height}px;overflow:hidden;flex:none;break-after:page`;
  document.body.append(host);
  let root: ReturnType<typeof createRoot> | undefined;
  let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene | undefined, camera: THREE.PerspectiveCamera | undefined;
  try {
    await loadDocumentFonts(doc);
    if ((page.scene || page.nodes.some(n => n.scene))&&!page.nodes.some(n=>n.character)) {
      const built = await buildScene(doc, index, time); scene = built.scene; camera = built.camera;
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(page.width, page.height);
      renderer.render(scene, built.camera); host.append(renderer.domElement);
    } else if (usesDom(page)) {
      root = createRoot(host); flushSync(() => root!.render(createElement(DocumentView, { doc, pageIndex: index, time })));
    } else host.innerHTML = renderSvg(doc, index, time);
    await document.fonts.ready;
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.decode()));
    const deadline=performance.now()+15000;
    while(host.querySelector('[data-character-ready="false"]')) {if(host.querySelector('[data-character-error]')||performance.now()>deadline)throw new Error('Character assets failed to load');await new Promise(resolve=>setTimeout(resolve,16));}
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { host, draw: (time: number) => { if (scene && renderer && camera) { animateScene(scene, doc, index, time); renderer.render(scene, camera); } }, dispose: () => { root?.unmount(); if (scene) disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); host.remove(); } };
  } catch (error) { root?.unmount(); if (scene) disposeScene(scene); renderer?.dispose(); renderer?.forceContextLoss(); host.remove(); throw error; }
}
export async function captureExportPage(doc: DesignDocument, index = 0, time = 0) {
  const mounted = await mountExportPage(doc, index, time);
  try { return await toCanvas(mounted.host, { pixelRatio: 1, width: doc.pages[index].width, height: doc.pages[index].height, skipFonts: true }); }
  finally { mounted.dispose(); }
}
