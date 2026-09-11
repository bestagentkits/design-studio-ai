import { diagramHiddenIds } from '../shared/diagram-layout';
import { boardGifFrame } from '../shared/creative-elements-gif-playback';
import { useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '../shared/schema';
import type { Board, BoardElement } from '../shared/board-schema';
import { boardElementVisible } from '../shared/board-render';
import { renderGifFrame, type GifAnimation } from '../shared/gif-timeline';
import { loadGifAsset } from './creative-elements-gif-loader';

type GifElement = Extract<BoardElement, { type: 'gif' }>;
export function useCreativeMotionTime(playing: boolean): number {
  const [time, setTime] = useState(0);
  useEffect(() => { if (!playing) return; let frame = 0, previous = performance.now(); const tick = (now: number) => { setTime(t => t + Math.min(100, now - previous)); previous = now; frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame); }, [playing]);
  return time;
}
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { if (typeof matchMedia !== 'function') return; const media = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  return reduced;
}
/** Render in board element order inside the same SVG, never as a topmost overlay. */
export function CreativeGifElement({ element: e, board, doc, timeMs }: { element: GifElement; board: Board; doc: DesignDocument; timeMs: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), lastFrame = useRef(-1);
  const [animation, setAnimation] = useState<GifAnimation>(), [error, setError] = useState('');
  const reduced = useReducedMotion(), source = doc.assets.find(a => a.id === e.assetId)?.url, poster = doc.assets.find(a => a.id === e.posterAssetId)?.url;
  useEffect(() => { const controller = new AbortController(); setAnimation(undefined); setError(''); lastFrame.current = -1; if (source) void loadGifAsset(source, controller.signal).then(value => { if (!controller.signal.aborted) setAnimation(value); }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }); return () => controller.abort(); }, [source]);
  useEffect(() => {
    if (!animation || !canvas.current) return;
    const frame = boardGifFrame(animation, e, timeMs, reduced);
    if (lastFrame.current === frame) return; lastFrame.current = frame;
    const target = canvas.current; target.width = animation.width; target.height = animation.height;
    target.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(renderGifFrame(animation, frame)), animation.width, animation.height), 0, 0);
  }, [animation, timeMs, e.playing, e.startMs, e.pausedAtMs, e.posterTime, e.loop, reduced]);
  if (!boardElementVisible(board, e) || diagramHiddenIds(board).has(e.id)) return null;
  let opacity = e.opacity; const frames: BoardElement[] = []; let parent = board.elements.find(p => p.id === e.parentId);
  while (parent) { opacity *= parent.opacity; if (parent.type === 'frame') frames.push(parent); parent = board.elements.find(p => p.id === parent!.parentId); }
  let content = <g data-board-element={e.id} opacity={opacity} transform={`translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2}) translate(${e.flipX ? e.width : 0} ${e.flipY ? e.height : 0}) scale(${e.flipX ? -1 : 1} ${e.flipY ? -1 : 1})`}>
    <title>{error ? `${e.name}: ${error}; poster retained` : `${e.name}${reduced ? ' · reduced motion poster' : ''}`}</title>
    {(!animation || error) && poster && <image href={poster} width={e.width} height={e.height} preserveAspectRatio="none"/>}
    <rect width={e.width} height={e.height} fill="transparent" pointerEvents="all"/>
    <foreignObject width={e.width} height={e.height} pointerEvents="none"><canvas ref={canvas} aria-label={e.name} style={{ width: '100%', height: '100%', display: animation && !error ? 'block' : 'none' }}/></foreignObject>
    {error && <text x={4} y={16} fontSize={12} fill="#b42318">GIF unavailable · poster retained</text>}
  </g>;
  for (const frame of frames) { const id = `clip-${board.id}-${e.id}-${frame.id}`; content = <g key={id}><defs><clipPath id={id}><rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} transform={`rotate(${frame.rotation} ${frame.x + frame.width / 2} ${frame.y + frame.height / 2})`}/></clipPath></defs><g clipPath={`url(#${id})`}>{content}</g></g>; }
  return content;
}
