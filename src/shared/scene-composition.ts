import * as THREE from 'three';
import type { DesignDocument } from './schema';
import { interpolateNode, renderSvg, resolveColor } from './render';
import { resolveLayout } from './layout';

/** One WebGL context paints transparent scene segments between ordered 2D layers. */
export function mountSceneComposition(host: HTMLElement, doc: DesignDocument, index: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const page = doc.pages[index], layers: { ids: Set<string>; canvas?: HTMLCanvasElement; svg?: HTMLDivElement }[] = [];
  const nodes = resolveLayout(page).nodes.filter(n => n.type !== 'group');
  for (const node of nodes) {
    const model = node.type === 'model3d';
    let layer = layers.at(-1);
    if (!layer || Boolean(layer.canvas) !== model) {
      const element = document.createElement(model ? 'canvas' : 'div');
      element.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      element.dataset.sceneLayer = model ? '3d' : '2d';
      host.append(element);
      layer = { ids: new Set(), ...(model ? { canvas: element as HTMLCanvasElement } : { svg: element as HTMLDivElement }) }; layers.push(layer);
    }
    layer.ids.add(node.id);
  }
  host.style.background = resolveColor(page.background, doc.theme);
  const original = renderer.domElement.style.cssText;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0';
  renderer.setClearColor(0x000000, 0); scene.background = null;
  const models: THREE.Object3D[] = [];
  scene.traverse(object => { if (object.userData.nodeId && page.nodes.some(n => n.id === object.userData.nodeId && n.type === 'model3d') && object.parent?.userData.nodeId !== object.userData.nodeId) models.push(object); });
  const helpers = scene.children.filter(object => object.userData.compositionBackground || object.userData.compositionNode);
  let lastTime = -1;
  const draw = (time = 0) => {
    // drawImage rejects a zero-sized source and would terminate the animation loop.
    if (!renderer.domElement.width || !renderer.domElement.height) return;
    const visible = models.map(object => object.visible), helperVisible = helpers.map(object => object.visible);
    let firstSceneLayer = true;
    try {
      for (const layer of layers) {
        if (layer.canvas) {
          models.forEach((object, i) => { object.visible = visible[i] && layer.ids.has(object.userData.nodeId); });
          helpers.forEach((object, i) => { object.visible = helperVisible[i] && (object.userData.compositionBackground ? firstSceneLayer : layer.ids.has(object.userData.compositionNode)); });
          firstSceneLayer = false;
          renderer.render(scene, camera);
          const canvas = layer.canvas, source = renderer.domElement;
          if (canvas.width !== source.width || canvas.height !== source.height) { canvas.width = source.width; canvas.height = source.height; }
          const context = canvas.getContext('2d')!; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0);
        } else if (time !== lastTime) {
          // Preserve parents for layout, hiding only their paint in each segment.
          const markup = renderSvg(doc, index, time);
          layer.svg!.innerHTML = markup;
          const svg = layer.svg!.firstElementChild as SVGSVGElement;
          svg.style.cssText = 'display:block;width:100%;height:100%';
          svg.querySelector(':scope > rect')?.remove();
          for (const element of svg.querySelectorAll<SVGGElement>('[data-node-id]')) if (!layer.ids.has(element.dataset.nodeId!)) element.remove();
        }
      }
    } finally { models.forEach((object, i) => { object.visible = visible[i]; }); helpers.forEach((object, i) => { object.visible = helperVisible[i]; }); }
    lastTime = time;
  };
  const pickHit = (hits: THREE.Intersection[]) => {
    const rank = (id: string) => layers.findIndex(layer => layer.ids.has(id));
    return hits.filter(hit => {
      if (!(hit.object instanceof THREE.Mesh)) return false;
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) if (!object.visible) return false;
      return rank(hit.object.userData.nodeId) >= 0;
    }).sort((a, b) => rank(b.object.userData.nodeId) - rank(a.object.userData.nodeId) || a.distance - b.distance)[0];
  };
  const pickOverlay = (x: number, y: number, modelId?: string) => {
    const box = host.getBoundingClientRect(), px = (x - box.left) / box.width * page.width, py = (y - box.top) / box.height * page.height;
    const ordered = resolveLayout({ ...page, nodes: page.nodes.map(n => interpolateNode(n, doc, Math.max(0, lastTime))) }).nodes;
    const modelIndex = ordered.findIndex(n => n.id === modelId);
    return ordered.slice(modelIndex + 1).reverse().find(n => n.type !== 'model3d' && n.type !== 'group' && n.visible !== false && (n.opacity ?? 1) > 0 && px >= n.x && px <= n.x + n.width && py >= n.y && py <= n.y + n.height)?.id;
  };
  return { draw, pickHit, pickOverlay, dispose: () => { for (const layer of layers) (layer.canvas ?? layer.svg)?.remove(); renderer.domElement.style.cssText = original; } };
}
