import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { loadDocumentFonts } from '../shared/font-loading';
import type { DesignDocument, DesignNode, DesignPage } from '../shared/schema';
import { isSafeUrl } from '../shared/schema';
import { resolveColor, resolveFont, interpolateNode, renderSvg } from '../shared/render';
import { childrenOf, resolveLayout } from '../shared/layout';
import { DesignComponent } from './design-component';
import type { Layout } from '../shared/design-capabilities';

export const usesDom = (page: DesignPage) => !!page.layout || page.nodes.some(n => !!n.layout || n.type === 'component');
export function containerStyle(layout?: Layout): CSSProperties {
  if (!layout || layout.mode === 'absolute') return {};
  return { display: layout.mode, flexDirection: layout.direction ?? 'column', gap: layout.gap ?? 0, padding: layout.padding ?? 0, flexWrap: layout.wrap ? 'wrap' : 'nowrap', alignContent: 'start', alignItems: layout.align === 'start' ? 'flex-start' : layout.align === 'end' ? 'flex-end' : layout.align, justifyContent: layout.justify === 'start' ? 'flex-start' : layout.justify === 'end' ? 'flex-end' : layout.justify, gridTemplateColumns: layout.mode === 'grid' ? `repeat(${layout.columns ?? 2}, minmax(0, 1fr))` : undefined };
}
export function DocumentView({ doc, pageIndex = 0, time = 0, navigate, onBounds, onOverlayBounds, editingId }: { doc: DesignDocument; pageIndex?: number; time?: number; navigate?: (id: string) => void; onBounds?: (nodes: DesignNode[]) => void; onOverlayBounds?: (nodes: DesignNode[]) => void; editingId?: string | null }) {
  const page = doc.pages[pageIndex], ref = useRef<HTMLDivElement>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [fontError, setFontError] = useState('');
  useEffect(() => { let active = true; void loadDocumentFonts(doc).then(() => { if (active) setFontError(''); }, error => { if (active) setFontError(error instanceof Error ? error.message : 'Font loading failed'); }); return () => { active = false; }; }, [doc.theme.fonts, doc.pages]);
  const animatedPage = useMemo(() => ({ ...page, nodes: page.nodes.map(n => interpolateNode(n, doc, time)) }), [page, doc, time]);
  const resolved = useMemo(() => new Map(resolveLayout(animatedPage).nodes.map(n => [n.id, n])), [animatedPage]);
  useLayoutEffect(() => {
    if (!ref.current || (!onBounds && !onOverlayBounds)) return;
    const host = ref.current;
    const measure = () => {
      const box = host.getBoundingClientRect(), width = parseFloat(getComputedStyle(host).width), scale = box.width / width;
      if (!Number.isFinite(scale) || !scale) return;
      const elements = new Map(Array.from(host.querySelectorAll<HTMLElement>('[data-design-node]')).map(el => [el.dataset.designNode!, el]));
      const pixels = (value: number) => Math.round(value * 1e6) / 1e6;
      const visualRects = new Map(Array.from(elements, ([id, el]) => [id, el.getBoundingClientRect()]));
      const transforms = Array.from(elements.values(), el => [el, el.style.transform] as const);
      const layout = new Map<string, { x: number; y: number; width: number; height: number }>();
      // Grouping needs the CSS layout boxes before any ancestor/node rotations.
      // Restore transforms synchronously before paint; transforms do not resize boxes.
      try {
        for (const [el] of transforms) el.style.transform = 'none';
        for (const [id, el] of elements) { const rect = el.getBoundingClientRect(); layout.set(id, { x: pixels((rect.left - box.left) / scale), y: pixels((rect.top - box.top) / scale), width: pixels(rect.width / scale), height: pixels(rect.height / scale) }); }
      } finally { for (const [el, transform] of transforms) el.style.transform = transform; }
      const nodes = new Map(animatedPage.nodes.map(n => [n.id, n]));
      const rotations = new Map<string, number>();
      const rotationOf = (n: DesignNode): number => {
        if (rotations.has(n.id)) return rotations.get(n.id)!;
        const parent = n.parentId ? nodes.get(n.parentId) : undefined;
        const rotation = (n.rotation ?? 0) + (parent ? rotationOf(parent) : 0); rotations.set(n.id, rotation); return rotation;
      };
      onBounds?.(animatedPage.nodes.map(n => ({ ...n, ...(layout.get(n.id) ?? {}), visible: elements.has(n.id) })));
      onOverlayBounds?.(animatedPage.nodes.map(n => {
        const bounds = layout.get(n.id), rect = visualRects.get(n.id); if (!bounds || !rect) return { ...n, visible: false };
        const rotation = rotationOf(n), angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
        const px = bounds.width * (n.pivot?.[0] ?? .5), py = bounds.height * (n.pivot?.[1] ?? .5);
        const corners = [[0, 0], [bounds.width, 0], [0, bounds.height], [bounds.width, bounds.height]].map(([x, y]) => [px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c]);
        // A page-level overlay uses the accumulated rotation around the node's own pivot.
        return { ...n, ...bounds, x: pixels((rect.left - box.left) / scale - Math.min(...corners.map(p => p[0]))), y: pixels((rect.top - box.top) / scale - Math.min(...corners.map(p => p[1]))), rotation, visible: true };
      }));
    };
    const observer = new ResizeObserver(measure); observer.observe(host); host.querySelectorAll('[data-design-node]').forEach(el => observer.observe(el)); measure();
    return () => observer.disconnect();
  }, [animatedPage, onBounds, onOverlayBounds, visibility]);
  const draw = (n: DesignNode, parent?: DesignNode): React.ReactNode => { if (!(visibility[n.id] ?? n.visible !== false)) return null;
    const layout = parent?.layout ?? (!parent ? page.layout : undefined), flow = layout && layout.mode !== 'absolute' && n.position !== 'absolute';
    const s = n.style ?? {}, fill = resolveColor(s.fill ?? (n.type === 'text' ? '$text' : '$surface'), doc.theme);
    const parentBox = parent && resolved.get(parent.id);
    const style: CSSProperties = { boxSizing: 'border-box', position: flow ? 'relative' : 'absolute', left: flow ? undefined : n.x - (parent && !parent.layout ? parentBox?.x ?? parent.x : 0), top: flow ? undefined : n.y - (parent && !parent.layout ? parentBox?.y ?? parent.y : 0),
      width: n.sizing?.width === 'fill' ? layout?.direction === 'row' ? undefined : '100%' : n.sizing?.width === 'hug' ? 'max-content' : n.width,
      height: n.sizing?.height === 'fill' ? layout?.direction !== 'row' ? undefined : '100%' : n.sizing?.height === 'hug' ? 'max-content' : n.height,
      flex: flow && n.sizing?.[layout.direction === 'row' ? 'width' : 'height'] === 'fill' ? '1 1 0' : '0 0 auto', minWidth: n.sizing?.minWidth ?? 0, maxWidth: n.sizing?.maxWidth, minHeight: n.sizing?.minHeight, maxHeight: n.sizing?.maxHeight,
      opacity: n.opacity ?? 1, transform: `rotate(${n.rotation ?? 0}deg)`, transformOrigin: `${(n.pivot?.[0] ?? .5) * 100}% ${(n.pivot?.[1] ?? .5) * 100}%`,
      borderRadius: Number(s.borderRadius ?? 0), color: editingId === n.id ? 'transparent' : n.type === 'text' ? fill : resolveColor('$text', doc.theme), fontFamily: resolveFont(s.fontFamily, doc.theme), fontSize: Number(s.fontSize ?? 24), fontWeight: Number(s.fontWeight ?? 400), fontStyle: s.fontStyle === 'italic' ? 'italic' : 'normal', lineHeight: Number(s.lineHeight ?? 1.2), letterSpacing: Number(s.letterSpacing ?? 0), textAlign: (s.textAlign ?? 'left') as CSSProperties['textAlign'], whiteSpace: 'pre-wrap', ...containerStyle(n.layout) };
    if (['frame', 'shape'].includes(n.type)) style.background = fill;
    if (n.type === 'shape' && (s.shape === 'ellipse' || n.data?.shape === 'ellipse')) style.borderRadius = '50%';
    if (Number(s.strokeWidth)) style.border = `${Number(s.strokeWidth)}px solid ${resolveColor(s.stroke, doc.theme)}`;
    const interact = (trigger: 'click' | 'hover', event: React.SyntheticEvent) => { for (const action of n.interactions ?? []) if (action.trigger === trigger) { event.stopPropagation(); if (action.action === 'navigate') navigate?.(action.target); if (action.action === 'url' && /^https:\/\//.test(action.target)) window.open(action.target, '_blank', 'noopener,noreferrer'); if (action.action === 'toggle') { const target = page.nodes.find(node => node.id === action.target); if (target) setVisibility(previous => ({ ...previous, [target.id]: !(previous[target.id] ?? target.visible !== false) })); } } };
    return <div key={n.id} data-design-node={n.id} style={style} onClick={e => interact('click', e)} onMouseEnter={e => interact('hover', e)}>
      {n.component ? <DesignComponent node={n} theme={doc.theme}/> : n.type === 'text' ? n.text : n.type === 'image' && n.src && isSafeUrl(n.src) ? <img src={n.src} alt={n.name} style={{ width: '100%', height: '100%', objectFit: s.objectFit === 'contain' ? 'contain' : 'cover' }}/> : n.type === 'video' && n.src ? <video src={n.src} controls style={{ width: '100%', height: '100%' }}/> : n.type === 'audio' && n.src ? <audio src={n.src} controls/> : ['chart', 'icon', 'model3d'].includes(n.type) ? <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: renderSvg({ ...doc, timeline: undefined, pages: [{ ...page, layout: undefined, width: Math.max(1, n.width), height: Math.max(1, n.height), background: 'transparent', nodes: [{ ...n, parentId: undefined, x: 0, y: 0, rotation: 0, opacity: 1 }] }] }) }}/> : null}
      {childrenOf(animatedPage, n.id).map(child => draw(child, n))}
    </div>;
  };
  return <div ref={ref} className="studio-document" data-font-error={fontError || undefined} title={fontError || undefined} style={{ position: 'relative', isolation: 'isolate', boxSizing: 'border-box', width: '100%', minHeight: page.height, background: resolveColor(page.background, doc.theme), ...containerStyle(page.layout) }}>{childrenOf(animatedPage).map(n => draw(n))}</div>;
}
