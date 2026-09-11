import { documentSchema, type DesignDocument } from './schema';

export type CreativeDocument = Extract<DesignDocument, { schemaVersion: 2 }>;
/** Opt-in upgrade preserves legacy IDs and content; reading never upgrades storage. */
export function upgradeDocument(document: DesignDocument): CreativeDocument {
  const copy = structuredClone(document);
  return documentSchema.parse(copy.schemaVersion === 2 ? copy : { ...copy, schemaVersion: 2, boards: [], paintings: [] }) as CreativeDocument;
}

/** History restores content, never reuses a concurrency generation or downgrades a reader. */
export function restoreDocumentSnapshot(current: DesignDocument, snapshot: DesignDocument, generationFloor = 0): DesignDocument {
  const next = current.schemaVersion === 2 ? upgradeDocument(snapshot) : structuredClone(snapshot);
  if (next.schemaVersion === 2) for (const painting of next.paintings) {
    const present = current.schemaVersion === 2 ? current.paintings.find(p => p.id === painting.id) : undefined;
    if (!present || JSON.stringify(present) !== JSON.stringify(painting)) {
      painting.generation = Math.max(present?.generation ?? 0, painting.generation, generationFloor) + 1;
      // Restored pixels are unchanged; the server derives a fresh source hash on Save.
      if (painting.composite) painting.composite.generation = painting.generation;
    }
  }
  return documentSchema.parse(next);
}
