import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [source = 'playwright-report', destination = '.tooling/report/visual'] =
  process.argv.slice(2);
if (!existsSync(join(source, 'index.html'))) {
  console.error(`Missing Playwright HTML report: ${source}`);
  process.exitCode = 1;
} else {
  mkdirSync(destination, { recursive: true });
  cpSync(resolve(source), resolve(destination), { recursive: true });
  console.log(`Visual report: ${join(destination, 'index.html')}`);
}
