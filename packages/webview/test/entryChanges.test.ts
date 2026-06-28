import assert from 'node:assert/strict';
import test from 'node:test';

import {
  updateConfigArgsFile,
  updateConfigEnabled,
  updateConfigProfile,
  updateProfileProgram,
  updateProfileRequest,
  updateProfileType,
} from '../src/components/entryChanges.js';

test('updateProfileType emits a required leaf configuration patch', () => {
  const change = updateProfileType(
    {
      name: 'node',
      configuration: {
        type: '',
        request: 'launch',
      },
    },
    'node',
  );

  assert.deepEqual(change.data, {
    name: 'node',
    configuration: {
      type: 'node',
      request: 'launch',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['configuration', 'type'],
      value: 'node',
    },
  ]);
});

test('updateProfileType preserves an empty required value', () => {
  const change = updateProfileType(
    {
      name: 'node',
      configuration: {
        type: 'node',
        request: 'launch',
      },
    },
    '',
  );

  assert.deepEqual(change.data, {
    name: 'node',
    configuration: {
      type: '',
      request: 'launch',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['configuration', 'type'],
      value: '',
    },
  ]);
});

test('updateProfileRequest emits a required leaf configuration patch', () => {
  const change = updateProfileRequest(
    {
      name: 'node',
      configuration: {
        type: 'node',
        request: 'launch',
      },
    },
    'attach',
  );

  assert.deepEqual(change.data, {
    name: 'node',
    configuration: {
      type: 'node',
      request: 'attach',
    },
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['configuration', 'request'],
      value: 'attach',
    },
  ]);
});

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
      profile: 'old-profile',
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
      profile: 'cpp',
    },
    '   ',
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    profile: 'cpp',
  });
  assert.deepEqual(change.patches, []);
});

test('updateConfigEnabled excludes configs with excluded true', () => {
  const change = updateConfigEnabled(
    {
      name: 'Launch',
      profile: 'cpp',
    },
    false,
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    profile: 'cpp',
    excluded: true,
  });
  assert.deepEqual(change.patches, [
    {
      type: 'set',
      path: ['excluded'],
      value: true,
    },
  ]);
});

test('updateConfigEnabled includes configs by deleting excluded', () => {
  const change = updateConfigEnabled(
    {
      name: 'Launch',
      profile: 'cpp',
      excluded: true,
    },
    true,
  );

  assert.deepEqual(change.data, {
    name: 'Launch',
    profile: 'cpp',
  });
  assert.deepEqual(change.patches, [
    {
      type: 'delete',
      path: ['excluded'],
    },
  ]);
});
