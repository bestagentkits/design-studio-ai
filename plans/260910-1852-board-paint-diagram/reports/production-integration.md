# Production creative integration

Current implementation/status update: [2026-09-11 checklist reconciliation](implementation-checklist-reconciliation.md). The measurements and remaining-work statements below describe their earlier execution snapshots; the reconciliation records later implementation and desktop evidence without claiming final CI, hardware or release acceptance.

2026-09-11. Branch `codex/board-paint-diagrams`, baseline `3545d18`. User approved the improved drawing demo and requested implementation. This report supersedes the earlier feasibility-only delivery status. No commit, push, merge or deployment has occurred.

## Implemented source

- Canonical v1/v2 readers, pure upgrade, typed board elements and layered painting manifests, semantic references/cycles/limits, page board/artwork embeds. Existing v1 behavior remains available; stored-v2 downgrade saves/merges fail at the observed project revision.
- Shared add-board, board element upsert/removal, add-painting and generation-checked replace-painting operations. Browser, REST, MCP, WebMCP and CLI share validators; discovery and owning documentation updated. Library composition capture rejects unsupported creative content; token application preserves roots.
- Real native Draw workspace using the approved speed-sensitive/pressure-aware ink algorithm, shapes, text, bound connectors, camera navigation and editable embedding. Text drafts commit once; native modal isolates capture listeners and restores focus.
- Real painting workspace: approved bristle/dry/wash/smudge profiles plus eraser; layers with name/order/duplicate/delete, visibility/locking, opacity, four blend modes, alpha lock and clipping. Pickup samples a frozen visible composite while writing only the selected layer. Source-key readiness prevents a fast input from using a previous layer session.
- Immutable 512px RGBA PNG tile upload, CRC/hash/dimension checks, bounded compositing, generation CAS, project/owner atomic upload reservations and bounded processing leases. Server rebuilds composites from owned tiles; uploaded previews are not trusted.
- Durable latest-eight save receipts for exact retries; monotonic v2/painting undo. Coupled source changes conflict, separate paintings can merge, composite-only server normalization does not reject an independent local source edit.
- In-flight Live responses wait while creative workspaces are open; new polling is suspended. A failed paint update retains one bounded in-memory transaction, prepared uploads are reused on retry, PNG backup and explicit discard are available. Durable cross-reload recovery is still open.
- Typed clone/reference remapping, SVG/DOM rendering, public/export projection that omits raw paint layers/tiles and hidden board content. Blank painting embeds render safely; nonblank missing composites remain explicit errors.

Executable owners: `src/shared/{schema,board-schema,painting-schema,board-operations,document-merge,paint-runtime,paint-stroke,paint-composite,paint-png,public-creative-projection}.ts`, `src/app/{creative-workspace,painting-workspace}.tsx`, `src/app/{painting-session,painting-recovery}.ts`, `server/{projects,painting-assets,asset-lifecycle,creative-save-receipts}.ts` and additive `migrations/0011-creative-asset-lifecycle.sql`.

## Review dispositions

- Failed-CAS staging/composite retention is intentional in the accepted conservative-retention model: owner/project scoped, listable, counted against quota, retained until project deletion. Deletion/GC is not enabled before reference/history protection exists. This is not claimed as completed GC or durable user recovery.
- Aggregate processing limits added before expensive work: 64 MP changed output / 512 MP source tiles and masks per save. Regression rejects five 4096² paintings with no assets or document mutation. These are admission limits, not device-performance proof.
- UI review fixes cover lost upload/merge drafts, Live response isolation, visible-layer pickup, single text undo, and blank painting rendering. A fast Chromium layer-settings regression prompted explicit source/session readiness matching.
- User authorized the previously blocked source patch on 2026-09-11. Post-compositor canonical revalidation now runs before save CAS; clone already revalidates before its final write. Creative lifecycle migration numbered 0010 to preserve upstream 0009 custom providers.

Reviews: [persistence](production-persistence-review.md), [UI](production-ui-review.md). Later fix evidence supersedes the original finding snapshots; neither review completes the nine-phase plan.

## Verification state

- Focused v2, paint math, PNG and real SQLite/FileBucket persistence checks have passed during implementation, including durable receipts, downgrade/future-revision rejection, hash/generation validation, simultaneous real-route quota reservations and source-tile publication denial.
- Build and CLI build/typecheck passed during integration. Existing ineffective dynamic-import warning remains.
- Final full suite: **207 passed**, no failures (27,358.70 ms). CLI build, typecheck and production build passed. `git diff --check` passed.
- Production browser acceptance: **8 scenario/browser executions passed**: 2 each desktop Chromium, Firefox, WebKit touch viewport and mobile Chromium. Initial combined-device invocation shared one rate-limit bucket and reached the real registration 429 limit; WebKit and mobile were rerun with separate fresh harness databases, preserving production limits. The earlier fast desktop layer-session race is fixed and its unchanged stored-blend assertion passed.
- Inspected `artifacts/painting-editor-desktop.png`, `artifacts/painting-editor-mobile.png`, and decoded `artifacts/painting-recovery.png`; the downloaded recovery PNG contains the actual painted stroke. Generated artifacts are ignored, not product source. Owned E2E listeners on ports 19203 and 19213 were closed.
- Final follow-up adds a history generation high-water mark so removed paintings restored through redo do not reuse earlier local generations, with a regression. Paint warns before browser unload while a gesture/recovery transaction exists. The full browser scenarios preceded this narrow final history/unload follow-up; its generation regression passed in the final 207-test run.
- Production E2E uses a temporary database and actual uploaded paint pixels. It injects an upload transport failure, downloads the local PNG, retries, creates a second layer, smudges visible lower-layer color, saves/reloads and checks publication source privacy. A second scenario exercises a real remote response that arrives after opening Paint.
- Physical iPad/Pencil, workload latency, production Cloudflare resource use and full export format parity have not been established. No credentials or user project data are in shared screenshots.

## Remaining accepted scope

The full plan is not marked complete. Still open: standalone Board creation; full transform/vector-handle/group/frame/clipboard workflows; all four diagram family layout/routing experiences; sticker/emoji/GIF library and animated interleaving; paint groups/mask UI, resize, selections/feather/fill, tilt, durable account-isolated recovery, worker/GPU and full-workload acceptance; server pixel-generating semantic agent commands; complete export matrix and release acceptance. Existing typed fields or feasibility helpers are not a substitute for these user workflows.

Phases 02, 03 and 06 now contain real integration work and remain in progress. Phase 01 retains performance/hardware gates. Other phases remain pending, with shared plumbing implemented where required by this slice. No scope item has been waived.
