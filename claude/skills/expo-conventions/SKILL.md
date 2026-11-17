---
name: expo-conventions
description: Conventions for Expo / React Native apps (Expo Router, StyleSheet, EAS, npm workspaces). Use before touching screens, navigation, native modules, storage, dependencies or builds in an Expo project.
---

# Expo conventions

`AGENTS.md` holds the repo's own deltas (workspaces, shared packages, security rules). Read it first; it wins on conflict.

## Expo changes every SDK — do not trust memory

Before using any Expo, EAS or React Native API:

1. Read the major version of `expo` in the app's `package.json`.
2. Fetch the versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, start from `https://docs.expo.dev/llms.txt` and follow its links.

## Commands

- Add packages with `npx expo install <pkg>` (SDK-compatible versions), never `npm install <pkg>`. Use `bunx` if `bun.lock` exists.
- Run Expo and EAS from the app folder (`cd apps/<app>`) or `npm run <script> -w apps/<app>`.
- EAS CLI: `npx eas-cli@latest <command>`. Diagnose with `npx expo-doctor`; fix versions with `npx expo install --fix`.
- One React and React Native version per repo (`npm ls react-native`). `overrides` only in the root `package.json`.

## Native

- `ios/` and `android/` are generated (CNG). Never edit them; configure in `app.json` / config plugins.
- A library with native code needs a development build (`eas build --profile development`); Expo Go will not load it.
- Prefer first-party Expo modules over third-party libraries.

## Routing (Expo Router)

- Every file in the app's `src/app/` is a route; `_layout.tsx` defines navigators. Non-route code stays out of `src/app/`.
- In a monorepo, a route file only re-exports its screen from the feature package.
- Import `Link`, `router`, `useLocalSearchParams` from `expo-router`. Build paths with the module's route helper, never bare strings.

## Code

- `type`, never `interface`. Small components; a screen's state and handlers move to a `use…` hook so the screen is layout only.
- Shared UI that knows no feature goes in the UI package; feature-specific UI in the feature's `components/`.
- Import shared packages by name (`@repo/ui`), never by relative path into another workspace. A package imports only what its `package.json` lists.
- Each package keeps its texts in its own messages file.

## Layouts and screens — reuse, never duplicate

- Screens are built from the UI package's layout primitives (a `Stack`-style component with `direction`, `gap`, `align`, `justify`, `padding`, and the shared screen frame). The web `@dcaldeira/design-system` `Stack` does not run on React Native.
- No per-screen `flexDirection` / `gap` / `padding` style keys that the primitive already expresses. If the UI package has no such primitive yet, add one `Stack` there (same prop names as the design system's) the first time you need it, and use it everywhere after.
- One screen shell (safe area, header, scroll container, padding) in the UI package; screens never re-create it. A frame repeated on a second screen moves to the UI package.

## Styles

- One `StyleSheet.create` per file, always named `styles`.
- Keys: BEM in identifier form — `<block>__<element>`, block = component name in camelCase, root = bare block.
- States and variants are not keys: compose them in the `style` array.

## Design and motion

- New screen, new component or redesign: load `ui-ux-pro-max:ui-ux-pro-max`, then `taste-skill:design-taste-frontend` to critique the result; skip both for small tweaks. The UI package's primitives, tokens and existing screens win; never introduce a new visual style unless asked.
- Animations and gestures: load `core:design-motion-principles`; honour the OS reduce-motion setting (`AccessibilityInfo.isReduceMotionEnabled`).

## Storage and privacy

- Device storage only through the module's scoped storage helper. A new storage location needs a negative test in the security suite.
- No `console.*` (lint error). Never log or display personal data, credentials or raw backend errors.
- Never add a server, account, tracker or network call that sends user data unless `AGENTS.md` allows it.

## Done

- Lint and typecheck green (`npx expo lint`, `npx tsc --noEmit`, or the repo's `check` script), `expo-doctor` clean. Report what you could not run.
