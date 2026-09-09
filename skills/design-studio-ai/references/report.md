# Reports and documents

Read [shared layout and quality](layout-and-quality.md) first. Use this for `kind: "report"`; inspect `insight-report`, `brand-guidelines`, or `design-system` when their purpose matches the brief.

## Reading structure and layout

Start with the decision or question, then place the summary, evidence, interpretation, and next steps in a coherent reading order. Distinguish observed facts, estimates, and recommendations. Keep sources near the statements they support. Never invent numbers or citations to complete a visual.

Use explicit pages sized for the intended screen or print output. Favor Flex columns for title/body/caption groups and sections, with bounded widths and consistent `gap`/`padding`. Use Flex rows or Grid for genuine side-by-side comparisons. Preserve an editorial margin rhythm and readable text measure. The document is a designed canvas, not a word processor: do not assume automatic pagination, repeated headers, footnotes, or flowing text across pages.

## Suitable elements and taste

Use text, shapes, imported images, and simple chart nodes for actual evidence. The chart node reads `data.labels` and `data.values`; review label fit and whether a basic bar chart suits the data. A component `Table` builds prototype rows from `props.items` with ordinal values; it is not an arbitrary data-table schema. For exact analytical tables, compose the required text/cell layout or use a verified asset and retain accessible supporting text as the brief requires.

Use a small type hierarchy, restrained emphasis, consistent captions, and repeated alignment. Charts need a clear message, units, and supporting explanation. Avoid oversized decoration that displaces required evidence. Brand guidelines should demonstrate the chosen tokens and components consistently rather than mixing unrelated visual systems.

## Review and delivery

Inspect every page for clipped paragraphs, crowded source notes, orphaned headings, broken table rows, chart labels, and missing units. Check print-scale readability and page breaks. Allocate more space or add pages within the agreed scope before reducing body text. Cross-check every figure against supplied source data.

PDF is the primary page-faithful delivery choice; verify all pages in the actual file. JSON retains the editable document. PowerPoint can be useful when requested but may rasterize structured/complex content. HTML is a standalone designed document, not proof of document-editor semantics; there is no native DOCX export. Import media before cloud rendering and keep an editable source alongside the final report when requested.
