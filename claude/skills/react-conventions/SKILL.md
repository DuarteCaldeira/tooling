---
name: react-conventions
description: Conventions for React + TypeScript web apps (Vite, TanStack, SCSS Modules, Vitest, Playwright). Use before adding or changing components, hooks, state, routing, forms, styles, i18n or tests in a React/Vite project.
---

# React conventions

`AGENTS.md` holds the repo's own deltas (paths, locales, design-system package). Read it first; it wins on conflict.

## Components

- One folder per component: `Name/Name.tsx`, `Name.module.scss`, `Name.test.tsx`, `index.ts` (public API only). Import by folder, never by file.
- Extract a component for a clear responsibility, its own state or reuse — not to shorten a file. A repeated list row is its own component.
- Props focused on one job. Prefer composition over configuration-heavy props.
- No nested ternaries: early returns or a small helper. Return `null` early for hidden states.
- Route files stay thin (params, loader, lazy import). Features own rendering.

## Layouts and shells — reuse, never duplicate

- Use the layout primitive `AGENTS.md` names under Conventions (import path + props). Default when it names none: `Stack` from `@dcaldeira/design-system` — `direction="row" | "column"`, `gap`, `align`, `justify`, `wrap`, `padding`/`margin` (token or `{ x, y }`), `width`/`height`, and `as` for the semantic element (`main`, `header`, `nav`, `section`, `aside`, `footer`, `ul`, `form` …). Some repos keep their own kit's `Stack` (e.g. `@/components/ui`): use that one there, never mix both.
- Nest `Stack`s instead of writing wrapper `div`s with `display: flex`, `gap`, `align-items`, `justify-content` or padding in SCSS. A `.module.scss` class for layout is allowed only for what `Stack` cannot express (grid areas, sticky/fixed position, max-width containers) — and then once, in a shared layout component. The `layout-css` style rule in `tooling` reports violations when the repo enables it.
- One app shell (`AppShell` / `Layout` in the app or shared components) owns header, navigation and content frame. Pages render inside it; they never re-create header/sidebar/padding.
- Repeated page frames (title + actions + content, section with heading, card grid, empty state) become one shared component the second time they appear. Search `components/` and the design system before creating one.
- Before adding a layout: `grep` for `display: flex`, `gap:` and similar wrappers in the feature; replace existing copies with the shared component in the same change when they are in scope. Existing layout CSS outside the change is a separate migration task, not part of this diff.

```tsx
<Stack as="main" direction="column" gap="lg" padding={{ x: 'md', y: 'lg' }}>
  <Stack as="header" direction="row" justify="between" align="center">
    <Text as="h1">{t('Pages.Expenses')}</Text>
    <Button>{t('Actions.Add')}</Button>
  </Stack>
  <Stack as="ul" direction="column" gap="sm">
    {rows}
  </Stack>
</Stack>
```

## State and effects

- Lowest owner first: local state → feature provider → app-wide context. One source of truth.
- Derive during render or in a pure helper; never mirror derived values into state.
- `useEffect` only to sync with something outside React. No storage, redirects or side effects in render.
- `memo` / `useMemo` / `useCallback` only for a measured problem or a stable-reference contract.

## Data

- Network and storage mechanics stay in the data layer (query hooks, repositories). Components never import the DB/HTTP client.
- Model loading, error, empty, success and permission states explicitly.
- Forms: typed form state owned by the feature (TanStack Form where the repo uses it).

## TypeScript

- Types live at the narrowest owner; share only once two call sites need it.
- `import type` for types. `as const` for literal maps and query keys.
- Discriminated unions over combinations of optional props. Narrow instead of asserting; never `as unknown as`.

## Styles (SCSS Modules)

- Order: design-system component/prop → existing mixin/helper → feature-local SCSS → new shared style only with a second user.
- Module starts with the repo's common import (e.g. `@use 'src/assets/styles/common.scss' as *;`).
- BEM: block = component name in kebab-case, `&__element`, `&--modifier`. Every styled node has its own class; no tag or descendant selectors.
- Tokens and custom properties over literals; raw colours only in the palette. Responsive via `media-*` mixins, never `matchMedia` in JS.
- Layout belongs to the parent, expressed with `Stack` props (see Layouts). No `!important`. After a style change, delete rules now owned by primitives.
- Behaviour in React, visuals in SCSS; no React state just to toggle a style a variant already expresses.

## Design and motion

- New screen, new component or redesign: load `ui-ux-pro-max:ui-ux-pro-max` (and `ui-ux-pro-max:design-system` for tokens) before writing markup; then use `taste-skill:design-taste-frontend` to critique the result. Small tweaks (a label, a spacing token, a state): skip both.
- These skills target marketing sites as much as apps. In an app, the design system, its tokens and the look of existing screens win; take their UX and hierarchy advice, never a new visual style, font or palette unless the user asked for a redesign.
- Transitions, hover states, enter/exit, micro-interactions: load `core:design-motion-principles` (create mode to build, audit mode to review). Always honour `prefers-reduced-motion`.

## Accessibility

- Native elements first: `button` for actions, `a` for navigation, labelled inputs, real headings and lists.
- Keyboard reachable, visible focus, focus restored when dialogs/drawers close. ARIA supplements, never replaces, semantics.
- Never convey state by colour alone. Icon-only controls get an accessible name.

## i18n

- Every user-facing string is a key. Add it to all locales in the same change; keep bundles structurally identical (`check:translations`).

## Tests

- Unit (Vitest): pure logic, no DOM or class-name assertions. `it.each` for tabular cases.
- Component (Vitest + Testing Library): user-observable behaviour; `screen` queries by role/label/text; MSW for HTTP; fresh `QueryClient` per test, retries off.
- Playwright: real-browser flows, responsive, visual and axe checks only. Never duplicate a lower-layer assertion. No `waitForTimeout`; wait on state.
- Fixtures from the repo's shared factory file, not ad-hoc per test.
- Two failures with the same cause: stop, report the blocker, ask.
