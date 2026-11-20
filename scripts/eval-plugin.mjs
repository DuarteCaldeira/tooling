// `npm run eval:plugin -- [claude plugin eval options]`: run the core plugin's evals with the
// flags they need. On Windows, `bash` (used for each case's scaffold.sh) often resolves to WSL's
// bash.exe, which cannot open Windows paths, so Git's own bin goes first on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

export const DEFAULT_ARGS = ['--scaffold', '--judge-model', 'sonnet'];

/** `claude` arguments: the plugin dir, our defaults, then the caller's options. */
export function evalArgs(pluginDir, extra) {
  return ['plugin', 'eval', pluginDir, ...DEFAULT_ARGS, ...extra];
}

/** Git for Windows' `bin` (holds bash.exe), from `git --exec-path` (`<git>/mingw64/libexec/git-core`). */
export function gitBashDir(execPath) {
  const dir = resolve(execPath, '..', '..', '..', 'bin');
  return existsSync(join(dir, 'bash.exe')) ? dir : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
    const bin = execPath && gitBashDir(execPath);
    if (!bin) {
      console.error('eval:plugin: Git for Windows not found; case scaffolds need its bash.');
      process.exit(1);
    }
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
    env[key] = `${bin}${delimiter}${env[key] ?? ''}`;
  }
  const plugin = join(dirname(import.meta.dirname), 'claude');
  const result = spawnSync('claude', evalArgs(plugin, process.argv.slice(2)), {
    env,
    stdio: 'inherit',
  });
  if (result.error) console.error(`eval:plugin: could not start claude (${result.error.message})`);
  process.exit(result.status ?? 1);
}
