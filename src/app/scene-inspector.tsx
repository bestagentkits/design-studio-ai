import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import { defaultScene } from '../shared/scene-runtime';
import { Field } from './ui';

function Vector({ label, value, change }: { label: string; value: [number, number, number]; change: (value: [number, number, number]) => void }) {
  return <Field label={label}><div className="property-grid">{value.map((v, axis) => <input key={axis} type="number" aria-label={`${label} ${'XYZ'[axis]}`} step="0.1" value={v} onChange={e => { const next = [...value] as [number, number, number]; next[axis] = +e.target.value; change(next); }}/>)}</div></Field>;
}
export function SceneInspector({ doc, page, node, update, pageUpdate }: { doc: DesignDocument; page: DesignPage; node?: DesignNode; update: (patch: Partial<DesignNode>) => void; pageUpdate: (patch: Partial<DesignPage>) => void }) {
  const settings = page.scene ?? defaultScene, scene = node?.scene ?? {}, material = scene.material ?? {};
  const setMaterial = (patch: typeof material) => update({ scene: { ...scene, material: { ...material, ...patch } } });
  return <section><h3>{node ? 'Object & material' : 'Camera & lighting'}</h3>{node ? <>
    <Vector label="Position" value={scene.position ?? [(node.x + node.width / 2 - page.width / 2) / 240, (page.height / 2 - node.y - node.height / 2) / 240, Number(node.data?.z ?? 0)]} change={position => update({ scene: { ...scene, position } })}/>
    <Vector label="Rotation (degrees)" value={scene.rotation ?? [Number(node.data?.rotationX ?? 0), Number(node.data?.rotationY ?? 0), node.rotation ?? 0]} change={rotation => update({ scene: { ...scene, rotation } })}/>
    <Vector label="Scale" value={scene.scale ?? [node.width / 400, node.height / 400, Number(node.data?.depth ?? node.width) / 400]} change={scale => update({ scene: { ...scene, scale } })}/>
    <Field label="Material color"><input value={material.color ?? String(node.style?.fill ?? '$accent')} onChange={e => setMaterial({ color: e.target.value })}/></Field>
    {(['metalness', 'roughness'] as const).map(key => <Field label={key} key={key}><input type="range" min={0} max={1} step={.01} value={material[key] ?? Number(node.data?.[key] ?? .3)} onChange={e => setMaterial({ [key]: +e.target.value })}/></Field>)}
    <Field label="Color texture"><select value={material.textureAssetId ?? ''} onChange={e => setMaterial({ textureAssetId: e.target.value || undefined })}><option value="">None</option>{doc.assets.filter(asset => asset.mimeType.startsWith('image/')).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>
    <label><input type="checkbox" checked={material.wireframe ?? false} onChange={e => setMaterial({ wireframe: e.target.checked })}/>Wireframe</label><label><input type="checkbox" checked={material.doubleSided ?? false} onChange={e => setMaterial({ doubleSided: e.target.checked })}/>Double sided</label>
  </> : <>
    <Vector label="Camera position" value={settings.camera.position} change={position => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, position } } })}/>
    <Vector label="Look at" value={settings.camera.target} change={target => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, target } } })}/>
    <Field label="Field of view"><input type="number" min={10} max={120} value={settings.camera.fov} onChange={e => pageUpdate({ scene: { ...settings, camera: { ...settings.camera, fov: +e.target.value } } })}/></Field>
    <Field label="Ambient intensity"><input type="number" min={0} max={10} step={.1} value={settings.ambient} onChange={e => pageUpdate({ scene: { ...settings, ambient: +e.target.value } })}/></Field>
    <Vector label="Light position" value={settings.light.position} change={position => pageUpdate({ scene: { ...settings, light: { ...settings.light, position } } })}/>
    <Field label="Light intensity"><input type="number" min={0} max={20} step={.1} value={settings.light.intensity} onChange={e => pageUpdate({ scene: { ...settings, light: { ...settings.light, intensity: +e.target.value } } })}/></Field>
    <Field label="Light color"><input type="color" value={settings.light.color} onChange={e => pageUpdate({ scene: { ...settings, light: { ...settings.light, color: e.target.value } } })}/></Field>
  </>}</section>;
}
