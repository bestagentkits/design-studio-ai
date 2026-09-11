import {documentSchema, type DesignDocument} from './schema';

/** Compare document content, not JSON insertion order or server timestamps. */
export function documentFingerprint(document: DesignDocument): string {
  const normalized = documentSchema.parse(document);
  normalized.metadata.updatedAt = normalized.metadata.createdAt;
  return JSON.stringify(normalized, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    }
    return value;
  });
}
