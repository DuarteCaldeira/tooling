const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
]);
const GENERATED_DIRS = ['dist', 'coverage'];
const ENV_TEMPLATE = /\.(example|sample|template)(\.|$)/;

export function blockReason(path) {
  if (!path) return undefined;
  // Split on both separators: Windows paths reach the hook whatever OS runs it (and the tests).
  const segments = path.split(/[\\/]/);
  const name = segments.at(-1);
  if (/^\.env(\..+)?$/.test(name) && !ENV_TEMPLATE.test(name))
    return `${name} holds secrets. Ask the user to edit it; edit a .env.example instead.`;
  if (LOCKFILES.has(name))
    return `${name} is generated. Change package.json and run the package manager instead.`;
  const dir = GENERATED_DIRS.find((d) => segments.slice(0, -1).includes(d));
  if (dir) return `${dir}/ is build output. Change the source and rebuild instead.`;
  return undefined;
}

// Shell forms that write to a file named in the command. Reading (`cat .env`) stays allowed, and
// package-manager runs that rewrite lockfiles never name them, so they stay allowed too.
const WRITE_TARGETS = [
  />>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g, // > file, >> file
  /\btee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g,
  /\bsed\s+(?:-[a-zA-Z]*i[a-zA-Z]*|--in-place)\S*\s+.*?("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:$|[;&|])/g,
  /\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g,
  /\b(?:Set-Content|Add-Content|Out-File)\b.*?-(?:Path|FilePath|LiteralPath)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/gi,
  // Positional form: `Set-Content .env x`, `'x' | Out-File -Encoding utf8 .env`.
  /\b(?:Set-Content|Add-Content|Out-File)\s+(?:-\w+\s+[^\s-]\S*\s+)*("[^"]+"|'[^']+'|[^\s;&|-][^\s;&|]*)/gi,
];

/** Reason to block a shell command that writes to a protected file, or undefined. */
export function bashBlockReason(command) {
  if (!command) return undefined;
  for (const pattern of WRITE_TARGETS)
    for (const match of command.matchAll(pattern)) {
      const target = match[1].replace(/^["']|["']$/g, '');
      if (target === '/dev/null' || target.startsWith('&')) continue;
      const reason = blockReason(target);
      if (reason) return reason;
    }
  return undefined;
}
