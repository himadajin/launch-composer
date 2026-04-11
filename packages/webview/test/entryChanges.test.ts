import assert from 'node:assert/strict';
import test from 'node:test';

import {
  updateConfigArgsFile,
  updateConfigProfile,
  updateProfileProgram,
} from '../src/components/entryChanges.js';

test('updateProfileProgram emits a leaf configuration patch', () => {
  const change = updateProfileProgram(
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

test('updateProfileProgram skips patches when the value is unchanged', () => {
  const change = updateProfileProgram(
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

test('updateConfigProfile emits a direct profile patch', () => {
  const change = updateConfigProfile(
    {
      name: 'Launch',
      enabled: true,
      profile: 'old-profile',
      configuration: {
        cwd: '${workspaceFolder}',
      },
    },
    'base-profile',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    enabled: true,
    profile: 'base-profile',
    configuration: {
      cwd: '${workspaceFolder}',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['profile'],
      value: 'base-profile',
    },
  ]);
  assert.equal(
    change.patches.some((patch) => patch.path[0] === 'name'),
    false,
  );
});

test('updateConfigProfile omits patches when the selected profile is unchanged', () => {
  const change = updateConfigProfile(
    {
      name: 'Launch',
      profile: 'base-profile',
      configuration: {
        cwd: '${workspaceFolder}',
      },
    },
    'base-profile',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    profile: 'base-profile',
    configuration: {
      cwd: '${workspaceFolder}',
    },
  });
  assert.deepEqual(change.patches, []);
});

test('updateConfigArgsFile omits patches when clearing an already-empty value', () => {
  const change = updateConfigArgsFile(
    {
      name: 'Launch',
      enabled: true,
      profile: 'cpp',
    },
    '   ',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    enabled: true,
    profile: 'cpp',
  });
  assert.deepEqual(change.patches, []);
});
