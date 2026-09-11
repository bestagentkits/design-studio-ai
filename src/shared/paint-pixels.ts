/** Straight-alpha sRGB bytes at the boundary; compositing uses premultiplied sRGB. */
export type PaintColor = readonly [number, number, number, number];
export const PAINT_TILE_SIZE = 512;
export const PAINT_ALGORITHM = 'cpu-srgb-grain-v1';
export function bounded(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid paint ${name}`);
  return value;
}
export function validateColor(color: PaintColor) {
  if (!Array.isArray(color) || color.length !== 4) throw new Error('Invalid paint color');
  color.forEach(value => bounded(value, 0, 255, 'color'));
}
export function over(bottom: PaintColor, top: PaintColor, opacity = 1): PaintColor {
  const alpha = top[3] / 255 * opacity;
  const base = bottom[3] / 255 * (1 - alpha);
  const total = alpha + base;
  return total ? [0, 1, 2].map(i => Math.round((top[i] * alpha + bottom[i] * base) / total)).concat(Math.round(total * 255)) as unknown as PaintColor : [0, 0, 0, 0];
}
/** Pickup interpolates premultiplied channels, avoiding color fringes from transparent pixels. */
export function pickup(a: PaintColor, b: PaintColor, amount: number): PaintColor {
  const wa = a[3] / 255 * (1 - amount), wb = b[3] / 255 * amount, alpha = wa + wb;
  return alpha ? [0, 1, 2].map(i => Math.round((a[i] * wa + b[i] * wb) / alpha)).concat(Math.round(alpha * 255)) as unknown as PaintColor : [0, 0, 0, 0];
}
export function grain(seed: number, x: number, y: number, stamp: number) {
  let n = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(stamp, 1274126177)) >>> 0;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967295;
}
