import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('extension bundle does not include the broken jsonc-parser UMD loader', async () => {
  const bundlePath = path.resolve(__dirname, '..', 'dist', 'extension.js');
  const bundle = await readFile(bundlePath, 'utf8');

  assert.doesNotMatch(bundle, /jsonc-parser\/lib\/umd\/main\.js/);
  assert.doesNotMatch(bundle, /require2\("\.\/impl\/format"\)/);
  assert.match(bundle, /jsonc-parser\/lib\/esm\/main\.js/);
});
