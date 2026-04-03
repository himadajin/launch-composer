import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(packageDir, '..');
const outDir = resolve(rootDir, '.test-dist');

await mkdir(outDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: [
    'test/extension.test.ts',
    'test/manifest.test.ts',
    'test/bundle.test.ts',
  ],
  format: 'cjs',
  outdir: outDir,
  platform: 'node',
  sourcemap: 'inline',
  target: 'node20',
  alias: {
    vscode: resolve(rootDir, 'test/stubs/vscode.ts'),
  },
});
