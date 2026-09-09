import { useEffect, useRef, useState, type RefObject } from 'react';
export function useCanvasGestures(viewport: RefObject<HTMLDivElement | null>, scale: number, setZoom: (fn: (zoom: number) => number) => void, disabled: boolean, ready = true, cancelDrag?: () => void) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const current = useRef({ scale, pan }); current.current = { scale, pan };
  const cancel = useRef(cancelDrag); cancel.current = cancelDrag;
  useEffect(() => {
    const host = viewport.current; if (!host || disabled) return;
    let space = false;
    const pointers = new Map<number, { x: number; y: number }>();
    let previousDistance = 0;
    const zoomAt = (factor: number, x: number, y: number) => {
      const paper = host.querySelector('.canvas-paper')?.getBoundingClientRect();
      if (!paper) return;
      setZoom(value => { const next = Math.max(.1, Math.min(8, value * factor)); const actual = next / value; setPan(p => ({ x: p.x - (x - paper.left - paper.width / 2) * (actual - 1), y: p.y - (y - paper.top - paper.height / 2) * (actual - 1) })); return next; });
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || event.altKey) zoomAt(Math.exp(-event.deltaY * .008), event.clientX, event.clientY);
      else setPan(p => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (e.pointerType === 'touch') pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { cancel.current?.(); e.preventDefault(); e.stopPropagation(); const [a, b] = [...pointers.values()]; previousDistance = Math.hypot(a.x - b.x, a.y - b.y); }
      if (space || e.button === 1) { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); host.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); }
    };
    const move = (e: PointerEvent) => {
      const previous = pointers.get(e.pointerId); if (!previous) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        e.preventDefault(); e.stopPropagation(); const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (previousDistance > 0) zoomAt(distance / previousDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
        previousDistance = distance;
      } else if (space || e.buttons === 4) { e.preventDefault(); e.stopPropagation(); setPan(p => ({ x: p.x + e.clientX - previous.x, y: p.y + e.clientY - previous.y })); }
    };
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); previousDistance = 0; };
    const keydown = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.defaultPrevented && !e.isComposing && !document.querySelector('dialog[open], [popover]:popover-open') && host.contains(e.target as Node) && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable],button,[role=combobox]')) { space = true; e.preventDefault(); } };
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space') space = false; };
    const blur = () => { space = false; pointers.clear(); };
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { host.removeEventListener('wheel', wheel); host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [disabled, viewport, setZoom, ready]);
  return { pan, resetPan: () => setPan({ x: 0, y: 0 }) };
}
