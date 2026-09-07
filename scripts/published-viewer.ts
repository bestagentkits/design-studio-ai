import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { renderSvg, resolveColor, interpolateNode } from '../src/shared/render';
import type { DesignDocument } from '../src/shared/schema';

const source = document.getElementById('studio-document');
if (source?.textContent) {
  const doc = JSON.parse(source.textContent) as DesignDocument;
  const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-studio-page]'));
  for (const [index, page] of doc.pages.entries()) {
    const section = sections[index]; if (!section) continue;
    for (const node of page.nodes.filter(n => n.type === 'model3d' && n.visible !== false)) {
      const host = document.createElement('div');
      host.style.cssText = `position:absolute;left:${node.x / page.width * 100}%;top:${node.y / page.height * 100}%;width:${node.width / page.width * 100}%;height:${node.height / page.height * 100}%;touch-action:none`;
      host.setAttribute('aria-label', `${node.name}: drag to orbit, scroll to zoom`); section.appendChild(host);
      host.dataset.studioObject = node.id;
      host.style.opacity = String(node.opacity ?? 1);
      void (async () => {
        try {
          const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(renderer.domElement);
          const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, node.width / node.height, 0.1, 100);
          camera.position.set(0, 0.7, 5); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
          scene.add(new THREE.HemisphereLight(0xffffff, 0x657090, 2.5)); const light = new THREE.DirectionalLight(0xffffff, 4); light.position.set(3, 4, 5); scene.add(light);
          let object: THREE.Object3D;
          if (node.src) { object = (await new GLTFLoader().loadAsync(node.src)).scene; const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()); object.position.sub(center); object.scale.setScalar(2.5 / Math.max(size.x, size.y, size.z, 0.01)); }
          else {
            const geometry = node.data?.geometry === 'sphere' ? new THREE.SphereGeometry(1, 40, 32) : node.data?.geometry === 'box' ? new THREE.BoxGeometry(1.6, 1.6, 1.6) : node.data?.geometry === 'torus' ? new THREE.TorusGeometry(0.8, 0.3, 32, 64) : node.data?.geometry === 'cylinder' ? new THREE.CylinderGeometry(0.7, 0.7, 1.8, 48) : node.data?.geometry === 'cone' ? new THREE.ConeGeometry(1, 1.7, 48) : new THREE.TorusKnotGeometry(0.7, 0.23, 100, 20);
            object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: resolveColor(node.style?.fill ?? node.data?.color ?? '$accent', doc.theme), metalness: Number(node.data?.metalness ?? 0.25), roughness: Number(node.data?.roughness ?? 0.3) }));
          }
          object.rotation.set(Number(node.data?.rotationX ?? 0) * Math.PI / 180, Number(node.data?.rotationY ?? 0) * Math.PI / 180, (node.rotation ?? 0) * Math.PI / 180); scene.add(object);
          const resize = () => { const scale = Math.min(1, Math.sqrt(4194304 / Math.max(1, host.clientWidth * host.clientHeight))); renderer.setSize(Math.max(1, host.clientWidth * scale), Math.max(1, host.clientHeight * scale), false); renderer.domElement.style.cssText = 'width:100%;height:100%'; camera.aspect = host.clientWidth / Math.max(1, host.clientHeight); camera.updateProjectionMatrix(); };
          new ResizeObserver(resize).observe(host); resize();
          const preview = section.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`); preview?.setAttribute('visibility', 'hidden');
          renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
          window.addEventListener('pagehide', () => { renderer.setAnimationLoop(null); controls.dispose(); renderer.dispose(); }, { once: true });
        } catch { host.textContent = 'The 3D scene could not load. Open in a browser with WebGL enabled.'; host.style.background = resolveColor('$background', doc.theme); }
      })();
    }
  }
  if (doc.timeline) {
    const controls = document.createElement('div'); controls.style.cssText = 'position:sticky;bottom:16px;display:flex;align-items:center;gap:16px;max-width:480px;margin:16px auto;padding:12px 20px;border-radius:12px;background:#1b1b1b;color:white;font:14px Arial';
    const play = document.createElement('button'); play.textContent = 'Play animation'; play.style.cssText = 'padding:10px 16px;cursor:pointer;border:0;border-radius:6px';
    const scrub = document.createElement('input'); scrub.type = 'range'; scrub.min = '0'; scrub.max = String(doc.timeline.duration); scrub.step = '0.01'; scrub.value = '0'; scrub.setAttribute('aria-label', 'Animation time'); scrub.style.flex = '1';
    controls.appendChild(play); controls.appendChild(scrub); document.body.appendChild(controls);
    let running = false, time = 0, frame = 0;
    const paint = () => { sections.forEach((section, index) => { const svg = section.querySelector('svg'); if (svg) svg.outerHTML = renderSvg(doc, index, time); for (const node of doc.pages[index].nodes.filter(n => n.type === 'model3d' && n.visible !== false)) { section.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)?.setAttribute('visibility', 'hidden'); const host = section.querySelector<HTMLElement>(`[data-studio-object="${CSS.escape(node.id)}"]`); if (host) { const animated = interpolateNode(node, doc, time), page = doc.pages[index]; host.style.left = `${animated.x / page.width * 100}%`; host.style.top = `${animated.y / page.height * 100}%`; host.style.width = `${animated.width / page.width * 100}%`; host.style.height = `${animated.height / page.height * 100}%`; host.style.opacity = String(animated.opacity ?? 1); } } }); scrub.value = String(time); };
    play.onclick = () => { running = !running; play.textContent = running ? 'Pause' : 'Play animation'; cancelAnimationFrame(frame); if (!running) return; if (time >= doc.timeline!.duration) time = 0; const start = performance.now() - time * 1000; const tick = () => { time = Math.min(doc.timeline!.duration, (performance.now() - start) / 1000); paint(); if (time < doc.timeline!.duration && running) frame = requestAnimationFrame(tick); else { running = false; play.textContent = 'Play animation'; } }; tick(); };
    scrub.oninput = () => { time = Number(scrub.value); running = false; cancelAnimationFrame(frame); play.textContent = 'Play animation'; paint(); };
    paint();
  }
}
