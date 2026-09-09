# Shared layout and quality decisions

Use this with the reference for the document's `kind`. These are design judgments, not extra validator rules. Preserve approved copy, data, brand, and scope; do not delete requested content to make a composition fit.

## Inspect the real contract

Read `dsa schema`, `dsa schema --operations`, and the relevant `dsa catalog` or design-system definition before editing. The document and operation validators are authoritative. A property accepted in the open-ended `style`, `data`, or component `props` record is not automatically implemented by every renderer. Verify it in the preview and intended export.

The source owners are [schema](https://github.com/bestagentkits/design-studio-ai/blob/main/src/shared/schema.ts), [layout and scene validators](https://github.com/bestagentkits/design-studio-ai/blob/main/src/shared/design-capabilities.ts), [browser layout](https://github.com/bestagentkits/design-studio-ai/blob/main/src/app/document-view.tsx), [static layout](https://github.com/bestagentkits/design-studio-ai/blob/main/src/shared/layout.ts), and [component rendering](https://github.com/bestagentkits/design-studio-ai/blob/main/src/app/design-component.tsx). For a self-hosted or older server, use its live schema and matching source version.

## Prefer relationships over unrelated coordinates

- Start content sections with a `frame` or `group` and `layout.mode: "flex"`; use `direction: "column"` for reading order and nested `"row"` containers for related items. Use consistent `gap` and `padding` so edits preserve rhythm.
- Keep children in `position: "flow"` unless an intentional overlay needs `"absolute"`. Connect nodes with `parentId`; this is a flat node array with explicit relationships, not nested `children` JSON.
- Use `sizing.width: "fill"` for content that should use available room, `"fixed"` for controlled media, and `"hug"` only after checking intrinsic browser sizing. Supply valid numeric `x`, `y`, `width`, and `height` even for flow nodes.
- Add `minWidth`, `maxWidth`, `minHeight`, and `maxHeight` under `sizing` when they express an actual constraint. Inspect narrow containers: minimum sizes plus gaps may exceed available space.
- Use Flex `wrap` when repeated items may move onto another line. Use `layout.mode: "grid"` with `columns` for a genuine two-dimensional comparison; the schema does not provide breakpoint-specific column counts, CSS track strings, or grid spans.
- Prefer absolute composition for a deliberate poster, slide backdrop, diagram overlay, 3D staging, or timeline motion. Do not force these into flow. Explicit container layouts opt into local coordinates; older groups without layout may retain page coordinates. Inspect before regrouping or reparenting.

## Taste and content

Choose one clear focal point per section, a limited type hierarchy, and a repeatable spacing rhythm. Use theme color tokens and `$heading` / `$body` fonts where appropriate. Let the user's brand overrule your preferred palette. Decoration should support the message; do not fill every blank area with cards, badges, gradients, or icons.

Keep final copy in text nodes, supported controls in component nodes, and imported media in asset-backed nodes. Treat prototype controls as prototypes: a button that looks actionable does not imply a working business service. Use only real data; clearly label illustrative content when the brief allows it.

## Overflow recovery and acceptance

1. Inspect every page at its native dimensions and the intended viewing size. Check long words, multilingual text, captions, labels, and expanded component states.
2. For overflow, first fix container width, flow direction, wrapping, gaps, padding, or available height. Split content across sections/pages when appropriate. Shorten copy only if authorized; reducing all text until it fits is a last resort.
3. Run `dsa projects check PROJECT_ID` / MCP `inspect_design` on the saved revision. In the browser use `studio_inspect_design` for unsaved edits. Follow returned node/page IDs; distinguish intentional cropping from lost content.
4. Resolve findings, save against the observed revision, and inspect again. The checker uses bounded estimates; it does not certify fonts, composited contrast, transformed bounds, animated extremes, responsive behavior, or accessibility.
5. Export the inspected revision and open the real artifact. Static SVG layout is not pixel-identical to browser intrinsic sizing. Structured PowerPoint content may rasterize; Google Slides has narrower native-element support. Read the main skill's export boundaries.

A pass means preserved content, readable hierarchy, deliberate spacing, no unintended clipping, valid interactions for the brief, and an inspected deliverable. Name the browsers and formats actually checked.
