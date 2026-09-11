import { canvasPng } from './creative-elements-media';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title', 'desc']);
const attributes = new Set(['id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'clip-rule', 'clip-path', 'opacity', 'fill-opacity', 'stroke-opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'preserveAspectRatio', 'vector-effect']);
const styleAttributes = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline']);
function safeValue(value: string) {
  if (value.length > 1000000 || /[\\<>]|(?:https?:|data:|javascript:|expression\s*\(|@import)/i.test(value)) throw new Error('SVG external resources or executable values are unsupported.');
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) if (!/^#[a-zA-Z_][\w.-]*$/.test(match[1].trim())) throw new Error('SVG references must stay inside the file.');
  if (/url/i.test(value) && !/^url\(#[a-zA-Z_][\w.-]*\)$/.test(value)) throw new Error('Unsupported SVG resource reference.');
}
/** Parse into a detached XML document, copy allowed primitives into a new document, never inject input DOM. */
export function sanitizeElementSvg(source: string): { svg: string; width: number; height: number } {
  if (new TextEncoder().encode(source).length > 2 * 1024 ** 2) throw new Error('SVG must be at most 2 MiB.');
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml[^?]*\?>/, ''))) throw new Error('SVG document declarations and processing instructions are unsupported.');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml'), root = parsed.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE || parsed.querySelector('parsererror')) throw new Error('Malformed SVG document.');
  const all = [root, ...Array.from(root.querySelectorAll('*'))]; if (all.length > 5000) throw new Error('SVG exceeds 5000 elements.');
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && (viewBox.length !== 4 || viewBox.some(n => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0)) throw new Error('Invalid SVG viewBox.');
  const dimension = (name: 'width' | 'height', index: number) => {
    const value = root.getAttribute(name);
    if (value && !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) throw new Error('SVG dimensions must be explicit pixels.');
    return Math.ceil(value ? parseFloat(value) : viewBox?.[index] ?? 0);
  };
  const width = dimension('width', 2), height = dimension('height', 3);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16 * 1024 ** 2) throw new Error('SVG dimensions must be within 4096 pixels per side and 16 megapixels.');
  const output = document.implementation.createDocument(SVG_NAMESPACE, 'svg');
  function copy(input: Element, target: Element) {
    if (input.namespaceURI !== SVG_NAMESPACE || !tags.has(input.localName)) throw new Error(`Unsupported SVG element: ${input.localName}. Export a static SVG with basic paths and shapes.`);
    for (const attribute of Array.from(input.attributes)) {
      if (attribute.name === 'xmlns') continue;
      if (attribute.name === 'style') {
        for (const declaration of attribute.value.split(';').filter(s => s.trim())) {
          const split = declaration.indexOf(':'), name = declaration.slice(0, split).trim(), value = declaration.slice(split + 1).trim();
          if (split < 0 || !styleAttributes.has(name)) throw new Error(`Unsupported SVG style: ${name}`);
          safeValue(value); target.setAttribute(name, value);
        }
        continue;
      }
      if (attribute.namespaceURI || !attributes.has(attribute.name)) throw new Error(`Unsupported SVG attribute: ${attribute.name}`);
      safeValue(attribute.value); target.setAttribute(attribute.name, attribute.value);
    }
    for (const child of Array.from(input.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) { const next = output.createElementNS(SVG_NAMESPACE, (child as Element).localName); copy(child as Element, next); target.appendChild(next); }
      else if (child.nodeType === Node.TEXT_NODE && ['text', 'tspan', 'title', 'desc'].includes(input.localName)) target.appendChild(output.createTextNode(child.textContent ?? ''));
    }
  }
  copy(root, output.documentElement); output.documentElement.setAttribute('width', String(width)); output.documentElement.setAttribute('height', String(height));
  return { svg: new XMLSerializer().serializeToString(output), width, height };
}
export async function rasterizeElementSvg(source: string): Promise<{ blob: Blob; width: number; height: number }> {
  const safe = sanitizeElementSvg(source), url = URL.createObjectURL(new Blob([safe.svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = safe.width; canvas.height = safe.height; canvas.getContext('2d')!.drawImage(image, 0, 0);
    return { blob: await canvasPng(canvas), width: safe.width, height: safe.height };
  } finally { URL.revokeObjectURL(url); }
}
