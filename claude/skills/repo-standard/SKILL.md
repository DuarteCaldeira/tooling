---
name: repo-standard
description: The standard layout every project follows - required files, AGENTS.md shape, CLAUDE.md, .claude/settings.json, docs structure. Use when creating a new repo, editing AGENTS.md or CLAUDE.md, or checking whether a repo matches the standard.
---

# Repo standard

## Required files

| Path                    | Content                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`             | Repo facts only, in the shape below. Process and conventions come from the plugin.                                          |
| `CLAUDE.md`             | Exactly `@AGENTS.md`                                                                                                        |
| `.claude/settings.json` | Enables the plugin (below). Committed.                                                                                      |
| `README.md`             | What it is, how to run it.                                                                                                  |
| `SECURITY.md`           | How to report issues; data the app holds.                                                                                   |
| `GLOSSARY.md`           | Domain terms (see `mattpocock-skills:domain-modeling`).                                                                     |
| `docs/`                 | `spec.md` or `areas/<area>.md` per product area, `decisions/` for ADRs.                                                     |
| `tooling.config.json`   | `@dcaldeira/tooling` checks, with `"repoStandard": true`, a `duplication` section and `styles.rules.layoutCss` (see below). |
| `.nvmrc`                | Node version.                                                                                                               |

`.gitignore` covers `.claude/settings.local.json` and `.claude/worktrees/`.
Not allowed: `.ai/` junctions, `ai-memory/`, any file that copies plugin rules into the repo.

## AGENTS.md shape

Keep it under ~120 lines. Facts the code cannot tell you; no generic advice.

```markdown
# <name>

<One sentence: what it is and who uses it.>

## Repository

- Stack: <framework + versions that matter>
- Package manager: <npm workspaces …>, Node <version>
- Hosting / services: <Vercel, Supabase, EAS …> and any cost limit

## Layout

| Path    | Holds |
| ------- | ----- |
| `src/…` | …     |

## Commands

| Purpose              | Command                                       |
| -------------------- | --------------------------------------------- |
| dev                  | `npm run dev`                                 |
| checks while working | `npx tooling --profile=dev --changed`         |
| before push          | `npx tooling --profile=push --changed --bail` |

## Conventions

- Layout primitive: `Stack` from `<import path>` (props: …) — required line
- App shell: `<path to AppShell/Layout>`

Then only where this repo differs from or adds to the plugin's stack skill
(locales and default locale, design-system package, shared helpers to reuse, naming quirks).

## Constraints

Hard rules: security, offline-first, data handling, append-only migrations,
budgets, things that need human approval.
```

## `.claude/settings.json`

Merge into an existing file; never drop keys already there.

Every repo:

```json
{
  "extraKnownMarketplaces": {
    "dcaldeira": { "source": { "source": "github", "repo": "DuarteCaldeira/tooling" } },
    "mattpocock": { "source": { "source": "github", "repo": "mattpocock/skills" } }
  },
  "enabledPlugins": {
    "core@dcaldeira": true,
    "mattpocock-skills@mattpocock": true
  }
}
```

Repos with a frontend (React, React Native, Vite, Next or Expo in the root, a workspace, any top-level folder, `apps/*` or `packages/*`) also add:

```json
{
  "extraKnownMarketplaces": {
    "ui-ux-pro-max-skill": {
      "source": { "source": "github", "repo": "nextlevelbuilder/ui-ux-pro-max-skill" }
    },
    "taste-skill": { "source": { "source": "github", "repo": "Leonxlnx/taste-skill" } }
  },
  "enabledPlugins": {
    "ui-ux-pro-max@ui-ux-pro-max-skill": true,
    "taste-skill@taste-skill": true
  }
}
```

| Plugin              | Supplies                                                             | Where                                                                                              |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mattpocock-skills` | `tdd`, `pr`, `domain-modeling` used by the workflow                  | every repo                                                                                         |
| `ui-ux-pro-max`     | UI/UX design: styles, palettes, typography, UX rules, design systems | frontend repos                                                                                     |
| `taste-skill`       | `design-taste-frontend`: critique of visual direction                | frontend repos                                                                                     |
| `caveman`           | Terse replies, `caveman-commit`                                      | the user's own `~/.claude/settings.json`, never the repo (it changes every collaborator's replies) |

Design Motion Principles ships inside `core` (`core:design-motion-principles`), since upstream is not a plugin marketplace.

## Checking a repo

`npx tooling doctor` reports drift when `tooling.config.json` sets `"repoStandard": true`. CI runs `npx tooling doctor --repo-standard` (only the standard, no local-machine checks). To bring a repo in line, use `core:adopt-repo`.

Duplication is checked mechanically too: add `"duplication": { "paths": ["src"] }` (install `jscpd`) and `"styles": { "rules": { "layoutCss": true }, "layoutPaths": ["src/app/**"] }`. A repo with a lot of existing layout CSS lists those files in `layoutPaths` (or leaves `layoutCss` off) until a separate migration removes them.
