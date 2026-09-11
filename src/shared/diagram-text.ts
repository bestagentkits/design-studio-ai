import { diagramFontAdvances } from './diagram-font-data';
import type { BoardElement } from './board-schema';
let context: CanvasRenderingContext2D | null | undefined;
export function diagramTextWidth(text: string, family: string, size: number): number {
  const advances=diagramFontAdvances[family.replace(/["']/g, '').toLowerCase()];
  if (advances) return [...text.normalize('NFC')].reduce((sum, c) => sum + (advances[c.codePointAt(0)!] ?? .6), 0) * size;
  if (typeof document !== 'undefined') {
    context ??= document.createElement('canvas').getContext('2d');
    if (context) { context.font = `${size}px ${family}`; return context.measureText(text).width; }
  }
  // System/custom font metrics are browser-dependent; bundled handwriting is deterministic everywhere.
  return [...text].reduce((sum, c) => sum + (/\p{Mark}/u.test(c) ? 0 : /[ilI.,' ]/.test(c) ? .28 : /[MW@]/.test(c) ? .9 : .56), 0) * size;
}
export function diagramTextLines(text: string, family: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && diagramTextWidth(`${line} ${word}`, family, size) > width) { lines.push(line); line = ''; }
      if (diagramTextWidth(word, family, size) > width) {
        for (const char of word) { if (line && diagramTextWidth(line + char, family, size) > width) { lines.push(line); line = ''; } line += char; }
      } else line += (line ? ' ' : '') + word;
    }
    lines.push(line);
  }
  return lines;
}
export function sizeDiagramNode(node: BoardElement): void {
  const d = node.diagram;
  if (!d?.autoSize || d.role === 'boundary') return;
  const diamond = node.type === 'shape' && node.shape === 'diamond';
  const width = Math.min(420, Math.max(160, ...d.label.split('\n').map(line => diagramTextWidth(line, d.fontFamily, d.fontSize) + 48)));
  const lines = diagramTextLines(d.label, d.fontFamily, d.fontSize, width - 48);
  node.width = Math.ceil(width * (diamond ? 1.5 : 1));
  node.height = Math.ceil(Math.max(d.role === 'screen' ? 160 : 72, (lines.length * d.fontSize * 1.35 + 40) * (diamond ? 1.6 : 1)));
}
