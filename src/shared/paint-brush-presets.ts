import type { PaintBrush } from './paint-runtime';
export function paintBrushPreset(preset: string, size: number, flow: number, color: string): PaintBrush {
  const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
  const base: PaintBrush = { size, spacing: .08, flow: flow * .6, opacity: 1, texture: .3, seed: 124, color: [rgb[0], rgb[1], rgb[2], 255], pickup: .08, deposit: 1, tip: 'bristle', hardness: .9 };
  if (preset === 'erase') return { ...base, mode: 'erase', tip: 'round', flow, hardness: .7, texture: 0, pickup: 0 };
  if (preset === 'dry') return { ...base, flow: flow * .1, texture: .95, hardness: 1, pickup: 0 };
  if (preset === 'wash') return { ...base, tip: 'wash', hardness: .1, flow: flow * .09, texture: .15, pickup: .18 };
  if (preset === 'smudge') return { ...base, tip: 'wash', hardness: .2, color: [0, 0, 0, 0], flow: flow * .4, texture: .1, pickup: .65 };
  return base;
}
