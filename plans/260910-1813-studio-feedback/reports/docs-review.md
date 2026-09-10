# Documentation review

Status: DONE
Docs impact: minor

Reviewed the assigned documentation against the shared catalog, operations, scene compositor/runtime, inspectors, screen state, and project-thumbnail source. Updated only `docs/agents.md`, `docs/architecture.md`, `docs/web-documentation.md`, and `skills/design-studio-ai/references/3d.md`.

- Replaced duplicated stale CLI release links with the root README installation route. Verified v0.3.0 CLI and skill assets through GitHub release metadata.
- Explained that catalog themes are visual starting points rather than additional component libraries or business backends.
- Documented nested component/scene replacement during operations so agents preserve unrelated transforms, mesh, rig, camera, and lighting fields.
- Preserved the scene layering boundary: depth testing within consecutive 3D segments, 2D separators, captions excluded from GLB/glTF.
- Reduced new implementation paraphrases to owning source links. Distinguished saved thumbnails from unsaved editor content.

Validation: all 98 local links and Markdown heading anchors resolve across the four files; scoped `git diff --check` passed. Opened the linked official Ant Design, shadcn/ui, Material 3, Carbon, and Atlassian reference URLs successfully. No product tests, generators, or servers started by this documentation pass; the controller owns product validation and generated public documentation.

Unresolved questions: none.
