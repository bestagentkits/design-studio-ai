import { renderLiveArtifact, type LiveArtifact } from '../shared/live-artifact';
import type { Theme } from '../shared/schema';

// Renders a validated live-artifact manifest. Content is derived from params; the
// editor re-renders it in place when a param changes (no document reload).
export function LiveArtifactView({ live, theme }: { live: LiveArtifact; theme: Theme }) {
  const view = renderLiveArtifact(live, theme);
  const accent = theme.colors.accent ?? theme.colors.primary ?? '#000000';
  return (
    <div className="live-artifact">
      <strong>{view.title}</strong>
      {view.blocks.map((block, index) => (
        <div className="live-artifact-row" key={index}>
          <span>{block.label}</span>
          <b style={block.accent ? { color: accent } : undefined}>{block.value}</b>
        </div>
      ))}
    </div>
  );
}
