import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { packageBin, readJSON } from './shared.mjs';

const LINTABLE = /\.(c|m)?[jt]sx?$/;
const CHUNK = 50;
const TAIL_LINES = 60;
const NOT_RUN = Symbol('tooling not run');
const DEFAULT_STATE_DIR = join(tmpdir(), 'claude-core-stop');

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const editsPath = (stateDir, sessionId) =>
  join(stateDir, `${sha1(String(sessionId ?? ''))}.edited`);

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout;
}

function hasHead(root) {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', 'HEAD');
    return true;
  } catch {
    return false;
  }
}

/** Tracked files changed against HEAD plus untracked, non-ignored files that still exist. */
export function changedFiles(root) {
  const tracked = hasHead(root) ? git(root, 'diff', '--name-only', '-z', 'HEAD') : '';
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z');
  return [...new Set(`${tracked}${untracked}`.split('\0').filter(Boolean))].filter((file) =>
    existsSync(join(root, file)),
  );
}

/** Identifies the working-tree state, so an unchanged tree is not re-checked every turn. */
export function fingerprint(root, files) {
  const hash = createHash('sha1');
  if (hasHead(root)) hash.update(git(root, 'diff', 'HEAD'));
  for (const file of files) {
    const stat = statSync(join(root, file));
    hash.update(`${file}\0${stat.size}\0${stat.mtimeMs}\0`);
  }
  return hash.digest('hex');
}

const SHELLS = new Set(['Bash', 'PowerShell']);
const commandStartPath = (stateDir, sessionId) =>
  join(stateDir, `${sha1(String(sessionId ?? ''))}.command`);

/** PreToolUse body for shell tools: note when the command started, so its edits can be found after. */
export function markCommand(input, { stateDir = DEFAULT_STATE_DIR, now = Date.now() } = {}) {
  if (!SHELLS.has(input.tool_name)) return;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(commandStartPath(stateDir, input.session_id), String(now));
}

/** Changed files a shell command wrote: modified on or after the command started. */
function shellEdits(input, stateDir) {
  const startPath = commandStartPath(stateDir, input.session_id);
  if (!existsSync(startPath)) return [];
  const started = Number(readFileSync(startPath, 'utf8'));
  rmSync(startPath, { force: true });
  let root;
  try {
    root = git(input.cwd ?? process.cwd(), 'rev-parse', '--show-toplevel').trim();
  } catch {
    return [];
  }
  // 1 s slack: some file systems store mtimes with coarse precision.
  return changedFiles(root)
    .map((file) => join(root, file))
    .filter((file) => statSync(file).mtimeMs >= started - 1000);
}

/**
 * PostToolUse body: remember files Claude edited (Edit/Write, or a shell command), so the Stop
 * hook formats only Claude's files and validates only turns where Claude changed something.
 */
export function recordEdit(input, { stateDir = DEFAULT_STATE_DIR } = {}) {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const files = SHELLS.has(input.tool_name)
    ? shellEdits(input, stateDir)
    : path
      ? [resolve(input.cwd ?? process.cwd(), path)]
      : [];
  if (!files.length) return;
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(editsPath(stateDir, input.session_id), files.map((f) => `${f}\n`).join(''));
}

/** Files Claude edited since the last Stop that still exist inside `root`, repo-relative. Clears the record. */
export function takeEdits(sessionId, root, { stateDir = DEFAULT_STATE_DIR } = {}) {
  const path = editsPath(stateDir, sessionId);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  rmSync(path, { force: true });
  // Real paths on both sides: Windows 8.3 short names (NAME~1) and symlinks must not
  // make a file inside the repo look outside it.
  const realRoot = realpathSync.native(root);
  const inside = new Set();
  for (const file of lines) {
    if (!existsSync(file)) continue;
    const rel = relative(realRoot, realpathSync.native(file));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) inside.add(rel.split(sep).join('/'));
  }
  return [...inside];
}

function runNode(root, script, args, timeoutMs) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function inChunks(files, run) {
  for (let i = 0; i < files.length; i += CHUNK) run(files.slice(i, i + CHUNK));
}

/** Format, then lint-fix, files with the repo's own tools. Failures are left to `tooling`. */
export function formatFiles(root, files) {
  const prettier = packageBin(root, 'prettier');
  if (prettier)
    inChunks(files, (chunk) =>
      runNode(
        root,
        prettier,
        ['--write', '--ignore-unknown', '--log-level=warn', ...chunk],
        60_000,
      ),
    );
  const eslint = packageBin(root, 'eslint');
  const lintable = files.filter((file) => LINTABLE.test(file));
  if (eslint && lintable.length)
    inChunks(lintable, (chunk) =>
      runNode(root, eslint, ['--fix', '--no-warn-ignored', ...chunk], 120_000),
    );
}

function tail(text) {
  return text.trim().split(/\r?\n/).slice(-TAIL_LINES).join('\n');
}

