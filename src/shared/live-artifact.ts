import { z } from 'zod';
import type { Theme } from './schema';

// Validated live-artifact manifest stored as node data (`data.live`). A live node's
// content derives from a bounded renderer id plus scalar params; editing a param
// re-renders it without reloading the document. No arbitrary code: params are data.

export const liveArtifactSchema = z.object({
  renderer: z.enum(['kpi', 'stat-list', 'progress']),
  params: z.record(z.string().max(80), z.union([z.string().max(400), z.number(), z.boolean()])).default({}),
});
export type LiveArtifact = z.infer<typeof liveArtifactSchema>;

export interface LiveBlock { label: string; value: string; accent: boolean; }
export interface LiveView { title: string; blocks: LiveBlock[]; }

const str = (value: unknown, fallback = '') => value === undefined || value === null ? fallback : String(value);

// Deterministic manifest -> view resolution. Identical manifest + theme produce
// identical output; every param flows into a block (unit-tested).
export function renderLiveArtifact(live: LiveArtifact, _theme: Theme): LiveView {
  if (live.renderer === 'kpi') {
    return { title: str(live.params.title, 'Metric'), blocks: [{ label: str(live.params.label, 'Value'), value: str(live.params.value, '0'), accent: true }] };
  }
  if (live.renderer === 'progress') {
    const value = Number(live.params.value ?? 0);
    return { title: str(live.params.title, 'Progress'), blocks: [{ label: str(live.params.label, 'Done'), value: `${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%`, accent: true }] };
  }
  const blocks = Object.entries(live.params)
    .filter(([key]) => key !== 'title')
    .map(([label, value]) => ({ label, value: str(value), accent: false }));
  return { title: str(live.params.title, 'Stats'), blocks: blocks.length ? blocks : [{ label: 'No data', value: '—', accent: false }] };
}

// Parse a node's `data` as a live-artifact manifest. Returns the *parsed* value
// (so `params` is defaulted to {}) or null when `data.live` is absent or invalid.
export function parseLiveArtifact(data: unknown): LiveArtifact | null {
  if (typeof data !== 'object' || data === null || !('live' in data)) return null;
  const parsed = liveArtifactSchema.safeParse(data.live);
  return parsed.success ? parsed.data : null;
}
