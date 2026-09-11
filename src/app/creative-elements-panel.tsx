import { bundledArtworkAsset, bundledAttribution, bundledStickerRecipe, recolorBundledSticker } from './creative-elements-artwork';
export { recolorBundledSticker } from './creative-elements-artwork';
import { rasterizeElementSvg } from './creative-elements-svg';
import { useEffect, useRef, useState } from 'react';
import { type DesignDocument, type AssetRef, uid } from '../shared/schema';
import { boardElementSchema, type BoardElement } from '../shared/board-schema';
import { mutateDocument } from '../shared/operations';
import { artworkUrl, searchElements, EMOJI_SKIN_VARIANTS, type LibraryElement } from '../shared/creative-elements-catalog';
import { inspectElementImage } from '../shared/creative-elements-image-bounds';
import { decodeGif } from '../shared/gif-timeline';
import { canvasPng, gifPosterCanvas, loadGifAsset, uploadElementAsset } from './creative-elements-media';
import { api } from './api';
import './creative-elements.css';
export type ElementsProps = { doc: DesignDocument; boardId: string; projectId?: string; onCommit: (base: DesignDocument, next: DesignDocument) => void; onInserted?: (id: string) => void; selectedElement?: BoardElement };
export function CreativeElementsPanel({ doc, boardId, projectId, onCommit, onInserted, selectedElement }: ElementsProps) {
  const [query, setQuery] = useState(''), [color, setColor] = useState('#e6aa48'), [variant, setVariant] = useState(0);
  const [owned, setOwned] = useState<AssetRef[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!projectId) return; let active = true; void api<{ assets: AssetRef[] }>(`/api/projects/${projectId}/assets`).then(result => { if (active) setOwned(result.assets); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [projectId]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); } finally { if (mounted.current) setBusy(false); } };
  function insert(base: DesignDocument, details: Record<string, unknown>, assets: AssetRef[] = []) {
    if (!mounted.current) return;
    const source = structuredClone(base); for (const asset of assets) if (!source.assets.some(a => a.id === asset.id)) source.assets.push(asset);
    const element = boardElementSchema.parse({ id: uid(), name: 'Element', x: 80, y: 80, width: 160, height: 160, ...details });
    onCommit(base, mutateDocument(source, [{ op: 'upsert-board-elements', boardId, elements: [element] }])); onInserted?.(element.id);
  }
  async function bundled(item: LibraryElement) {
    const base = structuredClone(doc), asset = await bundledArtworkAsset(item, color, variant);
    insert(base, { type: item.kind, name: item.name, assetId: asset.id, attribution: bundledAttribution(item), variant: item.id === 'thumb' ? EMOJI_SKIN_VARIANTS[variant].name : undefined, unicode: item.unicode ? item.unicode + (item.id === 'thumb' ? EMOJI_SKIN_VARIANTS[variant].suffix : '') : undefined }, [asset]);
  }
  async function insertOwned(asset: AssetRef, base = structuredClone(doc), dimensions?: { width: number; height: number }) {
    if (asset.mimeType === 'image/gif') {
      if (!projectId) throw new Error('Save the project before inserting GIFs.');
      const animation = await loadGifAsset(asset.url);
      const poster = await uploadElementAsset(projectId, await canvasPng(gifPosterCanvas(animation, 0)), `${asset.name}-poster.png`);
      insert(base, { type: 'gif', name: asset.name, assetId: asset.id, posterAssetId: poster.id, posterTime: 0, playing: false, loop: true, width: 200, height: 200 * animation.height / animation.width }, [asset, poster]);
    } else insert(base, { type: 'image', name: asset.name, assetId: asset.id, ...(dimensions ? { width: 200, height: 200 * dimensions.height / dimensions.width } : {}) }, [asset]);
  }
  async function upload(file: File) {
    if (!projectId) throw new Error('Save the project before uploading Elements.');
    if (file.size > 20 * 1024 ** 2) throw new Error('Images must be at most 20 MiB.');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.type)) throw new Error('Use PNG, JPEG, WebP, SVG, or GIF.');
    const base = structuredClone(doc);
    if (file.type === 'image/svg+xml') {
      const result = await rasterizeElementSvg(await file.text());
      const asset = await uploadElementAsset(projectId, result.blob, file.name.replace(/\.svg$/i, '') + '.png');
      if (mounted.current) { setOwned(current => [...current, asset]); setNotice('SVG imported as a PNG. Paths, text, and gradients are flattened; vector editing and recoloring are unavailable.'); }
      await insertOwned(asset, base, result); return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let dimensions: { width: number; height: number } | undefined;
    if (file.type === 'image/gif') decodeGif(bytes); else { dimensions = inspectElementImage(bytes, file.type); const decoded = await createImageBitmap(file); decoded.close(); }
    const asset = await uploadElementAsset(projectId, file, file.name);
    if (mounted.current) setOwned(current => [...current, asset]); await insertOwned(asset, base, dimensions);
  }
  const assets = [...new Map([...doc.assets, ...owned].map(a => [a.id, a])).values()].filter(a => /^image\/(png|jpeg|webp|gif)$/.test(a.mimeType) && a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="creative-elements" aria-label="Elements library" aria-busy={busy}>
    <h3>Elements</h3><label>Search elements<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Star, nature, smile…"/></label>
    <div className="creative-elements-options"><label>Sticker color<input type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>Hand variant<select value={variant} onChange={e => setVariant(+e.target.value)}>{EMOJI_SKIN_VARIANTS.map((v, i) => <option key={v.name} value={i}>{v.name}</option>)}</select></label></div>
    {selectedElement && bundledStickerRecipe(selectedElement) && <button disabled={busy || selectedElement.locked} onClick={() => void run(async () => { const base = structuredClone(doc), element = structuredClone(selectedElement); const next = await recolorBundledSticker(base, element, color); if (mounted.current) onCommit(base, next); })}>Recolor selected sticker</button>}
    <div className="creative-elements-grid">{searchElements(query).map(item => <button key={item.id} disabled={busy} onClick={() => void run(() => bundled(item))} title={`Insert ${item.name}`}><img alt="" src={artworkUrl(item, color, variant)}/><span>{item.name}</span></button>)}</div>
    {!searchElements(query).length && <p>No bundled artwork matches this search.</p>}
    <small>Original MIT artwork · stored in your document · works offline</small>
    <label>Upload image or GIF<input aria-label="Upload image or GIF" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" disabled={busy || !projectId} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => upload(file)); }}/></label>
    {!projectId && <p>Save your project to enable owned uploads.</p>}
    <p>SVG imports are safely flattened to PNG; external resources and scripts are rejected.</p>
    <p>GIF discovery uses your uploads. Inserted GIFs start paused.</p>
    <div className="creative-elements-grid">{assets.map(asset => <button disabled={busy} key={asset.id} onClick={() => void run(() => insertOwned(asset))}>{asset.mimeType !== 'image/gif' && <img src={asset.url} alt="" loading="lazy"/>}<span>{asset.mimeType === 'image/gif' ? 'GIF · ' : ''}{asset.name}</span></button>)}</div>
    {!assets.length && <p>No matching uploaded images.</p>}
    {doc.schemaVersion === 2 && doc.paintings.length > 0 && <><h4>Project paintings</h4>{doc.paintings.filter(p => p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(p => <button key={p.id} onClick={() => void run(async () => insert(doc, { type: 'painting', name: p.name, paintingId: p.id, width: 240, height: 240 * p.height / p.width }))}>Insert {p.name}</button>)}</>}
    {notice && <p role="status">{notice}</p>}{busy && <p role="status">Preparing element…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
