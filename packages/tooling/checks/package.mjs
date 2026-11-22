import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inside } from '../runner/config.mjs';
import { invoke } from '../runner/execute.mjs';
import { detectPackageManager } from '../runner/package-manager.mjs';

export async function checkPackage(root, requiredFiles, run = invoke) {
  if (!requiredFiles.length) throw new Error('Specify required package build files');
  const missing = requiredFiles.filter((file) => {
    const path = inside(root, file);
    return !existsSync(path) || !statSync(path).isFile();
  });
  if (missing.length) throw new Error(`Package build is missing: ${missing.join(', ')}`);
  const destination = mkdtempSync(join(tmpdir(), 'tooling-pack-'));
  try {
    const result = await run(
      [detectPackageManager(root), 'pack', '--ignore-scripts', '--pack-destination', destination],
      root,
      { quiet: true },
    );
    if (result.status !== 'passed') throw new Error('Package packing failed');
    const archives = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
    if (archives.length !== 1)
      throw new Error('Package smoke check did not produce exactly one archive');
    return archives[0];
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archive = await checkPackage(process.cwd(), process.argv.slice(2));
  console.log(`Package smoke check passed (${archive}).`);
}
