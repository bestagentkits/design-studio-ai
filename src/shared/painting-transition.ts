import type { Painting } from './painting-schema';
export function assertPaintingTransition(previous: Painting, next: Painting) {
  for (const layer of previous.layers) {
    if (!layer.locked) continue;
    const replacement = next.layers.find(l => l.id === layer.id);
    if (!replacement || JSON.stringify(layer.tiles) !== JSON.stringify(replacement.tiles) || JSON.stringify(layer.mask) !== JSON.stringify(replacement.mask)) throw new Error('Unlock the layer before replacing or removing its pixels or mask.');
  }
}
