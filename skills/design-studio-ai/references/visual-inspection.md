# Review real saved images

Start with the intended scope: one saved page/view/slide, all relevant pages of a project, or covers across the owner's workspace. Read the saved revision first and save any local browser edits before inspecting them. Visual inspection is private and read-only: it creates no publication and makes no AI provider call.

## Choose a surface

- CLI: `dsa projects inspect PROJECT_ID --output pages.png` defaults to a project contact sheet. Add `--mode page --page 0 --revision OBSERVED_REVISION --output page.png` for the selected page. Use `dsa projects overview --output-dir review` for workspace covers.
- MCP: discover `inspect_project` and `inspect_workspace` through `tools/list`. Project input includes `projectId` and the inspection fields. Examine their returned image content blocks alongside the text metadata.
- WebMCP: discover `studio_api_post_projects_id_inspect` and `studio_api_post_projects_inspect` in the signed-in workspace or editor. The project tool accepts `parameters: {id: PROJECT_ID}` and `body: {mode: "page", pageIndex: 0, expectedRevision: OBSERVED_REVISION}`. These API tools render saved server state, including when the open editor has unsaved changes.
- REST: `POST /api/projects/{id}/inspect` and `POST /api/projects/inspect` return the same metadata with PNG base64 in `images[].data`. Decode each image to a file and open it. Discover `visualInspection` / `workspaceInspection` in `/api/schema`; use the configured server's `/docs/api` for current contracts.

CLI success metadata replaces base64 with `images[].path` and `bytes`. Actually open those files using the host's image-viewing tool. If your host cannot display images, say visual review remains unperformed instead of inferring quality from metadata or preflight findings.

## Cover the requested content

1. Review the overview to identify hierarchy, consistency, repeated layouts and missing content. Defaults return only six pages or projects, not necessarily the whole scope.
2. Follow `nextOffset` with `--offset` (or request `offset`) until null. Workspace covers select the first page of each owned project in ID order; empty results contain no items/images. Concurrent creation/deletion can change offset results. Each project has its own saved revision; this is not an atomic workspace snapshot.
3. For detailed text and spacing, inspect page mode with either `pageId` / `--page-id` or zero-based `pageIndex` / `--page`. The selectors are mutually exclusive and only valid in page mode. Without either selector, page mode uses the first page.
4. Match each item to its `projectId`, `revision`, `pageId`, `pageIndex`, and `imageIndex`. Use `bounds` for its rectangle inside a contact sheet. `width` and `height` describe the original page; the PNG may be scaled.
5. For motion, use relevant `time` / `--time` samples and review playback separately. A still frame cannot establish sound, interpolation, interactions, responsive reflow or browser compatibility.
6. Make focused corrections, save against the observed revision, and inspect again. A stale-revision error means read and reconcile; never replace the revision blindly just to get an image.

## Limits and reporting

Discover exact options in installed command help and the shared server schemas. Inspection limits are 12 items per request; time 0–3600 seconds; overview tiles 160–800 pixels; project contact sheets 1–4 columns; page longest edge 256–2048 pixels. Existing renderer asset, pixel and timeout limits still apply. Import remote media into the project first. Missing render configuration and failed rendering return errors, not substitute pictures.

Keep image files private unless sharing is authorized. Workspace output names are deterministic (`workspace-OFFSET-IMAGE_INDEX.png`) and repeated calls replace those paths; use a new directory when retaining separate review passes. Failed API requests create no image files. Report which saved revisions/pages/times you actually viewed, whether pagination covered the requested scope, and any remaining visual or rendering issue. Export and open the requested delivery format separately before claiming its fidelity.
