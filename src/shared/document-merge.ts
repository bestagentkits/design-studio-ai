import { documentSchema, type DesignDocument } from './schema';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keyed = (v: unknown[]): v is { id: string }[] => v.every(item => record(item) && typeof item.id === 'string');
export class MergeConflict extends Error {
  constructor(public paths: string[]) { super(`Concurrent changes conflict at: ${paths.join(', ')}`); }
}
export function mergeDocuments(base: DesignDocument, local: DesignDocument, remote: DesignDocument): DesignDocument {
  const conflicts: string[] = [];
  const merge = (b: unknown, l: unknown, r: unknown, path: string): unknown => {
    if (path === 'metadata.updatedAt') return r;
    if (same(l, b) || same(l, r)) return structuredClone(r);
    if (same(r, b)) return structuredClone(l);
    // A server-verified composite refresh does not edit the painting source.
    if (/^paintings\[[^\]]+\]$/.test(path) && record(b) && record(l) && record(r)) {
      const source = ({ composite: _preview, ...rest }: Record<string, unknown>) => rest;
      if (same(source(l), source(b)) || same(source(l), source(r))) return structuredClone(r);
      if (same(source(r), source(b))) return structuredClone(l);
    }
    // Pixels/settings and connector endpoints are coupled records, not independent fields.
    if (/^paintings\[[^\]]+\]$/.test(path) || (record(l) && l.type === 'connector' && /^boards\[[^\]]+\]\.elements\[[^\]]+\]$/.test(path))) { conflicts.push(path); return r; }
    if (record(b) && record(l) && record(r)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        const value = merge(b[key], l[key], r[key], path ? `${path}.${key}` : key); if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && keyed(b) && keyed(l) && keyed(r)) {
      const bm = new Map(b.map(v => [v.id, v])), lm = new Map(l.map(v => [v.id, v])), rm = new Map(r.map(v => [v.id, v]));
      const common = b.map(v => v.id).filter(id => lm.has(id) && rm.has(id));
      const localOrder = l.map(v => v.id).filter(id => common.includes(id)), remoteOrder = r.map(v => v.id).filter(id => common.includes(id));
      if (!same(localOrder, common) && !same(remoteOrder, common) && !same(localOrder, remoteOrder)) conflicts.push(`${path}.order`);
      const order = !same(localOrder, common) ? l.map(v => v.id) : r.map(v => v.id);
      const all = [...new Set([...order, ...l.map(v => v.id), ...r.map(v => v.id), ...bm.keys()])];
      return all.map(id => merge(bm.get(id), lm.get(id), rm.get(id), `${path}[${id}]`)).filter(v => v !== undefined);
    }
    conflicts.push(path); return r;
  };
  const result = merge(base, local, remote, '');
  if (conflicts.length) throw new MergeConflict(conflicts);
  return documentSchema.parse(result);
}
