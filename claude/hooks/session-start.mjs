import { readFileSync } from 'node:fs';
import { detectStack, scopeLabel, SKILLS } from './lib/detect.mjs';
import { emit, findUp, readInput } from './lib/shared.mjs';

// Search/locator subagents only read and report locations; the rules would be pure context cost.
// Reviewers and planners keep them: they judge against the conventions.
const NO_RULES_AGENTS =
  /^(Explore|claude-code-guide|statusline-setup)$|cavecrew-investigator$|explore$/i;

const input = await readInput();
const subagent = process.argv.includes('--subagent');
if (subagent && NO_RULES_AGENTS.test(input.agent_type ?? '')) process.exit(0);
const cwd = input.cwd ?? process.cwd();
const root = findUp(cwd, '.git') ?? findUp(cwd, 'package.json') ?? cwd;
const detected = detectStack(root);
if (!detected.js) process.exit(0);

const scoped = (name, dirs) => {
  const label = scopeLabel(dirs);
  return label ? `${name} (${label})` : name;
};

// Frontend-only rules sit between `<!-- frontend -->` markers; other repos don't pay for them.
// When the frontend lives in some folders only, the section says so, so other code ignores it.
const source = readFileSync(new URL('../core-rules.md', import.meta.url), 'utf8');
const rules = (
  detected.frontend
    ? source
        .replace(/^<!-- \/?frontend -->\r?\n/gm, '')
        .replace('**Frontend**', scoped('**Frontend**', detected.where.frontend))
    : source.replace(/<!-- frontend -->[\s\S]*?<!-- \/frontend -->/g, '')
)
  .replace(/(\r?\n){3,}/g, '\n\n')
  .trim();

// One line per skill, with the folders it applies to (vite and next share react-conventions).
const skillDirs = new Map();
for (const stack of detected.stacks)
  if (SKILLS[stack])
    skillDirs.set(SKILLS[stack], [
      ...(skillDirs.get(SKILLS[stack]) ?? []),
      ...detected.where[stack],
    ]);
const skills = [...skillDirs].map(([skill, dirs]) => scoped(skill, [...new Set(dirs)]));

const lines = [
  rules,
  '',
  `Detected stack: ${detected.stacks.map((stack) => scoped(stack, detected.where[stack])).join(' + ') || 'unknown JS'}.`,
  skills.length
    ? `Load before writing code in that stack (only for files in the folders named): ${skills.join(', ')}.`
    : '',
  detected.tooling
    ? 'Checks: `@dcaldeira/tooling` (`tooling.config.json`). The Stop hook formats the files you edited and runs `tooling --profile=dev --changed`.'
    : 'No `tooling.config.json`: the Stop hook runs `npm run check` when `package.json` defines it. Otherwise run the repo’s own lint, typecheck and test scripts before declaring done.',
].filter(Boolean);

// The same script serves SubagentStart (`--subagent`), so planner/reviewer/tester see the rules too.
const hookEventName = subagent ? 'SubagentStart' : 'SessionStart';
emit({ hookSpecificOutput: { hookEventName, additionalContext: lines.join('\n') } });
