import { paintingSchema, type Painting } from '../shared/painting-schema';
/** History restores immutable content at a fresh generation; that does not make it a pending edit again. */
export function paintingRecoveryMatches(prepared: Painting, current: Painting): boolean {
  const content = (painting: Painting) => {
    const normalized = paintingSchema.parse(painting);
    delete normalized.composite;
    normalized.generation = 0;
    return JSON.stringify(normalized);
  };
  return content(prepared) === content(current);
}
