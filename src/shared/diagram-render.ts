import type { DesignDocument } from './schema';
import type { SemanticElement } from './diagram-presets';
import { diagramTextLines } from './diagram-text';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Local-coordinate text layout shared by editor and exports. */
export function diagramNodeSvg(element: SemanticElement, doc: DesignDocument): string {
  const d = element.diagram; if (!d) return '';
  let body = '';
  const image = d.role === 'screen' && d.thumbnailAssetId;
  if (image) { const asset = doc.assets.find(a => a.id === d.thumbnailAssetId); if (asset) body += `<image href="${esc(asset.url)}" x="12" y="12" width="${element.width - 24}" height="${element.height - 56}" preserveAspectRatio="xMidYMid meet"/>`; }
  const inset = element.type === 'shape' && element.shape === 'diamond' ? element.width / 4 : 24;
  const lines = diagramTextLines(d.label, d.fontFamily, d.fontSize, Math.max(16, element.width - inset * 2));
  const y = d.role === 'boundary' ? -14 : image ? element.height - 16 : element.height / 2 - (lines.length - 1) * d.fontSize * .675 + d.fontSize * .34;
  const x = d.align === 'left' ? inset : d.align === 'right' ? element.width - inset : element.width / 2;
  body += `<text font-weight="400" font-kerning="none" style="font-variant-ligatures:none" text-anchor="${d.align === 'left' ? 'start' : d.align === 'right' ? 'end' : 'middle'}" font-family="${esc(d.fontFamily)}" font-size="${d.fontSize}" fill="${esc(d.textColor)}">${lines.map((line, i) => `<tspan x="${x}" y="${y + i * d.fontSize * 1.35}">${esc(line)}</tspan>`).join('')}</text>`;
  return body;
}
