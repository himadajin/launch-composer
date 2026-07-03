import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(packageDir, '..');
const outDir = resolve(rootDir, '.test-dist');
const testDir = resolve(rootDir, 'test');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const entryPoints = (await readdir(testDir))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => `test/${file}`);

await build({
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints,
  format: 'esm',
  outdir: outDir,
  platform: 'node',
  sourcemap: 'inline',
  target: 'node20',
});
