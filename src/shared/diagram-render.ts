import type { DesignDocument } from './schema';
import type { SemanticElement } from './diagram-presets';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Local-coordinate overlay, placed inside the element's existing world transform. */
export function diagramNodeSvg(element: SemanticElement, doc: DesignDocument): string {
  const d = element.diagram; if (!d) return '';
  let body = '';
  if (d.role === 'database') body += `<ellipse cx="${element.width / 2}" cy="12" rx="${element.width / 2}" ry="12" fill="none" stroke="#1e40af"/>`;
  if (d.role === 'screen' && d.thumbnailAssetId) { const asset = doc.assets.find(a => a.id === d.thumbnailAssetId); if (asset) body += `<image href="${esc(asset.url)}" x="8" y="8" width="${element.width - 16}" height="${element.height - 44}" preserveAspectRatio="xMidYMid meet"/>`; }
  const chars = Math.max(4, Math.floor((element.width - 24) / (d.fontSize * .6))), lines: string[] = [];
  for (const paragraph of d.label.split('\n')) { let line = ''; for (const word of paragraph.split(' ')) { if (line && line.length + word.length + 1 > chars) { lines.push(line); line = ''; } line += (line ? ' ' : '') + word; } lines.push(line); }
  const y = d.role === 'boundary' ? -12 : d.role === 'screen' && d.thumbnailAssetId ? element.height - 12 : element.height / 2 - (lines.length - 1) * d.fontSize * .65 + d.fontSize * .35;
  body += `<text text-anchor="middle" font-family="${esc(d.fontFamily)}" font-size="${d.fontSize}" fill="#172554">${lines.map((line, i) => `<tspan x="${element.width / 2}" y="${y + i * d.fontSize * 1.3}">${esc(line)}</tspan>`).join('')}</text>`;
  return body;
}
