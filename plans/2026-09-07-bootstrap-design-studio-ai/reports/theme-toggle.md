# Appearance controls

Date: 2026-09-08
Status: DONE

Implemented a shared System / Light / Dark control in the workspace and editor headers, plus an expanded control in Settings > Your account. Docs and Guide reuse the shared component through their owning agent. The workspace now links to Guide alongside Documentation.

The preference alone is persisted under `design-studio:appearance` in localStorage. System changes are followed while System is selected; manual choices override them. Other tabs receive changes through the storage event. The root-owned HTML bootstrap and React initializer apply the same preference before mounting. Dark variables cover workspace chrome, forms, dialogs, settings, and editor panels while document canvas colors retain their own theme.

The compact control uses a native popover with labeled menu radio choices, selection state, arrow/Home/End navigation, and Escape dismissal. Mobile controls fit down to 320px.

## Validation

- `npm run typecheck` passed.
- `npm run build` passed.
- Real Chromium browser checks against the existing Vite server on port 5173 verified dark selection, reload persistence, manual override of system changes, live system changes, keyboard selection, Escape dismissal, and cross-tab synchronization.
- A template SVG fill was identical before and after the interface theme change.
- No horizontal overflow at 320px and 375px; the appearance popover stays within the viewport.
- A dark mobile sign-in dialog opened correctly with no page overflow.
- Docs and Guide both loaded in dark mode with the shared appearance control.
- No page JavaScript errors were observed in the primary appearance checks.

Evidence: [desktop dark](theme-home-dark.png), [mobile dark](theme-home-mobile.png).

## Limits

The local API on port 8787 was unavailable during this appearance verification, so authenticated editor/settings browser interactions were not repeated. Their integration passed type checking and build; the controller owns the final authenticated smoke. Screenshots include the truthful API connection error from the unavailable local service. No processes were started or stopped for these checks.
