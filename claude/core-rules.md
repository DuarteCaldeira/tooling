# Core rules (plugin `core@dcaldeira`)

Repo facts live in `AGENTS.md`; where it disagrees with these rules, it wins. A direct user instruction wins over both, unless it breaks a security rule.

**Scope and reuse**

- Do what was asked. No drive-by refactors, renames or polish outside the request.
- Reuse before writing: search for an existing component, hook, helper or design-system primitive first.
- No duplicated code. Logic, markup or styles needed a second time move to their owning module; every copy points at it.

**Code**

- TypeScript code: strict. No `any`; narrow `unknown`. `type`, not `interface`, unless a library needs merging.
- Validate untrusted data (API, storage, URL params, `JSON.parse`) at the boundary.
- No dead code, unused exports or commented-out code. Comments only for a non-obvious "why", one line.

<!-- frontend -->

**Frontend**

- Layouts and shells use the repo's layout primitive named in `AGENTS.md` (default: `Stack` from `@dcaldeira/design-system`). No new flex/gap wrapper CSS for what its props express. One shared app shell, never one per page.
- Derive values during render; effects only sync with external systems. A screen's state and handlers go in a `use…` hook.
- All user-facing text through i18n keys, in every locale at once.
- New screen, new component or redesign: load `ui-ux-pro-max:ui-ux-pro-max`, then `taste-skill:design-taste-frontend` as a critique of the result. Small UI tweaks: skip both. The repo's design system, tokens and existing screens win over either skill; never restyle beyond the request.
- Animation, transition, hover or micro-interaction: load `core:design-motion-principles`; respect reduced motion.
- Tests query by role/label before test ids.

<!-- /frontend -->

**Tests**

- Co-located `*.test.ts(x)`. Test behaviour once, at the lowest layer that proves it; `it.each` for many inputs.
- A fixed bug gets a regression test.

**Security**

- Never put secrets in the repo, `VITE_*` or `EXPO_PUBLIC_*`. Never log personal data or tokens.
- Never weaken a security test, lint rule, RLS policy or CI job to make something pass.

**Done means**

- Formatted; lint, types and related tests green (the Stop hook runs `tooling --profile=dev --changed`). Report what you could not run as "not verified".
- A review of a change to auth, money, personal data, API contracts or migrations (yours or the user's) goes to the `core:reviewer` agent, not an inline read.
- Workflow, commits and PRs: `core:workflow`. New or drifting repo: `core:repo-standard`.
