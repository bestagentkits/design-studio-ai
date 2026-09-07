import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import PptxGenJS from 'pptxgenjs';
import { interpolateNode, renderHtml, renderSvg, resolveColor, resolveFont } from '../src/shared/render';
import type { DesignDocument, DesignNode } from '../src/shared/schema';

async function imageOf(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { const image = new Image(); image.src = url; await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
}
async function prepare(input: DesignDocument) {
  const doc = structuredClone(input);
  for (const page of doc.pages) for (const node of page.nodes) {
    if (node.visible === false) continue;
    if (node.type === 'image' && node.src && !node.src.startsWith('data:')) {
      const response = await fetch(node.src, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Cannot load ${node.name}; import the image into this project.`);
      const blob = await response.blob();
      node.src = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
    }
    if (node.type !== 'model3d') continue;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(node.width, node.height); renderer.setPixelRatio(1);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, node.width / node.height, 0.1, 100);
    camera.position.set(0, 0.7, 5); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7190, 2.5)); const key = new THREE.DirectionalLight(0xffffff, 4); key.position.set(3, 4, 5); scene.add(key);
    let object: THREE.Object3D;
    if (node.src) {
      const gltf = await new GLTFLoader().loadAsync(node.src); object = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(object), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      object.position.sub(center); const scale = 2.5 / Math.max(size.x, size.y, size.z, 0.01); object.scale.setScalar(scale);
    } else {
      const geometries: Record<string, () => THREE.BufferGeometry> = { box: () => new THREE.BoxGeometry(1.6, 1.6, 1.6), sphere: () => new THREE.SphereGeometry(1, 40, 32), torus: () => new THREE.TorusGeometry(0.8, 0.3, 32, 64), torusKnot: () => new THREE.TorusKnotGeometry(0.7, 0.23, 100, 20), cylinder: () => new THREE.CylinderGeometry(0.7, 0.7, 1.8, 48), cone: () => new THREE.ConeGeometry(1, 1.7, 48) };
      const geometry = (geometries[String(node.data?.geometry)] ?? geometries.torusKnot)();
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: resolveColor(node.style?.fill ?? node.data?.color ?? '$accent', doc.theme), metalness: Number(node.data?.metalness ?? 0.25), roughness: Number(node.data?.roughness ?? 0.3) }));
    }
    const rotation = [Number(node.data?.rotationX ?? 0) * Math.PI / 180, Number(node.data?.rotationY ?? 0) * Math.PI / 180, 0];
    object.rotation.set(...rotation.slice(0, 3).map(Number) as [number, number, number]); scene.add(object); renderer.render(scene, camera);
    node.src = renderer.domElement.toDataURL('image/png'); node.type = 'image'; node.style = { ...node.style, objectFit: 'contain' };
    object.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose(); } }); renderer.dispose(); renderer.forceContextLoss();
  }
  return doc;
}
async function present(input: DesignDocument, pageIndex = 0, all = false) {
  const doc = await prepare(all ? input : { ...input, pages: [input.pages[pageIndex]] });
  document.body.innerHTML = all ? renderHtml(doc).split('<body>')[1].split('</body>')[0] : renderSvg(doc, 0);
  document.body.style.cssText = 'margin:0;background:transparent';
  const style = document.createElement('style'); style.textContent = `svg{display:block;max-width:100%;height:auto}section{position:relative;break-after:page;margin:0} @page{size:${doc.pages[0].width}px ${doc.pages[0].height}px;margin:0}`; document.head.append(style);
  await document.fonts.ready;
  return true;
}
async function pptx(input: DesignDocument) {
  const doc = await prepare(input), deck = new PptxGenJS(), first = doc.pages[0];
  deck.defineLayout({ name: 'STUDIO', width: first.width / 96, height: first.height / 96 }); deck.layout = 'STUDIO'; deck.title = doc.name;
  for (const page of doc.pages) {
    const slide = deck.addSlide(); slide.background = { color: resolveColor(page.background, doc.theme).replace('#', '') };
    const sx = first.width / page.width / 96, sy = first.height / page.height / 96;
    for (const node of page.nodes) {
      if (node.visible === false) continue;
      const base = { x: node.x * sx, y: node.y * sy, w: node.width * sx, h: node.height * sy, rotate: node.rotation ?? 0, transparency: (1 - (node.opacity ?? 1)) * 100 };
      if (node.type === 'text') {
        slide.addText(node.text ?? '', { ...base, fontSize: Number(node.style?.fontSize ?? 24) * 0.75, fontFace: resolveFont(node.style?.fontFamily, doc.theme), color: resolveColor(node.style?.fill ?? '$text', doc.theme).replace('#', ''), bold: Number(node.style?.fontWeight ?? 400) >= 600, italic: node.style?.fontStyle === 'italic', margin: 0, breakLine: false, valign: 'top' });
      } else if (node.type === 'shape' || node.type === 'frame') {
        const color = resolveColor(node.style?.fill ?? '$surface', doc.theme).replace('#', '');
        slide.addShape(node.style?.shape === 'ellipse' ? deck.ShapeType.ellipse : Number(node.style?.borderRadius) >= Math.min(node.width, node.height) / 2 ? deck.ShapeType.roundRect : deck.ShapeType.rect, { ...base, fill: { color, transparency: base.transparency }, line: { color, transparency: 100 } });
      } else {
        const layer: DesignDocument = { ...doc, pages: [{ ...page, width: Math.max(1, node.width), height: Math.max(1, node.height), background: 'transparent', nodes: [{ ...node, x: 0, y: 0, rotation: 0 }] }] };
        const img = await imageOf(renderSvg(layer)), canvas = document.createElement('canvas'); canvas.width = layer.pages[0].width; canvas.height = layer.pages[0].height; canvas.getContext('2d')!.drawImage(img, 0, 0);
        slide.addImage({ ...base, data: canvas.toDataURL('image/png') });
      }
    }
    slide.addNotes(`Design Studio AI: ${page.name}. Text and primitive shapes remain editable.`);
  }
  return await deck.write({ outputType: 'base64' });
}
async function video(input: DesignDocument, pageIndex: number, format: 'webm' | 'mp4') {
  const doc = await prepare({ ...input, pages: [input.pages[pageIndex]] }), page = doc.pages[0], timeline = doc.timeline;
  if (!timeline) throw new Error('This document needs a timeline.');
  if (timeline.duration > 60) throw new Error('Cloud video exports currently support up to 60 seconds per clip.');
  const candidates = format === 'mp4' ? ['video/mp4;codecs=avc1.42001E', 'video/mp4'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = candidates.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error(`${format.toUpperCase()} encoding is unavailable in this renderer; use WebM.`);
  const canvas = document.createElement('canvas'); canvas.width = page.width; canvas.height = page.height;
  document.body.appendChild(canvas);
  const context = canvas.getContext('2d')!;
  context.drawImage(await imageOf(renderSvg(doc, 0, 0)), 0, 0);
  const stream = canvas.captureStream(0), videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const media = new Map<string, HTMLMediaElement>(), audio = new AudioContext(), destination = audio.createMediaStreamDestination();
  try {
    for (const node of page.nodes.filter(n => (n.type === 'video' || n.type === 'audio') && n.src && n.visible !== false)) {
      const element = document.createElement(node.type === 'video' ? 'video' : 'audio'); element.crossOrigin = 'anonymous'; element.src = node.src!;
      await new Promise<void>((resolve, reject) => { element.onloadeddata = () => resolve(); element.onerror = () => reject(new Error(`Could not decode media: ${node.name}`)); });
      audio.createMediaElementSource(element).connect(destination); media.set(node.id, element);
    }
    if (media.size) for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks: BlobPart[] = []; recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error('Video encoding failed.')); });
    await audio.resume(); for (const element of media.values()) await element.play();
    recorder.start(); const start = performance.now();
    do {
      const time = Math.min(timeline.duration, (performance.now() - start) / 1000);
      context.clearRect(0, 0, page.width, page.height);
      let layers: typeof page.nodes = [], background = page.background;
      const paintLayers = async () => {
        const frame = await imageOf(renderSvg({ ...doc, pages: [{ ...page, background, nodes: layers }] }, 0, time));
        context.drawImage(frame, 0, 0); layers = []; background = 'transparent';
      };
      for (const node of page.nodes) {
        const m = media.get(node.id);
        if (!(m instanceof HTMLVideoElement)) { if (!media.has(node.id)) layers.push(node); continue; }
        await paintLayers();
        const n = interpolateNode(node, doc, time); context.save(); context.globalAlpha = n.opacity ?? 1;
        context.translate(n.x + n.width / 2, n.y + n.height / 2); context.rotate((n.rotation ?? 0) * Math.PI / 180);
        context.drawImage(m, -n.width / 2, -n.height / 2, n.width, n.height); context.restore();
      }
      await paintLayers();
      videoTrack.requestFrame();
      await new Promise(resolve => setTimeout(resolve, 1000 / timeline.fps));
    } while ((performance.now() - start) / 1000 < timeline.duration);
    videoTrack.requestFrame();
    await new Promise(resolve => setTimeout(resolve, 100));
    recorder.stop(); await finished;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 32) throw new Error('The video encoder returned no frames.');
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
  } finally { for (const el of media.values()) el.pause(); stream.getTracks().forEach(t => t.stop()); await audio.close(); canvas.remove(); }
}
Object.assign(globalThis, { studioRenderer: { present, pptx, video } });
