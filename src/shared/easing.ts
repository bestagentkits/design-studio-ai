import type { z } from 'zod';
import type { easingSchema } from './design-capabilities';
export function ease(t: number, curve: z.infer<typeof easingSchema> = 'linear'): number {
  t = Math.max(0, Math.min(1, t));
  if (t === 0 || t === 1) return t;
  if (Array.isArray(curve)) {
    const [x1, y1, x2, y2] = curve;
    const cubic = (v: number, a: number, b: number) => 3 * (1 - v) ** 2 * v * a + 3 * (1 - v) * v ** 2 * b + v ** 3;
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (cubic(mid, x1, x2) < t) low = mid; else high = mid; }
    return cubic((low + high) / 2, y1, y2);
  }
  if (curve === 'easeIn') return t * t * t;
  if (curve === 'easeOut') return 1 - (1 - t) ** 3;
  if (curve === 'easeInOut') return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  if (curve === 'step') return 0;
  if (curve === 'spring') return 1 - Math.exp(-7 * t) * Math.cos(t * Math.PI * 4.5);
  if (curve === 'bounce') {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
    return n * (t -= 2.625 / d) * t + .984375;
  }
  return t;
}
