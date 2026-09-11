# Design Studio AI 0.3.3

Project thumbnails now persist on the server by saved revision. Returning to the workspace uses cached PNGs instead of rendering every design in the browser. Existing covers remain visible while a changed revision renders.

- Private, ownership-checked images stored in the existing asset bucket; latest two completed revisions retained.
- Shared isolated rendering for web, slides, motion and 3D covers, with concurrent request deduplication and deletion cleanup.
- REST thumbnail endpoint, MCP `get_project_thumbnail`, WebMCP discovery and CLI `dsa projects thumbnail ID --output cover.png --revision N`.
- Updated CLI and agent skill archives. First access to an uncached revision still requires one render.

Validation: 181 tests; eight thumbnail browser cases on desktop/mobile Chromium, Firefox and WebKit. Real storage tests cover restart, byte reuse without a renderer, revisions, authorization and deletion races.
