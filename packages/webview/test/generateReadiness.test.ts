import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GENERATE_READINESS,
  formatValidationError,
  mergeWorkspaceUpdatePayload,
  normalizeInitialDataPayload,
} from '../src/components/generateReadiness.js';

test('normalizeInitialDataPayload fills missing generateReadiness for persisted state', () => {
  const payload = normalizeInitialDataPayload({
    profiles: [],
    configs: [],
    issues: [],
    editor: {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
    editorRevision: null,
    autoSaveDelay: 1000,
  });

  assert.deepEqual(payload.generateReadiness, DEFAULT_GENERATE_READINESS);
});

test('mergeWorkspaceUpdatePayload replaces generateReadiness from workspace update', () => {
  const merged = mergeWorkspaceUpdatePayload(
    {
      profiles: [],
      configs: [],
      issues: [],
      generateReadiness: DEFAULT_GENERATE_READINESS,
      editor: {
        kind: 'config',
        file: 'config.json',
        index: 0,
      },
      editorRevision: 'rev:1',
      autoSaveDelay: 1000,
    },
    {
      kind: 'config',
      configs: [],
      issues: [],
      generateReadiness: {
        ready: false,
        errors: [
          {
            file: 'config.json',
            configName: 'Launch',
            field: 'profile',
            message: 'Config profile is required.',
          },
        ],
      },
      editorRevision: 'rev:2',
    },
  );

  assert.deepEqual(merged?.generateReadiness, {
    ready: false,
    errors: [
      {
        file: 'config.json',
        configName: 'Launch',
        field: 'profile',
        message: 'Config profile is required.',
      },
    ],
  });
  assert.equal(merged?.editorRevision, 'rev:2');
});

test('formatValidationError omits missing optional details', () => {
  assert.equal(
    formatValidationError({
      file: 'profile.json',
      field: 'configuration.type',
      message: 'Profile type is required.',
    }),
    'profile.json / configuration.type: Profile type is required.',
  );
  assert.equal(
    formatValidationError({
      file: 'config.json',
      configName: 'Launch',
      field: 'profile',
      message: 'Config profile is required.',
    }),
    'config.json / Launch / profile: Config profile is required.',
  );
});
