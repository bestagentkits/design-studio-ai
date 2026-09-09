# Web interfaces

Read [shared layout and quality](layout-and-quality.md) first. Use this for `kind: "web"`; the `studio-landing` template is a discoverable starting point, not a required aesthetic.

## Structure and suitable elements

Start with the visitor's job and one primary action. Arrange a clear introduction, useful evidence, supporting details, and a next step in a vertical Flex container. Use nested Flex rows for navigation, actions, and compact comparisons; let repeated content wrap when its minimum width requires it. Use Grid for aligned card or metric collections only when columns express meaningful comparison.

Prefer supported `component` nodes for actual prototype controls: `Button`, `Input`, `Select`, `Checkbox`, `Tabs`, or `Dialog`, with `system: "shadcn"` or `"antd"`. Discover their props rather than passing arbitrary library props. Use text nodes for content, image nodes for real imported assets, and frames/groups for layout. `interactions` can navigate to an existing page, toggle a layer, or open a safe URL; they do not implement account creation, checkout, or backend forms.

## Design choices

- Lead with concrete value and a recognizable action label. Keep secondary links visibly secondary.
- Use the selected theme/design system for typography, borders, spacing, and control treatment. Avoid mixing unrelated component styles within one task.
- Give body copy a comfortable line length, visible contrast, and room to grow. Use `sizing.width: "fill"` within bounded containers; preserve readable media proportions.
- Place decoration absolutely only when overlap is intentional and cannot block content or controls.
- Design the mobile reading order first. Pages have explicit dimensions: shrinking a whole canvas is not proof of responsive reflow. The schema has no media-query or breakpoint property; inspect intended page widths and the exported frontend instead of inventing one.

## Review and delivery

Check narrow and wide layouts, long navigation labels, focus visibility, keyboard order, touch controls, open menus/dialogs, and useful loading/empty/error copy where requested. Confirm there is no sideways overflow, hidden CTA, accidental overlap, or content loss. Test every supplied destination and identify unimplemented product behavior honestly.

React ZIP delivers a runnable frontend prototype, without a business backend. HTML can use the trusted interactive viewer; SVG is static and cannot stand in for component interaction testing. Import remote media before cloud binary rendering. Inspect the actual HTML/React output in the requested browsers, not only the editor thumbnail, and retain JSON when editability matters.
