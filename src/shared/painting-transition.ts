import type { Painting } from './painting-schema';
export function assertPaintingTransition(previous: Painting, next: Painting) {
  for (const layer of previous.layers) {
    const groupLocked = previous.groups.some(g => g.id === layer.groupId && 'locked' in g && g.locked === true);
    if (!layer.locked && !groupLocked) continue;
    if (previous.width !== next.width || previous.height !== next.height) throw new Error('Unlock layers and groups before resizing the painting.');
    const replacement = next.layers.find(l => l.id === layer.id);
    if (groupLocked && (!replacement || replacement.groupId !== layer.groupId || !next.groups.some(g => g.id === layer.groupId))) throw new Error('Unlock the group before moving or removing its layers.');
    if (!replacement || JSON.stringify(layer.tiles) !== JSON.stringify(replacement.tiles) || JSON.stringify(layer.mask) !== JSON.stringify(replacement.mask)) throw new Error('Unlock the layer before replacing or removing its pixels or mask.');
  }
}
