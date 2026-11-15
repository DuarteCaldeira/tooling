import { watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

export function relevantChanges(root, files, inputs = []) {
  const declared = new Set(
    inputs.map((file) => relative(root, resolve(root, file)).replaceAll('\\', '/')),
  );
  const candidates = [...new Set(files.map((file) => file.replaceAll('\\', '/')))].filter(
    (file) => {
      if (declared.has(file)) return true;
      if (file.startsWith('.git/')) return file === '.git/HEAD' || file.startsWith('.git/refs/');
      return !file.split('/').some((part) => ['node_modules', '.tooling'].includes(part));
    },
  );
  if (!candidates.length) return [];
  let ignored = '';
  try {
    ignored = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: root,
      input: candidates.join('\0') + '\0',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.status !== 1) throw error;
    ignored = error.stdout ?? '';
  }
  const excluded = new Set(ignored.split('\0'));
  return candidates.filter(
    (file) => declared.has(file) || file.startsWith('.git/') || !excluded.has(file),
  );
}

// Only validate after filesystem events; snapshots remain authoritative inside each validation.
export function watchChanges(root, run, { inputs = () => [], signal, debounce = 350 } = {}) {
  return new Promise((resolveDone, reject) => {
    let timer,
      active,
      closed = false;
    const pending = new Set();
    const finish = (error) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      watcher.close();
      signal?.removeEventListener('abort', abort);
      Promise.resolve(active).then(() => (error ? reject(error) : resolveDone()), reject);
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!closed) timer = setTimeout(drain, debounce);
    };
    const drain = async () => {
      if (closed || active) return;
      try {
        const files = [...pending];
        pending.clear();
        if (!files.includes('*') && !relevantChanges(root, files, inputs()).length) return;
        active = Promise.resolve().then(run);
        await active;
      } catch (error) {
        finish(error);
      } finally {
        active = undefined;
        if (pending.size) schedule();
      }
    };
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      pending.add(filename?.toString() ?? '*');
      schedule();
    });
    watcher.on('error', finish);
    const abort = () => finish();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) finish();
    else {
      pending.add('*');
      schedule();
    }
  });
}
