import {sharedSkinPlugin} from './scene-export-skins';
import {paintMaterial} from './scene-materials';
import {scenePose,rigOwner} from './scene-shared-rig';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { DesignDocument, DesignNode } from './schema';
import type { MeshData } from './design-capabilities';
import { resolveColor, interpolateNode } from './render';

export function geometryFor(node: DesignNode): THREE.BufferGeometry {
  if (node.scene?.mesh) {
    const data = node.scene.mesh, geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setIndex(data.indices);
    if (data.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    if (data.morphTargets?.length) { geometry.morphTargetsRelative = true; geometry.morphAttributes.position = data.morphTargets.map(t => { const a = new THREE.Float32BufferAttribute(t.positions, 3); a.name = t.name; return a; }); }
    if (data.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    if (data.skinIndices && data.skinWeights) { geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.skinWeights, 4)); }
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
  }
  switch (node.data?.geometry ?? node.data?.shape) {
    case 'sphere': return new THREE.SphereGeometry(1, 32, 24);
    case 'torus': return new THREE.TorusGeometry(.8, .3, 24, 48);
    case 'torusKnot': return new THREE.TorusKnotGeometry(.7, .23, 80, 16);
    case 'cone': return new THREE.ConeGeometry(1, 1.7, 32);
    case 'cylinder': return new THREE.CylinderGeometry(.8, .8, 1.6, 32);
    default: return new THREE.BoxGeometry(1.6, 1.6, 1.6);
  }
}
export function meshData(geometry: THREE.BufferGeometry): MeshData {
  const positions = Array.from(geometry.getAttribute('position').array), indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: positions.length / 3 }, (_, i) => i);
  const uv = geometry.getAttribute('uv'); return { positions, indices, ...(uv ? { uv: Array.from(uv.array) } : {}) };
}
export const defaultScene = { camera: { position: [5, 4, 7] as [number, number, number], target: [0, .5, 0] as [number, number, number], fov: 40 }, ambient: 2, light: { position: [3, 6, 4] as [number, number, number], intensity: 4, color: '#ffffff' } };
export async function buildScene(doc: DesignDocument, pageIndex = 0, time = 0) {
  const page = doc.pages[pageIndex], config = page.scene ?? defaultScene;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(resolveColor(page.background, doc.theme));
  const camera = new THREE.PerspectiveCamera(config.camera.fov, page.width / page.height, .01, 10000); camera.name = 'StudioCamera'; camera.position.fromArray(config.camera.position); camera.lookAt(new THREE.Vector3(...config.camera.target)); scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, config.ambient));
  const light = new THREE.DirectionalLight(resolveColor(config.light.color, doc.theme, '#ffffff'), config.light.intensity); light.position.fromArray(config.light.position); light.castShadow = true; scene.add(light);
  const objects = new Map<string, THREE.Object3D>();
  let pendingMaterial: THREE.Material | undefined, pendingGeometry: THREE.BufferGeometry | undefined;
  try {
  for (const raw of page.nodes.filter(n => n.type === 'model3d' || n.type === 'group')) {
    const n = scenePose(raw, doc, time), materialConfig = n.scene?.material;
    let object: THREE.Object3D;
    if (n.type === 'group') object = new THREE.Group();
    else if (n.src && !n.scene?.mesh) {
      object = (await new GLTFLoader().loadAsync(n.src)).scene;
      // Imported meshes retain authored materials until the user supplies overrides.
      if (materialConfig) {
        const asset = doc.assets.find(a => a.id === materialConfig.textureAssetId);
        let texture: THREE.Texture | undefined;
        try { if (asset) { texture = await new THREE.TextureLoader().loadAsync(asset.url); texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; } }
        catch (error) { disposeScene(object); throw error; }
        object.traverse(child => { if (!(child instanceof THREE.Mesh)) return;
          for (const item of Array.isArray(child.material) ? child.material : [child.material]) {
            if (!(item instanceof THREE.MeshStandardMaterial)) continue;
            if (materialConfig.color) item.color.set(resolveColor(materialConfig.color, doc.theme));
            if (materialConfig.metalness !== undefined) item.metalness = materialConfig.metalness;
            if (materialConfig.roughness !== undefined) item.roughness = materialConfig.roughness;
            if (materialConfig.wireframe !== undefined) item.wireframe = materialConfig.wireframe;
            if (materialConfig.doubleSided !== undefined) item.side = materialConfig.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
            if (texture) { item.map?.dispose(); item.map = texture; }
            item.needsUpdate = true;
          }
        });
      }
    }
    else {
      const material = new THREE.MeshStandardMaterial({ vertexColors: !!n.scene?.mesh?.colors, color: resolveColor(materialConfig?.color ?? n.style?.fill ?? n.data?.color ?? '$accent', doc.theme), metalness: materialConfig?.metalness ?? Number(n.data?.metalness ?? .15), roughness: materialConfig?.roughness ?? Number(n.data?.roughness ?? .35), wireframe: materialConfig?.wireframe ?? false, side: materialConfig?.doubleSided ? THREE.DoubleSide : THREE.FrontSide, opacity: n.opacity ?? 1, transparent: (n.opacity ?? 1) < 1 });
      pendingMaterial = material;
      const texture = doc.assets.find(a => a.id === materialConfig?.textureAssetId); if (texture) { material.map = await new THREE.TextureLoader().loadAsync(texture.url); material.map.colorSpace = THREE.SRGBColorSpace; }
      if(materialConfig)paintMaterial(material,materialConfig,resolveColor(materialConfig.color??'#ffffff',doc.theme));
      const geometry = geometryFor(n); pendingGeometry = geometry;
      if (n.scene?.bones?.length && n.scene.mesh?.skinIndices) {
        const mesh = new THREE.SkinnedMesh(geometry, material);
        const bones = n.scene.bones.map((b, i) => { const bone = new THREE.Bone(); bone.name = `${n.id}_bone_${i}`; bone.position.fromArray(rigOwner(raw,doc).scene!.bones![i].position); bone.rotation.set(...(rigOwner(raw,doc).scene!.bones![i].bindRotation ?? [0,0,0]).map(v=>v*Math.PI/180) as [number,number,number]); return bone; });
        n.scene.bones.forEach((b, i) => (b.parent < 0 ? mesh : bones[b.parent]).add(bones[i]));
        mesh.bind(new THREE.Skeleton(bones)); n.scene.bones.forEach((b, i) => { bones[i].position.fromArray(b.position); if (b.rotation) bones[i].rotation.fromArray([...b.rotation.map(v => v * Math.PI / 180), 'XYZ'] as [number, number, number, 'XYZ']); }); object = mesh;
      } else object = new THREE.Mesh(geometry, material);
    }
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) for (const [name, index] of Object.entries(object.morphTargetDictionary)) object.morphTargetInfluences[index] = n.scene?.morphWeights?.[name] ?? 0;
    object.name = n.id; object.visible = n.visible !== false;
    object.position.fromArray(n.scene?.position ?? [(n.x + n.width / 2 - page.width / 2) / 240, (page.height / 2 - n.y - n.height / 2) / 240, Number(n.data?.z ?? 0)]);
    const rotation = n.scene?.rotation ?? [Number(n.data?.rotationX ?? 0), Number(n.data?.rotationY ?? 0), n.rotation ?? 0]; object.rotation.set(...rotation.map(v => v * Math.PI / 180) as [number, number, number]);
    object.scale.fromArray(n.scene?.scale ?? [n.width / 400, n.height / 400, Number(n.data?.depth ?? n.width) / 400]);
    object.traverse(child => { child.userData.nodeId = n.id; if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } }); objects.set(n.id, object); scene.add(object); pendingMaterial = undefined; pendingGeometry = undefined;
  }
  for (const n of page.nodes) { const object = objects.get(n.id); if (object) (n.parentId && objects.get(n.parentId) || scene).add(object); }
  for(const node of page.nodes.filter(n=>n.scene?.rigId)){const mesh=objects.get(node.id),source=objects.get(node.scene!.rigId!);if(mesh instanceof THREE.SkinnedMesh&&source instanceof THREE.SkinnedMesh){for(const root of [...mesh.children].filter(c=>c instanceof THREE.Bone))mesh.remove(root);mesh.skeleton.dispose();mesh.bindMode='attached';mesh.bind(source.skeleton,mesh.bindMatrix);}}
  return { scene, camera, objects, target: new THREE.Vector3(...config.camera.target) };
  } catch (error) {
    disposeScene(scene); pendingGeometry?.dispose();
    if (pendingMaterial) { for (const value of Object.values(pendingMaterial)) if (value instanceof THREE.Texture) value.dispose(); pendingMaterial.dispose(); }
    throw error;
  }
}
export function animateScene(scene: THREE.Scene, doc: DesignDocument, pageIndex: number, time: number) {
  const page = doc.pages[pageIndex];
  for (const node of page.nodes) {
    const object = scene.getObjectByName(node.id); if (!object) continue;
    const n = scenePose(node, doc, time);
    object.position.fromArray(n.scene?.position ?? [(n.x + n.width / 2 - page.width / 2) / 240, (page.height / 2 - n.y - n.height / 2) / 240, Number(n.data?.z ?? 0)]);
    object.rotation.set(...(n.scene?.rotation ?? [Number(n.data?.rotationX ?? 0), Number(n.data?.rotationY ?? 0), n.rotation ?? 0]).map(v => v * Math.PI / 180) as [number, number, number]);
    object.scale.fromArray(n.scene?.scale ?? [n.width / 400, n.height / 400, Number(n.data?.depth ?? n.width) / 400]);
    n.scene?.bones?.forEach((bone, i) => {
      const target = object.getObjectByName(`${node.id}_bone_${i}`); if (!target) return;
      target.position.fromArray(bone.position);
      target.rotation.set(...(bone.rotation ?? [0, 0, 0]).map(v => v * Math.PI / 180) as [number, number, number]);
    });
    if (object instanceof THREE.Mesh && object.morphTargetDictionary && object.morphTargetInfluences) for (const [name,index] of Object.entries(object.morphTargetDictionary)) object.morphTargetInfluences[index]=n.scene?.morphWeights?.[name]??0;
    if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.opacity = n.opacity ?? 1; material.transparent = material.opacity < 1; }
  }
}
export function disposeScene(scene: THREE.Object3D) {
  const skeletons=new Set<THREE.Skeleton>();
  scene.traverse(child => { if (child instanceof THREE.SkinnedMesh&&!skeletons.has(child.skeleton)){skeletons.add(child.skeleton);child.skeleton.dispose();} if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points) { child.geometry.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material]; for (const material of materials) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); } } });
}
export async function exportScene(doc: DesignDocument, pageIndex = 0, binary = true) {
  const { scene } = await buildScene(doc, pageIndex);
  try {
    const tracks: THREE.KeyframeTrack[] = [], fps = doc.timeline?.fps ?? 30, duration = doc.timeline?.duration ?? 0, page = doc.pages[pageIndex];
    const animated = page.nodes.filter(n => n.visible!==false && (n.type === 'model3d' || n.type === 'group') && (n.scene?.constraints?.some(c=>c.enabled)||doc.timeline?.tracks.some(t => t.nodeId === n.id && !t.muted && t.keyframes.length)));
    const sampleValues = animated.reduce((sum, node) => sum + 10 + (node.scene?.mesh?.morphTargets?.length ?? 0) + (node.scene?.bones?.length ?? 0) * 7, 0) * (Math.ceil(duration * fps) + 1);
    if (sampleValues > 2000000) throw new Error('Scene animation export exceeds two million sampled values. Reduce duration, frame rate, or animated joints.');
    // Bake easing to samples because glTF interpolation cannot encode spring/bounce curves.
    if (duration) for (const node of animated) {
      const times: number[] = [], positions: number[] = [], rotations: number[] = [], scales: number[] = [];
      for (let frame = 0; frame <= Math.ceil(duration * fps); frame++) { const time = Math.min(duration, frame / fps), n = scenePose(node, doc, time); times.push(time); positions.push(...(n.scene?.position ?? [(n.x + n.width / 2 - page.width / 2) / 240, (page.height / 2 - n.y - n.height / 2) / 240, Number(n.data?.z ?? 0)])); scales.push(...(n.scene?.scale ?? [n.width / 400, n.height / 400, Number(n.data?.depth ?? n.width) / 400])); const rotation = n.scene?.rotation ?? [Number(n.data?.rotationX ?? 0), Number(n.data?.rotationY ?? 0), n.rotation ?? 0]; rotations.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(v => v * Math.PI / 180) as [number, number, number])).toArray()); }
      tracks.push(new THREE.VectorKeyframeTrack(`${node.id}.position`, times, positions), new THREE.QuaternionKeyframeTrack(`${node.id}.quaternion`, times, rotations), new THREE.VectorKeyframeTrack(`${node.id}.scale`, times, scales));
      if (node.scene?.mesh?.morphTargets?.length) tracks.push(new THREE.NumberKeyframeTrack(`${node.id}.morphTargetInfluences`, times, times.flatMap(time => node.scene!.mesh!.morphTargets!.map(t => scenePose(node,doc,time).scene?.morphWeights?.[t.name]??0))));
      node.scene?.bones?.forEach((_, i) => { const values = times.flatMap(time => { const bone = scenePose(node, doc, time).scene?.bones?.[i]; return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(bone?.rotation ?? [0, 0, 0]).map(v => v * Math.PI / 180) as [number, number, number])).toArray(); }); tracks.push(new THREE.QuaternionKeyframeTrack(`${node.id}_bone_${i}.quaternion`, times, values), new THREE.VectorKeyframeTrack(`${node.id}_bone_${i}.position`, times, times.flatMap(time => scenePose(node, doc, time).scene!.bones![i].position))); });
    }
    const animations = tracks.length ? [new THREE.AnimationClip(doc.name, duration, tracks)] : [];
    const ranges = new Map(page.nodes.filter(n=>n.visible!==false).flatMap(n=>(n.scene?.clips??[]).map(c=>[`${c.name}:${c.start}:${c.end}`,c] as const)));
    if(animations.length)for(const range of ranges.values())animations.push(THREE.AnimationUtils.subclip(animations[0],range.name,range.start*fps,range.end*fps+1,fps));
    return await new GLTFExporter().register(sharedSkinPlugin).parseAsync(scene, { binary, animations, onlyVisible: true });
  } finally { disposeScene(scene); }
}
