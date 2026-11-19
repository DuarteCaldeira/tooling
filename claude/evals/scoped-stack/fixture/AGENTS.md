# fixture

Test project.

## Repository

- Stack: Node ESM CLI in `cli/` (plain `.mjs`, no build, `node --test`); a React + Vite site in `web/`.

## Layout

| Path   | Holds                         |
| ------ | ----------------------------- |
| `cli/` | CLI code and its `*.test.mjs` |
| `web/` | marketing site (React)        |

## Commands

| Purpose   | Command                      |
| --------- | ---------------------------- |
| CLI tests | `node --test cli/*.test.mjs` |

## Constraints

- None.
