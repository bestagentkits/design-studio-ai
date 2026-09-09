# Design-kind guidance and README assets

Status: guidance/assets complete; observability/deep-link owning-doc sync awaiting final implementation contracts.

## Changes

- Added `skills/design-studio-ai/references/{layout-and-quality,web,slides,report,wireframe,3d,video}.md` and routing from the skill entry point.
- Guidance covers appropriate Flex/Grid/absolute choices, supported content and scene/timeline fields, typography/hierarchy, overflow recovery, human/agent review, and actual export limitations.
- Clarified whole-directory skill installation in `docs/agents.md`.
- Replaced historical README screenshot with supplied workspace hero; added a collapsible gallery for web, slides, and 3D editors with descriptive alt text.

## Evidence and verification

Read shared schema, capability validators, catalog/templates, layout resolver, browser document/component rendering, scene runtime, timeline interpolation, design checks, and server export owner before writing field/format claims.

All four original screenshots inspected: no visible credentials, email addresses, or account URLs. Visible content includes an initial avatar, demo project names and a supplied Vietnamese deck brief. Preserved supplied artwork and UI without cropping or invented replacement.

Compressed using `cwebp -q 88 -m 6 -metadata icc`; preserved full dimensions and ICC color profiles, omitted EXIF/XMP. Reopened and visually reviewed all final WebPs. `webpinfo` reports valid files:

| Asset | Dimensions | PNG bytes | WebP bytes |
| --- | --- | ---: | ---: |
| workspace.webp | 1836 × 1135 | 881773 | 118630 |
| scene-editor.webp | 1839 × 1138 | 1028509 | 147630 |
| slides-editor.webp | 1841 × 1138 | 894567 | 139554 |
| web-editor.webp | 1839 × 1138 | 892158 | 136310 |

Total 3,697,007 → 542,124 bytes, approximately 85% smaller. Small UI labels remain legible at native dimensions. No claim of final GitHub rendering or cross-browser verification.

Local Markdown target check: README, docs/agents, skill entry and seven references; no missing local paths. `git diff --check` passed for owned tracked changes. No unrelated build/test/server started for documentation-only changes.

## Integration follow-ups

No skill ZIP packaging command found in `.github/workflows`, `scripts`, or CLI manifest. Parent notified to package the complete skill directory recursively and verify references in the archive. No shared script changed by this worker.

Owning docs for observability, deployment configuration, and deep links require the final backend/route contract before wording can be verified. Public React documentation source and derived llms generation belong to parent integration.

Docs impact: minor for guidance/navigation; pending cross-module behavior sync.

Unresolved questions: none for guidance/assets; final observability and route contracts awaited from parent.

## Contract sync completion

Parent supplied the final observability/navigation contract. Updated README capability entry; docs/agents activity interpretation and CLI family; docs/architecture instrumentation boundaries/owners; docs/deployment operator access, 30-day query exclusion with bounded physical cleanup, nullable usage, runtime coverage, and optional PostHog configuration; docs/web-documentation clean workspace destinations and activity navigation; CLI README and product skill usage guidance.

Verified against `src/shared/observability.ts`, `server/observability{,-routes,-store,-queries,-posthog,-tools}.ts`, `server/types.ts`, `server/node.ts`, `packages/cli/src/observability-commands.ts`, and `src/app/workspace-navigation.ts`. Did not claim PostHog enabled or delivered, because host configuration and live receipt are separate work. Shared configuration files, public React documentation source, generators and implementation code remain parent-owned.

Reported integration concern to parent: CLI/MCP trace initially exposed scope only while REST default lookback was 7 days; traces surfaced from older events need a selectable lookback. Docs defer exact filters to live help/schema.

Repeated local-link validation across owning docs and skill references; no missing local targets. Repeated `git diff --check` passed. No app code was changed by this worker and no app tests were run here.

Status: DONE_WITH_CONCERNS. Docs impact: minor. Unresolved integration: parent packaging verification, trace lookback, generated public-documentation rebuild and runtime verification; no user question needed.
