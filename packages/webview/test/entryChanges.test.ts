import assert from 'node:assert/strict';
import test from 'node:test';

import {
  updateConfigArgsFile,
  updateConfigExtends,
  updateTemplateProgram,
} from '../src/components/entryChanges.js';

test('updateTemplateProgram emits a leaf configuration patch', () => {
  const change = updateTemplateProgram(
    {
      name: 'node',
      configuration: {
        type: 'node',
        request: 'launch',
        program: '${workspaceFolder}/old.js',
      },
    },
    '${workspaceFolder}/server.js',
  );

  assert.deepEqual(change.data, {
    name: 'node',
    configuration: {
      type: 'node',
      request: 'launch',
      program: '${workspaceFolder}/server.js',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['configuration', 'program'],
      value: '${workspaceFolder}/server.js',
    },
  ]);
});

test('updateTemplateProgram skips patches when the value is unchanged', () => {
  const change = updateTemplateProgram(
    {
      name: 'node',
      configuration: {
        type: 'node',
        request: 'launch',
        program: '${workspaceFolder}/server.js',
      },
    },
    '${workspaceFolder}/server.js',
  );

  assert.deepEqual(change.patches, []);
});

test('updateConfigExtends emits explicit path patches when enabling inheritance', () => {
  const change = updateConfigExtends(
    {
      name: 'Launch',
      enabled: true,
      configuration: {
        type: 'node',
        request: 'launch',
        cwd: '${workspaceFolder}',
      },
    },
    'base-template',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    enabled: true,
    extends: 'base-template',
    configuration: {
      cwd: '${workspaceFolder}',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['extends'],
      value: 'base-template',
    },
    {
      type: 'delete',
      path: ['configuration', 'type'],
    },
    {
      type: 'delete',
      path: ['configuration', 'request'],
    },
  ]);
  assert.equal(
    change.patches.some((patch) => patch.path[0] === 'name'),
    false,
  );
});

test('updateConfigExtends restores standalone launch fields with explicit patches', () => {
  const change = updateConfigExtends(
    {
      name: 'Launch',
      extends: 'base-template',
      configuration: {
        cwd: '${workspaceFolder}',
      },
    },
    undefined,
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    configuration: {
      cwd: '${workspaceFolder}',
      type: '',
      request: 'launch',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'delete',
      path: ['extends'],
    },
    {
      type: 'set',
      path: ['configuration', 'type'],
      value: '',
    },
    {
      type: 'set',
      path: ['configuration', 'request'],
      value: 'launch',
    },
  ]);
});

test('updateConfigArgsFile omits patches when clearing an already-empty value', () => {
  const change = updateConfigArgsFile(
    {
      name: 'Launch',
      enabled: true,
    },
    '   ',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    enabled: true,
  });
  assert.deepEqual(change.patches, []);
});
