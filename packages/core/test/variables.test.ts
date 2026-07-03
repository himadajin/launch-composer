import assert from 'node:assert/strict';
import test from 'node:test';

import { isAbsolutePath, resolveArgsFilePath } from '../src/variables.js';

test('resolveArgsFilePath rejects unsupported variables', () => {
  assert.deepEqual(resolveArgsFilePath('${env:HOME}/args.json', {}), {
    ok: false,
    message: 'Unsupported variable "env:HOME" in argsFile path.',
  });
});

test('resolveArgsFilePath rejects missing workspaceFolder variable', () => {
  assert.deepEqual(resolveArgsFilePath('${workspaceFolder}/args.json', {}), {
    ok: false,
    message:
      'Failed to resolve "${workspaceFolder}" in argsFile path because the variable was not provided.',
  });
});

test('resolveArgsFilePath rejects unresolved relative paths', () => {
  assert.deepEqual(resolveArgsFilePath('tmp/args.json', {}), {
    ok: false,
    message:
      'argsFile must be an absolute path or start with "${workspaceFolder}".',
  });
});

test('isAbsolutePath accepts UNC paths', () => {
  assert.equal(isAbsolutePath('\\\\server\\share\\args.json'), true);
});
