import { useEffect, useState } from 'react';
import type { BoardElement } from '../shared/board-schema';
import { mutateDocument } from '../shared/operations';
import { canvasPng, gifPosterCanvas, loadGifAsset, uploadElementAsset } from './creative-elements-media';
import type { ElementsProps } from './creative-elements-panel';
type GifElement = Extract<BoardElement, { type: 'gif' }>;
export function CreativeGifControls({ doc, boardId, projectId, onCommit, element: e, timeMs }: ElementsProps & { element: GifElement; timeMs: number }) {
  const [posterTime, setPosterTime] = useState(e.posterTime), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setPosterTime(e.posterTime); }, [e.id, e.posterTime]);
  function patch(values: Partial<GifElement>) { try { onCommit(doc, mutateDocument(doc, [{ op: 'upsert-board-elements', boardId, elements: [{ ...e, ...values }] }])); } catch (reason) { setError(String(reason)); } }
  async function poster() {
    if (!projectId) return; const base = structuredClone(doc); setBusy(true); setError('');
    try { const source = base.assets.find(a => a.id === e.assetId); if (!source) throw new Error('GIF source missing'); const animation = await loadGifAsset(source.url); if (posterTime >= animation.durationMs) throw new Error(`Poster must be earlier than ${animation.durationMs} ms.`);
      const asset = await uploadElementAsset(projectId, await canvasPng(gifPosterCanvas(animation, posterTime)), `${e.name}-poster.png`);
      const next = structuredClone(base); next.assets.push(asset); onCommit(base, mutateDocument(next, [{ op: 'upsert-board-elements', boardId, elements: [{ ...e, posterTime, posterAssetId: asset.id, pausedAtMs: posterTime, playing: false }] }]));
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  return <div className="creative-gif-controls" aria-label="GIF playback controls">
    <button onClick={() => patch(e.playing ? { playing: false, pausedAtMs: Math.max(0, timeMs - (e.startMs ?? 0)) } : { playing: true, startMs: Math.max(0, timeMs - (e.pausedAtMs ?? 0)) })}>{e.playing ? 'Pause GIF' : 'Play GIF'}</button>
    <label><span>Loop GIF</span><input type="checkbox" checked={e.loop} onChange={event => patch({ loop: event.target.checked })}/></label>
    <label>Timeline start (ms)<input type="number" min={0} max={600000} value={e.startMs ?? 0} onChange={event => patch({ startMs: Number(event.target.value) })}/></label>
    <label>Poster time (ms)<input type="number" min={0} max={600000} value={posterTime} onChange={event => setPosterTime(Number(event.target.value))}/></label>
    <button disabled={busy || !projectId} onClick={() => void poster()}>{busy ? 'Saving poster…' : 'Set GIF poster'}</button>
    <small>Reduced-motion preference shows a still poster.</small>{error && <p role="alert">{error}</p>}
  </div>;
}
