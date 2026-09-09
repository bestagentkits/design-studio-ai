# Wireframes and interaction flows

Read [shared layout and quality](layout-and-quality.md) first. Use this for `kind: "wireframe"`; inspect `app-wireframe` before deciding whether its structure fits.

## Structure and suitable elements

Clarify the user task, entry point, key decisions, and completion state. Represent separate screens as pages with meaningful names. Use Flex columns for reading order and forms, Flex rows for related controls, and Grid only for repeated content that benefits from shared columns. Start at a narrow page width. Explicit page dimensions do not create automatic breakpoints.

Use neutral text/shapes/frames for low-fidelity structure and supported components when the interaction itself matters. `Button`, `Input`, `Select`, `Checkbox`, `Radio`, `Tabs`, and `Dialog` can express familiar controls. Read their actual props through the schema and inspect the browser; accepted props are not a promise of arbitrary UI-library behavior.

Use `interactions` with `trigger: "click"` for tap-accessible navigation and toggles; hover is an optional enhancement. `action: "navigate"` targets an existing page ID, `"toggle"` targets a layer, and `"url"` opens a safe URL. Keep destination IDs grounded in the document. These interactions do not create backend validation, persistence, authentication, or payment behavior.

## Taste and fidelity

Prioritize hierarchy, labels, grouping, and feedback over final-brand polish. Keep comparable controls visually consistent. Show realistic content lengths and requested empty/error/success states without implying these are connected to a real service. Use placeholders only where the brief allows them, and identify missing real content explicitly. A restrained wireframe should make the structure easy to judge, not erase requested detail.

## Review and delivery

Walk the entire requested task by keyboard and pointer/touch. Verify start, return, alternate, cancel, and completion paths that belong to the scope. Check focus, action labels, toggled visibility, open dialogs, narrow-screen overflow, long labels, and content that appears after interaction. Do not make essential actions hover-only or use identical labels for different outcomes.

Use interactive HTML or React ZIP to review implemented prototype behavior; test the actual export. React is a frontend prototype without a business backend. PDF/PNG can document states, while static SVG cannot prove interaction behavior. Include JSON for continued editing and distinguish a designed state from a working integration.
