import { SceneAuthoringPanel } from './scene-authoring-panel';
import { mountSceneComposition } from '../shared/scene-composition';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { DesignDocument, DesignNode, DesignPage, Theme } from '../shared/schema';
import { animateScene, buildScene, defaultScene, disposeScene, exportScene } from '../shared/scene-runtime';
import { MeshTools } from './mesh-tools';
import { download } from './api';

export function SceneView({ page, theme, selected, onSelect, doc, pageIndex = 0, time = 0, onUpdate, onPage, onDocument }: {
  page: DesignPage; theme: Theme; selected: string | null; onSelect: (id: string, additive?: boolean) => void; doc?: DesignDocument; pageIndex?: number; time?: number;
  onDocument?: (doc: DesignDocument) => void;
  onUpdate?: (patch: Partial<DesignNode>) => void; onPage?: (patch: Partial<DesignPage>) => void;
}) {
  const host = useRef<HTMLDivElement>(null), [error, setError] = useState(''), [transform, setTransform] = useState<'translate' | 'rotate' | 'scale'>('translate'), [mode, setMode] = useState('object'), [selection, select] = useState<number[]>([]), [tools, showTools] = useState(false);
  const toolbar=useRef<HTMLDivElement>(null),[toolbarHeight,setToolbarHeight]=useState(50);
  useEffect(()=>{if(!toolbar.current)return;const observer=new ResizeObserver(entries=>setToolbarHeight(entries[0].contentRect.height+16));observer.observe(toolbar.current);return()=>observer.disconnect();},[]);
  const [authoring,showAuthoring]=useState(false),[heatBone,setHeatBone]=useState<number|null>(null);
  const active = page.nodes.find(n => n.id === selected);
  const document: DesignDocument = doc ?? { schemaVersion: 1, id: 'scene', name: 'Scene', kind: '3d', pages: [page], assets: [], theme, metadata: { createdAt: '', updatedAt: '' } };
  const handlers = useRef({ onSelect, onUpdate, onPage, mode, selection, document, time, active }); handlers.current = { onSelect, onUpdate, onPage, mode, selection, document, time, active };
  useEffect(() => { select([]); setHeatBone(null); }, [selected]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let composition: ReturnType<typeof mountSceneComposition> | undefined;
    let disposed = false, scene: THREE.Scene | undefined, renderer: THREE.WebGLRenderer | undefined, orbit: OrbitControls | undefined, gizmo: TransformControls | undefined, observer: ResizeObserver | undefined;
    const cleanup = () => {
      composition?.dispose(); renderer?.setAnimationLoop(null); observer?.disconnect();
      if (gizmo) { scene?.remove(gizmo.getHelper()); gizmo.dispose(); gizmo = undefined; }
      orbit?.dispose(); orbit = undefined;
      if (scene) { disposeScene(scene); scene = undefined; }
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); renderer = undefined; }
    };
    setError('');
    void (async () => {
      try {
        const built = await buildScene(handlers.current.document, pageIndex, handlers.current.time);
        if (disposed) { disposeScene(built.scene); return; }
        scene = built.scene; const { camera, objects, target } = built;
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; element.appendChild(renderer.domElement);
        orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(target); orbit.enableDamping = true; orbit.enabled = mode === 'object';
        let needsRender = true;
        gizmo = new TransformControls(camera, renderer.domElement); gizmo.setMode(transform); gizmo.getHelper().userData.compositionNode = selected; scene.add(gizmo.getHelper());
        gizmo.addEventListener('change', () => { needsRender = true; });
        const object = selected ? objects.get(selected) : undefined;
        if (object && mode === 'object' && onUpdate) gizmo.attach(object);
        let draggedGizmo = false;
        gizmo.addEventListener('dragging-changed', e => { if (orbit) orbit.enabled = mode === 'object' && !e.value; if (e.value) draggedGizmo = true; });
        gizmo.addEventListener('mouseUp', () => { if (object && draggedGizmo) handlers.current.onUpdate?.({ scene: { ...handlers.current.active?.scene, position: object.position.toArray(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map(v => v * 180 / Math.PI) as [number, number, number], scale: object.scale.toArray() } }); });
        orbit.addEventListener('end', () => { if (!orbit || gizmo?.dragging || draggedGizmo) return; const old = page.scene ?? defaultScene; if (camera.position.distanceTo(new THREE.Vector3(...old.camera.position)) > .001 || orbit.target.distanceTo(new THREE.Vector3(...old.camera.target)) > .001) handlers.current.onPage?.({ scene: { ...old, camera: { ...old.camera, position: camera.position.toArray(), target: orbit.target.toArray() } } }); });
        const grid = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc); grid.userData.compositionBackground = true; scene.add(grid);
        const mesh = object instanceof THREE.Mesh ? object : undefined;
        if (mesh && heatBone !== null && active?.scene?.mesh?.skinWeights) {
          const data=active.scene.mesh, colors:number[]=[];
          for(let i=0;i<data.positions.length/3;i++){let w=0;for(let j=0;j<4;j++)if(data.skinIndices![i*4+j]===heatBone)w+=data.skinWeights![i*4+j];colors.push(w,.15,1-w);}
          mesh.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(material instanceof THREE.MeshStandardMaterial){material.vertexColors=true;material.color.set('#ffffff');material.map?.dispose();material.map=null;}
        }
        let vertexPoints: THREE.Points | undefined, selectedPoints: THREE.Points | undefined;
        if (mesh && mode !== 'object') {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', mesh.geometry.getAttribute('position').clone());
          vertexPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#bbbbbb', size: .025, depthTest: false })); vertexPoints.renderOrder = 100; mesh.add(vertexPoints);
          selectedPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#ff9900', size: .07, depthTest: false })); selectedPoints.renderOrder = 101; mesh.add(selectedPoints);
        }
        if (mesh && active?.scene?.bones?.length) {
          if (!(mesh instanceof THREE.SkinnedMesh)) {
            const bones = active.scene.bones.map((b, i) => { const bone = new THREE.Bone(); bone.name = `${active.id}_bone_${i}`; bone.position.fromArray(b.position); bone.rotation.set(...(b.rotation ?? [0, 0, 0]).map(v => v * Math.PI / 180) as [number, number, number]); return bone; });
            active.scene.bones.forEach((b, i) => (b.parent < 0 ? mesh : bones[b.parent]).add(bones[i]));
          }
          const joints: THREE.Bone[] = []; mesh.traverse(child => { if (child instanceof THREE.Bone) joints.push(child); });
          for (const bone of joints) { const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)); const marker = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#55ddff', size: .08, depthTest: false })); marker.renderOrder = 103; bone.add(marker); }
          const skeleton = new THREE.SkeletonHelper(mesh); for (const material of Array.isArray(skeleton.material) ? skeleton.material : [skeleton.material]) material.depthTest = false; skeleton.renderOrder = 102; skeleton.userData.compositionNode = selected; scene.add(skeleton);
        }
        const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), local = new THREE.Vector3(), point = new THREE.Vector3();
        let pointerStart = [0, 0];
        renderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; draggedGizmo = !!gizmo?.dragging; });
        renderer.domElement.addEventListener('click', event => {
          if (!renderer || gizmo?.dragging || draggedGizmo || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
          const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera);
          const hit = composition?.pickHit(ray.intersectObjects([...objects.values()], true));
          const overlay = composition?.pickOverlay(event.clientX, event.clientY, hit ? String(hit.object.userData.nodeId) : undefined);
          if (overlay) { handlers.current.onSelect(overlay, event.shiftKey); return; }
          if (!hit) return;
          const id = String(hit.object.userData.nodeId); if (id !== selected) { handlers.current.onSelect(id, event.shiftKey); select([]); return; }
          if (handlers.current.mode !== 'object' && hit.face && hit.object instanceof THREE.Mesh) {
            hit.object.worldToLocal(local.copy(hit.point)); const hitMesh = hit.object, ids = [hit.face.a, hit.face.b, hit.face.c];
            let values: number[];
            if (handlers.current.mode === 'face') values = [hit.faceIndex!];
            else if (handlers.current.mode === 'edge') {
              const edges = [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]];
              values = edges.sort((a, b) => { const distance = (edge: number[]) => new THREE.Line3(hitMesh.getVertexPosition(edge[0], new THREE.Vector3()), hitMesh.getVertexPosition(edge[1], new THREE.Vector3())).closestPointToPoint(local, true, point).distanceToSquared(local); return distance(a) - distance(b); })[0];
            } else values = [ids.sort((a, b) => hitMesh.getVertexPosition(a, point).distanceToSquared(local) - hitMesh.getVertexPosition(b, point).distanceToSquared(local))[0]];
            const previous = handlers.current.selection; select(event.shiftKey ? values.every(v => previous.includes(v)) ? previous.filter(v => !values.includes(v)) : [...new Set([...previous, ...values])] : values);
          }
        });
        composition = mountSceneComposition(element, handlers.current.document, pageIndex, renderer, scene, camera);
        const resize = () => {
          // Hidden mobile panes must not resize WebGL to a zero-sized drawing buffer.
          const width = element.clientWidth, height = element.clientHeight;
          if (!width || !height) return;
          renderer?.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); needsRender = true;
        };
        observer = new ResizeObserver(resize); observer.observe(element); resize();
        let renderedTime = NaN, previousSelection: number[] | undefined;
        renderer.setAnimationLoop(() => {
          if (!scene || !renderer || !orbit) return;
          const current = handlers.current, timeChanged = renderedTime !== current.time;
          if (timeChanged && !gizmo?.dragging) { animateScene(scene, current.document, pageIndex, current.time); renderedTime = current.time; }
          scene.updateMatrixWorld(true);
          const selectionChanged = previousSelection !== current.selection;
          if (mesh && selectedPoints && (timeChanged || selectionChanged)) {
            const index = mesh.geometry.index, count = mesh.geometry.getAttribute('position').count;
            const ids = [...new Set(current.mode === 'face' && index ? current.selection.flatMap(i => i * 3 + 2 < index.count ? [index.getX(i * 3), index.getX(i * 3 + 1), index.getX(i * 3 + 2)] : []) : current.selection)].filter(i => i < count);
            const points = ids.flatMap(i => mesh.getVertexPosition(i, point).toArray()); selectedPoints.geometry.dispose(); selectedPoints.geometry = new THREE.BufferGeometry(); selectedPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
            if (vertexPoints && mesh instanceof THREE.SkinnedMesh) { const position = vertexPoints.geometry.getAttribute('position'); for (let i = 0; i < count; i++) { mesh.getVertexPosition(i, point); position.setXYZ(i, point.x, point.y, point.z); } position.needsUpdate = true; vertexPoints.geometry.computeBoundingSphere(); }
            previousSelection = current.selection;
          }
          // Static authoring should not continuously redraw shadows and skinned meshes.
          // Orbit damping, transforms, selection, resize and playback still invalidate the view.
          const cameraChanged = orbit.update();
          if (needsRender || timeChanged || selectionChanged || cameraChanged) { composition?.draw(current.time); needsRender = false; }
          previousSelection = current.selection;
        });
      } catch (e) { cleanup(); if (!disposed) setError(e instanceof Error ? e.message : 'WebGL unavailable'); }
    })();
    return () => { disposed = true; cleanup(); };
  }, [page, theme, selected, transform, mode, pageIndex, doc?.assets, doc?.timeline, !!onUpdate, heatBone]);
  return <div className="scene-workspace" style={{'--scene-tools-top':`${toolbarHeight}px`} as React.CSSProperties}><div className="scene-toolbar" ref={toolbar}>{onDocument&&<button aria-pressed={authoring} onClick={()=>showAuthoring(!authoring)}>Character authoring</button>}{(['translate', 'rotate', 'scale'] as const).map(value => <button key={value} aria-pressed={transform === value} onClick={() => setTransform(value)}>{value}</button>)}<button aria-pressed={tools} onClick={() => showTools(!tools)}>Mesh / UV / Rig</button>{mode !== 'object' && <button onClick={() => { setMode('object'); select([]); }}>Orbit / object mode</button>}{doc && ['glb', 'gltf'].map(format => <button key={format} onClick={async () => { try { const output = await exportScene(doc, pageIndex, format === 'glb'); download(`${doc.name}.${format}`, output instanceof ArrayBuffer ? output : JSON.stringify(output), format === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'); } catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); } }}>Export {format.toUpperCase()}</button>)}</div>
    {authoring&&onDocument&&<SceneAuthoringPanel doc={document} pageId={page.id} nodeId={active?.id} onDocument={onDocument} selection={mode==='face'&&active?.scene?.mesh?[...new Set(selection.flatMap(i=>active.scene!.mesh!.indices.slice(i*3,i*3+3)))]:selection} onHeat={setHeatBone}/>}
    <div className="scene-view" ref={host}/>{error && <p className="scene-error" role="alert">{error}</p>}{tools && active?.type === 'model3d' && onUpdate && <MeshTools node={active} update={onUpdate} mode={mode} setMode={setMode} selection={selection} select={select} animatedBones={(doc?.timeline?.tracks ?? []).filter(t => t.nodeId === active.id).flatMap(t => t.keyframes.flatMap(k => Object.keys(k.values).flatMap(p => { const match = /^scene\.bones\.(\d+)\./.exec(p); return match ? [+match[1]] : []; })))}/>}
  </div>;
}
