import { boardSvg } from './board-render';

import { characterSvg } from './character-svg';
import { resolveLayout } from './layout';
import { ease } from './easing';
import { documentFontFamilies, googleFontsStylesheetUrl } from './font-loading';
import { isSafeUrl, type DesignDocument, type DesignNode, type Theme } from './schema';

export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function resolveColor(value: unknown, theme: Theme, fallback = '#000000'): string {
  const raw = typeof value === 'string' ? value : '';
  const color = raw.startsWith('$') ? theme.colors[raw.slice(1)] ?? fallback : raw;
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/.test(color) ? color : fallback;
}
const num = (v: unknown, fallback: number, min = -100000, max = 100000) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function resolveFont(value: unknown, theme: Theme): string {
  const raw = value === '$heading' ? theme.fonts.heading : value === '$body' ? theme.fonts.body : value;
  return String(raw ?? theme.fonts.body).replace(/[^a-zA-Z0-9 ,_-]/g, '') || 'Arial';
}
export function interpolateNode(node: DesignNode, doc: DesignDocument, time = 0): DesignNode {
  // Geometry is immutable during playback. Clone only animated state, not large mesh buffers.
  const scene = node.scene ? (() => { const { mesh, ...state } = node.scene; return { ...structuredClone(state), ...(mesh ? {mesh} : {}) }; })() : undefined;
  const result = { ...node, style: { ...node.style }, ...(scene ? {scene} : {}) };
  for (const track of doc.timeline?.tracks.filter(track => track.nodeId === node.id && !track.muted) ?? []) {
    const frames = [...track.keyframes].sort((a, b) => a.time - b.time);
    const keys = new Set(frames.flatMap(f => Object.keys(f.values)));
    for (const key of keys) {
      const keyed = frames.filter(f => key in f.values);
      if (!keyed.length) continue;
      const before = [...keyed].reverse().find(f => f.time <= time) ?? keyed[0];
      const after = keyed.find(f => f.time >= time) ?? keyed[keyed.length - 1];
      const mix = before.time === after.time ? 0 : Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
      const a = before.values[key], b = after.values[key];
      const value = typeof a === 'number' && typeof b === 'number' ? a + (b - a) * ease(mix, before.easing) : a;
      if (['x', 'y', 'width', 'height', 'rotation', 'opacity'].includes(key) && typeof value === 'number') Object.assign(result, { [key]: value });
      else if (['fill', 'fontSize', 'borderRadius', 'strokeWidth', 'stroke'].includes(key)) result.style[key] = value;
      else if (typeof value === 'number') {
        const transform = /^scene\.(position|rotation|scale)\.([xyz])$/.exec(key);
        const morph = /^scene\.morphWeights\.([a-zA-Z0-9_-]+)$/.exec(key);
        if (morph && result.scene?.mesh?.morphTargets?.some(t=>t.name===morph[1])) { result.scene.morphWeights ??= {}; result.scene.morphWeights[morph[1]]=Math.max(0,Math.min(1,value)); }
        const bone = /^scene\.bones\.(\d+)\.(position|rotation)\.([xyz])$/.exec(key);
        if (transform) {
          const field = transform[1] as 'position' | 'rotation' | 'scale';
          result.scene ??= {};
          const page = doc.pages.find(p => p.nodes.some(n => n.id === node.id));
          const fallback = field === 'scale' ? [node.width / 400, node.height / 400, Number(node.data?.depth ?? node.width) / 400]
            : field === 'position' ? [(node.x + node.width / 2 - (page?.width ?? 0) / 2) / 240, ((page?.height ?? 0) / 2 - node.y - node.height / 2) / 240, Number(node.data?.z ?? 0)]
              : [Number(node.data?.rotationX ?? 0), Number(node.data?.rotationY ?? 0), node.rotation ?? 0];
          const vector = result.scene[field] ?? fallback;
          vector['xyz'.indexOf(transform[2])] = value;
          result.scene[field] = vector as [number, number, number];
        } else if (bone) {
          const target = result.scene?.bones?.[Number(bone[1])];
          if (target) {
            const field = bone[2] as 'position' | 'rotation';
            const vector = target[field] ?? [0, 0, 0];
            vector['xyz'.indexOf(bone[3])] = value;
            target[field] = vector as [number, number, number];
          }
        }
      }
    }
  }
  return result;
}
export function wrappedLines(value: string, width: number, size: number): string[] {
  const capacity = Math.max(1, Math.floor(width / (size * 0.52)));
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > capacity) { lines.push(line); line = ''; }
      if (word.length > capacity) {
        if (line) { lines.push(line); line = ''; }
        for (let pos = 0; pos < word.length; pos += capacity) {
          const chunk = word.slice(pos, pos + capacity);
          if (pos + capacity < word.length) lines.push(chunk); else line = chunk;
        }
      } else line += (line ? ' ' : '') + word;
    }
    lines.push(line);
  }
  return lines;
}
function nodeSvg(n: DesignNode, doc: DesignDocument, time = 0): string {
  if (n.visible === false) return '';
  const s = n.style ?? {}, theme = doc.theme;
  const fill = escapeHtml(resolveColor(s.fill ?? (n.type === 'text' ? '$text' : '$surface'), theme));
  const stroke = escapeHtml(resolveColor(s.stroke, theme, 'none'));
  const sw = num(s.strokeWidth, 0, 0, 100);
  const radius = num(s.borderRadius, n.type === 'frame' ? theme.radius : 0, 0, 10000);
  let markup = '';
  if (n.type === 'board' && doc.schemaVersion === 2 && n.crop) {
    const board = doc.boards.find(b => b.id === n.boardId);
    if (!board) throw new Error('Board is unavailable');
    markup = boardSvg(board, doc, n.crop, n.width, n.height);
  } else if (n.type === 'artwork' && doc.schemaVersion === 2) {
    const painting = doc.paintings.find(p => p.id === n.paintingId);
    const asset = doc.assets.find(a => a.id === painting?.composite?.assetId);
    if (!asset && painting?.layers.some(l => l.tiles.length)) throw new Error('Painting needs a current composite before rendering');
    markup = asset ? `<image href="${escapeHtml(asset.url)}" width="${n.width}" height="${n.height}" preserveAspectRatio="none"/>` : '';
  } else if (n.type === 'text') {
    const size = num(s.fontSize, 24, 1, 1000);
    const lineHeight = num(s.lineHeight, 1.2, 0.5, 4) * size;
    const align = s.textAlign === 'center' ? 'middle' : s.textAlign === 'right' ? 'end' : 'start';
    const x = align === 'middle' ? n.width / 2 : align === 'end' ? n.width : 0;
    markup = `<text fill="${fill}" font-family="${escapeHtml(resolveFont(s.fontFamily, theme))}" font-size="${size}" font-weight="${num(s.fontWeight, 400, 100, 900)}" font-style="${s.fontStyle === 'italic' ? 'italic' : 'normal'}" text-anchor="${align}" letter-spacing="${num(s.letterSpacing, 0, -100, 100)}">${wrappedLines(n.text ?? '', n.width, size).map((line, i) => `<tspan x="${x}" y="${size + i * lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
  } else if (n.type === 'image' && n.src && isSafeUrl(n.src)) {
    markup = `<image href="${escapeHtml(n.src)}" width="${n.width}" height="${n.height}" preserveAspectRatio="${s.objectFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}"/>`;
  } else if (n.type === 'chart') {
    const values = Array.isArray(n.data?.values) ? n.data.values.slice(0, 30).map(v => num(v, 0, 0, 1000000)) : [];
    const labels = Array.isArray(n.data?.labels) ? n.data.labels : [];
    const maximum = Math.max(1, ...values), gap = n.width / Math.max(values.length, 1);
    markup = values.map((value, i) => { const h = value / maximum * (n.height - 45); return `<rect x="${gap * i + 10}" y="${n.height - 45 - h}" width="${Math.max(0, gap - 24)}" height="${h}" rx="4" fill="${fill}"/><text x="${gap * i + 10}" y="${n.height - 14}" font-family="Arial" font-size="14" fill="${escapeHtml(resolveColor('$text', theme))}">${escapeHtml(String(labels[i] ?? value).slice(0, 30))}</text>`; }).join('');
  } else if (n.type === 'character' && n.character) {
    const character=doc.characters?.find(c=>c.id===n.character!.characterId);
    if(character) markup=`<svg width="${n.width}" height="${n.height}" viewBox="0 0 ${character.width} ${character.height}" overflow="visible">${characterSvg(character,n.character,doc.assets,time,n.id)}</svg>`;
  } else if (n.type === 'model3d') {
    const color = escapeHtml(resolveColor(n.data?.color ?? '$accent', theme));
    markup = `<ellipse cx="${n.width / 2}" cy="${n.height * 0.86}" rx="${n.width * 0.3}" ry="${n.height * 0.055}" fill="#000000" opacity="0.12"/><ellipse cx="${n.width / 2}" cy="${n.height * 0.46}" rx="${n.width * 0.29}" ry="${n.height * 0.31}" fill="none" stroke="${color}" stroke-width="${n.width * 0.14}" transform="rotate(-28 ${n.width / 2} ${n.height / 2})"/><text x="${n.width / 2}" y="${n.height - 3}" text-anchor="middle" font-size="12" fill="${escapeHtml(resolveColor('$muted', theme))}">3D scene · Open editor for interactive rendering</text>`;
  } else if (n.type === 'video' || n.type === 'audio' || n.type === 'image') {
    markup = `<rect width="${n.width}" height="${n.height}" rx="${radius}" fill="${fill}"/><text x="${n.width / 2}" y="${n.height / 2}" text-anchor="middle" font-family="Arial" font-size="18" fill="${escapeHtml(resolveColor('$muted', theme))}">${escapeHtml(n.name || n.type)}</text>`;
  } else if (n.type === 'group') {
    markup = '';
  } else if (s.shape === 'ellipse' || n.data?.shape === 'ellipse') {
    markup = `<ellipse cx="${n.width / 2}" cy="${n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  } else {
    markup = `<rect width="${n.width}" height="${n.height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  return `<g data-node-id="${escapeHtml(n.id)}" transform="translate(${num(n.x, 0)} ${num(n.y, 0)}) rotate(${num(n.rotation, 0)} ${num(n.width, 0) * (n.pivot?.[0] ?? .5)} ${num(n.height, 0) * (n.pivot?.[1] ?? .5)})" opacity="${num(n.opacity, 1, 0, 1)}">${markup}</g>`;
}
export function renderSvg(doc: DesignDocument, pageIndex = 0, time = 0): string {
  const sourcePage = doc.pages[pageIndex];
  // Animation is expressed in each node's original coordinate system; resolve
  // parent offsets only after evaluating the animated pose.
  const page = sourcePage ? resolveLayout({ ...sourcePage, nodes: sourcePage.nodes.map(node => interpolateNode(node, doc, time)) }) : undefined;
  if (!page) throw new Error('Page does not exist');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${escapeHtml(page.name)}"><rect width="100%" height="100%" fill="${escapeHtml(resolveColor(page.background, doc.theme, '#ffffff'))}"/>${page.nodes.map(n => nodeSvg(n, doc, time)).join('')}</svg>`;
}
export function renderHtml(doc: DesignDocument, viewer?: { script: string; nonce?: string }): string {
  const fontUrl = googleFontsStylesheetUrl(documentFontFamilies(doc));
  const sections = doc.pages.map((page, i) => {
    const media = page.nodes.filter(n => n.visible !== false && (n.type === 'video' || n.type === 'audio') && n.src && isSafeUrl(n.src)).map(n => `<${n.type} controls src="${escapeHtml(n.src)}" style="position:absolute;left:${n.x / page.width * 100}%;top:${n.y / page.height * 100}%;width:${n.width / page.width * 100}%;height:${n.height / page.height * 100}%" preload="metadata"></${n.type}>`).join('');
    return `<section data-studio-page="${i}" aria-label="${escapeHtml(page.name)}" style="max-width:${page.width}px">${renderSvg(doc, i)}${media}</section>`;
  }).join('\n');
  const interactive = viewer
    ? `<script id="studio-document" type="application/json">${JSON.stringify(doc).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')}</script><script${viewer.nonce ? ` nonce="${escapeHtml(viewer.nonce)}"` : ''}>${viewer.script.replace(/<\/script/gi, '<\\/script')}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.name)}</title>${fontUrl ? `<link rel="stylesheet" href="${escapeHtml(fontUrl)}" data-studio-fonts>` : ''}<style>body{margin:0;background:${resolveColor('$background', doc.theme, '#fff')};font-family:Arial}section{position:relative;margin:0 auto 24px;break-after:page}svg{display:block;width:100%;height:auto}@media print{section{margin:0;break-inside:avoid}video,audio{display:none}}</style></head><body>${sections}${interactive}</body></html>`;
}
