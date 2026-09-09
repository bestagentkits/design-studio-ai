# Presentations and slides

Read [shared layout and quality](layout-and-quality.md) first. Use this for `kind: "slides"`; inspect the `product-deck` template and any selected design system before composing.

## Story and layout

Build the narrative around the audience's decision. Give each page one main claim, a headline that states it, and evidence that supports it. Sequence context, tension, explanation, evidence, and the requested next step as the brief warrants. Preserve the requested slide count, content, and speaking intent rather than silently compressing the scope.

Use fixed page dimensions suited to the delivery screen. Establish repeated title, content, and footer zones. Flex is the default inside a zone for title/body stacks, numbered arguments, or image/caption pairs; rows or Grid can align comparisons. Absolute placement remains useful for a deliberate title composition, diagram, or background. Keep layer order and parent relationships understandable for later edits.

## Suitable elements and taste

Use editable text for headlines and takeaways, shapes for relationships, images for real evidence, and charts only with verified values and labels. The basic chart node is a bar chart using `data.labels` and `data.values`; do not imply arbitrary chart types. Keep source labels legible when needed. Put speaker context into page `notes` and verify whether the chosen delivery format carries it.

Prefer strong scale contrast and generous spacing over a wall of tiny bullets. Repeat typography and alignment across the deck, with controlled variation for chapter breaks. Let diagrams explain the claim instead of adding decorative machinery. Use the user's brand and exact wording; treat your aesthetic preferences as recommendations.

## Review and delivery

Read the deck in order at presentation scale. Check each headline's fit, short dwell-time comprehension, label/caption readability, page edges, chart labels, and consistency of recurring elements. Review the most crowded slide first. Reallocate space or split content with authorization before shrinking type. Inspect both overview rhythm and each full-size page.

`presentation.interval` and `presentation.loop` support automatic presentation timing; they are not a per-slide transition scripting language. Verify presentation controls and any interactive navigation separately from PDF output.

PDF preserves rendered pages. PowerPoint keeps supported primitive text/shapes editable, while structured layouts or complex content may rasterize. Google Slides needs authorization and supports a narrower set of native text/shapes/HTTPS images; unsupported content fails explicitly. Open the actual exported deck, count pages, inspect the busiest slide, and report what remains editable. Saving JSON alone does not prove presentation fidelity.
