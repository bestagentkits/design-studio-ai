import { Camera, Sun, Palette, Move3D, Image, RotateCcw } from 'lucide-react';
import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import { defaultScene } from '../shared/scene-runtime';
import { resolveColor } from '../shared/render';
import { Field } from './ui';

function Vector({ label, value, change }: { label: string; value: [number, number, number]; change: (value: [number, number, number]) => void }) {
  return <Field label={label}><div className="vector-fields">{value.map((v, axis) => <label key={axis}><span>{'XYZ'[axis]}</span><input type="number" aria-label={`${label} ${'XYZ'[axis]}`} step="0.1" value={Number(v.toFixed(4))} onChange={e => { const next = [...value] as [number, number, number]; next[axis] = +e.target.value; change(next); }}/></label>)}</div></Field>;
}
export function SceneInspector({ doc, page, node, update, pageUpdate, onTexture }: { doc: DesignDocument; page: DesignPage; node?: DesignNode; update: (patch: Partial<DesignNode>) => void; pageUpdate: (patch: Partial<DesignPage>) => void; onTexture?: (file: File, nodeId: string) => Promise<void> }) {
  const settings = page.scene ?? defaultScene, scene = node?.scene ?? {}, material = scene.material ?? {};
  const setMaterial = (patch: typeof material) => update({ scene: { ...scene, material: { ...material, ...patch } } });
  const texture = doc.assets.find(a => a.id === material.textureAssetId);
  const presets = [{ name: 'Matte', metalness: 0, roughness: .85 }, { name: 'Ceramic', metalness: 0, roughness: .2 }, { name: 'Metal', metalness: 1, roughness: .25 }, { name: 'Polished', metalness: .9, roughness: .08 }];
  return <div className="scene-inspector">{node ? <>
    <details open><summary><Move3D size={16}/>Object transform</summary><div className="scene-section">
      <Vector label="Position" value={scene.position ?? [(node.x + node.width / 2 - page.width / 2) / 240, (page.height / 2 - node.y - node.height / 2) / 240, Number(node.data?.z ?? 0)]} change={position => update({ scene: { ...scene, position } })}/>
      <Vector label="Rotation (degrees)" value={scene.rotation ?? [Number(node.data?.rotationX ?? 0), Number(node.data?.rotationY ?? 0), node.rotation ?? 0]} change={rotation => update({ scene: { ...scene, rotation } })}/>
      <Vector label="Scale" value={scene.scale ?? [node.width / 400, node.height / 400, Number(node.data?.depth ?? node.width) / 400]} change={scale => update({ scene: { ...scene, scale } })}/>
    </div></details>
    <details open><summary><Palette size={16}/>Material</summary><div className="scene-section">
      <div className="material-presets">{presets.map(preset => <button key={preset.name} title={`Apply ${preset.name.toLowerCase()} finish`} onClick={() => setMaterial({ metalness: preset.metalness, roughness: preset.roughness })}><i style={{ background: `radial-gradient(circle at 30% 25%, white, ${resolveColor(material.color ?? node.style?.fill ?? '$accent', doc.theme)} 45%, #202020)` }}/>{preset.name}</button>)}</div>
      <Field label="Material color"><div className="material-color"><input type="color" aria-label="Pick material color" value={resolveColor(material.color ?? node.style?.fill ?? '$accent', doc.theme)} onChange={e => setMaterial({ color: e.target.value })}/><input aria-label="Material color" value={material.color ?? String(node.style?.fill ?? '$accent')} onChange={e => setMaterial({ color: e.target.value })}/></div></Field>
      {(['metalness', 'roughness'] as const).map(key => <Field label={key === 'metalness' ? 'Metalness' : 'Roughness'} key={key}><div className="material-range"><input aria-label={key} type="range" min={0} max={1} step={.01} value={material[key] ?? Number(node.data?.[key] ?? .3)} onChange={e => setMaterial({ [key]: +e.target.value })}/><output>{(material[key] ?? Number(node.data?.[key] ?? .3)).toFixed(2)}</output></div></Field>)}
      <label className="component-check"><input type="checkbox" checked={material.wireframe ?? false} onChange={e => setMaterial({ wireframe: e.target.checked })}/>Wireframe</label><label className="component-check"><input type="checkbox" checked={material.doubleSided ?? false} onChange={e => setMaterial({ doubleSided: e.target.checked })}/>Double sided</label>
    </div></details>
    <details open><summary><Image size={16}/>Color texture</summary><div className="scene-section">
      <Field label="Color texture"><select value={material.textureAssetId ?? ''} onChange={e => setMaterial({ textureAssetId: e.target.value || undefined })}><option value="">{node.src && !scene.mesh ? 'Original model texture' : 'None'}</option>{doc.assets.filter(asset => asset.mimeType.startsWith('image/')).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>
      {texture && <img className="texture-preview" src={texture.url} alt={`Texture: ${texture.name}`}/>}
      {onTexture && <label className="button small texture-import">Import texture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void onTexture(file, node.id); e.target.value = ''; }}/></label>}
      <p className="small-copy">Use Mesh / UV / Rig in the viewport to unwrap and edit texture coordinates.</p>
    </div></details>
  </> : <>
    <details open><summary><Camera size={16}/>Camera</summary><div className="scene-section">
      <Vector label="Camera position" value={settings.camera.position} change={position => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, position } } })}/>
      <Vector label="Look at" value={settings.camera.target} change={target => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, target } } })}/>
      <Field label="Field of view"><input type="number" min={10} max={120} value={settings.camera.fov} onChange={e => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, fov: Math.max(10, Math.min(120, +e.target.value)) } } })}/></Field>
      <button className="button small" onClick={() => pageUpdate({ scene: { ...settings, camera: structuredClone(defaultScene.camera) } })}><RotateCcw size={14}/>Reset camera</button>
    </div></details>
    <details open><summary><Sun size={16}/>Lighting</summary><div className="scene-section">
      <Field label="Ambient intensity"><input type="number" min={0} max={10} step={.1} value={settings.ambient} onChange={e => pageUpdate({ scene: { ...settings, ambient: Math.max(0, Math.min(10, +e.target.value)) } })}/></Field>
      <Vector label="Light position" value={settings.light.position} change={position => pageUpdate({ scene: { ...settings, light: { ...settings.light, position } } })}/>
      <Field label="Light intensity"><input type="number" min={0} max={20} step={.1} value={settings.light.intensity} onChange={e => pageUpdate({ scene: { ...settings, light: { ...settings.light, intensity: Math.max(0, Math.min(20, +e.target.value)) } } })}/></Field>
      <Field label="Light color"><input type="color" value={settings.light.color} onChange={e => pageUpdate({ scene: { ...settings, light: { ...settings.light, color: e.target.value } } })}/></Field>
    </div></details>
  </>}</div>;
}