/**
 * Run a Node script with a time limit. On timeout the whole process tree is killed: killing only
 * the parent would leave its test workers and `tsc` running, slowing every later run.
 */
function runTree(root, script, args, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      detached: process.platform !== 'win32', // own process group, so `kill(-pid)` reaches children
      windowsHide: true,
    });
    let output = '';
    const keep = (chunk) => (output = (output + chunk).slice(-200_000));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
    }, timeoutMs);
    const finish = (status) => {
      clearTimeout(timer);
      done({ status, output, timedOut });
    };
    child.once('error', () => finish(null));
    child.once('close', finish);
  });
}

/** npm's own CLI script next to the running Node, so npm runs without a shell or `.cmd` shim. */
function npmCli() {
  const dir = dirname(process.execPath);
  return [
    join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((path) => existsSync(path));
}

/**
 * What the Stop hook validates with: `tooling --profile=dev --changed` (without its format check)
 * when the repo has `tooling.config.json`, else the repo's own `check` npm script.
 */
export function validationCommand(root) {
  const config = readJSON(join(root, 'tooling.config.json'));
  if (config) {
    const bin = packageBin(root, '@dcaldeira/tooling', 'tooling');
    if (!bin) return undefined;
    const args = ['--profile=dev', '--changed'];
    if (config.checks?.format) args.push('--skip=format');
    return { script: bin, args, label: `tooling ${args.join(' ')}` };
  }
  const cli = readJSON(join(root, 'package.json'))?.scripts?.check && npmCli();
  return cli ? { script: cli, args: ['run', 'check'], label: 'npm run check' } : undefined;
}

/** Run the validation command. Returns a failure reason, undefined on pass, or NOT_RUN. */
export async function runTooling(root, timeoutMs) {
  const command = validationCommand(root);
  if (!command) return NOT_RUN;
  const result = await runTree(root, command.script, command.args, timeoutMs);
  if (result.timedOut)
    return `\`${command.label}\` did not finish within ${Math.round(timeoutMs / 1000)} s, so the changes are NOT validated. Run it yourself (in the background) and fix what fails.`;
  if (result.status !== 0)
    return `\`${command.label}\` failed. Fix these before finishing:\n\n${tail(result.output)}`;
  return undefined;
}

/** Append one timing record to `.tooling/claude-stop.jsonl` (gitignored with `.tooling/`). */
function logTiming(root, entry) {
  const dir = join(root, '.tooling');
  if (!existsSync(dir)) return;
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(join(dir, 'claude-stop.jsonl'), `${line}\n`);
}

// The first failure plus one re-check of Claude's fix; then Claude must verify by hand.
const MAX_BLOCKS = 2;

/**
 * Stop-hook body. In turns where Claude edited files: formats them, then validates when the
 * working tree changed since the last run. A failure blocks the stop, and the fix is re-checked
 * once. Returns `{ decision: 'block', reason }` when Claude must keep working, otherwise undefined.
 */
export async function stopCheck(
  input,
  {
    stateDir = DEFAULT_STATE_DIR,
    timeoutMs = Number(process.env.CORE_STOP_TIMEOUT_MS) || 240_000,
  } = {},
) {
  let root;
  try {
    root = git(input.cwd ?? process.cwd(), 'rev-parse', '--show-toplevel').trim();
  } catch {
    return undefined;
  }
  const edited = takeEdits(input.session_id, root, { stateDir });
  // A turn without Claude edits (a question, a review) is not validated: a dirty tree is the user's.
  if (!edited.length) return undefined;
  formatFiles(root, edited);

  const statePath = join(stateDir, sha1(`${root}\0${input.session_id ?? ''}`));
  const blocksPath = `${statePath}.blocks`;
  const blocks =
    input.stop_hook_active && existsSync(blocksPath) ? Number(readFileSync(blocksPath, 'utf8')) : 0;
  if (blocks >= MAX_BLOCKS) return undefined;

  const files = changedFiles(root);
  if (!files.length) return undefined;
  const previous = existsSync(statePath) ? readFileSync(statePath, 'utf8') : '';
  const current = fingerprint(root, files);
  if (previous === current) return undefined;

  const started = Date.now();
  const result = await runTooling(root, timeoutMs);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, current);
  if (result === NOT_RUN) return undefined;
  logTiming(root, { ms: Date.now() - started, files: files.length, passed: !result });
  if (!result) {
    rmSync(blocksPath, { force: true });
    return undefined;
  }
  writeFileSync(blocksPath, String(blocks + 1));
  const next =
    blocks + 1 < MAX_BLOCKS
      ? 'The Stop hook re-checks once after your fix.'
      : 'That was the last automatic re-check: run the command yourself and show it passes before saying the work is done.';
  return { decision: 'block', reason: `${result}\n\n${next}` };
}
