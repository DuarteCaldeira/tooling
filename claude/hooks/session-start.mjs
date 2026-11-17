import { readFileSync } from 'node:fs';
import { detectStack, SKILLS } from './lib/detect.mjs';
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

const rules = readFileSync(new URL('../core-rules.md', import.meta.url), 'utf8').trim();
const skills = [...new Set(detected.stacks.map((stack) => SKILLS[stack]).filter(Boolean))];
const lines = [
  rules,
  '',
  `Detected stack: ${detected.stacks.join(' + ') || 'unknown JS'}.`,
  skills.length ? `Load before writing code in that stack: ${skills.join(', ')}.` : '',
  detected.tooling
    ? 'Checks: `@dcaldeira/tooling` (`tooling.config.json`). The Stop hook formats the files you edited and runs `tooling --profile=dev --changed`.'
    : 'No `tooling.config.json`: run the repo’s own lint, typecheck and test scripts before declaring done.',
].filter(Boolean);

// The same script serves SubagentStart (`--subagent`), so planner/reviewer/tester see the rules too.
const hookEventName = subagent ? 'SubagentStart' : 'SessionStart';
emit({ hookSpecificOutput: { hookEventName, additionalContext: lines.join('\n') } });
