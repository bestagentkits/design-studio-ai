import { useRef, useState, type CSSProperties } from 'react';
import type { DesignNode, Theme } from '../shared/schema';
import { resolveColor, resolveFont } from '../shared/render';

export function InlineTextEditor({ node, bounds, theme, opacity, finish, save }: {
  node: DesignNode; bounds: DesignNode; theme: Theme; opacity: number;
  finish: (text: string | null, restoreFocus: boolean, original: string) => boolean; save: () => void;
}) {
  const [text, setText] = useState(node.text ?? '');
  const finished = useRef(false);
  const original = useRef(node.text ?? "");
  const end = (value: string | null, restoreFocus: boolean) => {
    if (finished.current) return;
    finished.current = true;
    finished.current = finish(value, restoreFocus, original.current);
  };
  const s = node.style ?? {};
  return <textarea autoFocus className="direct-text-editor" aria-label="Edit selected text"
    spellCheck={false} value={text} onChange={event => setText(event.target.value)}
    style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height,
      fontFamily: resolveFont(s.fontFamily, theme), fontSize: Number(s.fontSize ?? 24), fontWeight: Number(s.fontWeight ?? 400),
      fontStyle: s.fontStyle === 'italic' ? 'italic' : 'normal', lineHeight: Number(s.lineHeight ?? 1.2), letterSpacing: Number(s.letterSpacing ?? 0),
      textAlign: (s.textAlign ?? 'left') as CSSProperties['textAlign'], color: resolveColor(s.fill ?? '$text', theme), opacity,
      transform: `rotate(${bounds.rotation ?? 0}deg)`, transformOrigin: `${(bounds.pivot?.[0] ?? .5) * 100}% ${(bounds.pivot?.[1] ?? .5) * 100}%`,
    }} onPointerDown={event => event.stopPropagation()} onBlur={() => end(text, false)}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); end(null, true); }
      else if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); end(text, true); if (finished.current) save(); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); end(text, true); }
    }}/>
}
