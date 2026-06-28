import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getEditorDiagnostics,
  getEntryIssueDiagnostics,
  getFieldDiagnosticMessages,
  mergeHelperMessages,
  mergeWorkspaceUpdatePayload,
} from '../src/components/generateReadiness.js';

const READY_TO_GENERATE = {
  diagnostics: [],
};

test('mergeWorkspaceUpdatePayload replaces generateReadiness from workspace update', () => {
  const merged = mergeWorkspaceUpdatePayload(
    {
      profiles: [],
      configs: [],
      issues: [],
      generateReadiness: READY_TO_GENERATE,
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
        diagnostics: [
          {
            source: 'core-validation',
            file: 'config.json',
            message: 'Config profile is required.',
            target: {
              kind: 'config',
              index: 0,
              name: 'Launch',
              field: 'profile',
            },
          },
        ],
      },
      editorRevision: 'rev:2',
    },
  );

  assert.deepEqual(merged?.generateReadiness, {
    diagnostics: [
      {
        source: 'core-validation',
        file: 'config.json',
        message: 'Config profile is required.',
        target: {
          kind: 'config',
          index: 0,
          name: 'Launch',
          field: 'profile',
        },
      },
    ],
  });
  assert.equal(merged?.editorRevision, 'rev:2');
});

test('getEditorDiagnostics filters diagnostics to the current editor target', () => {
  const diagnostics = getEditorDiagnostics(
    {
      diagnostics: [
        {
          source: 'core-validation',
          file: 'profile.json',
          message: 'Profile type is required.',
          target: {
            kind: 'profile',
            index: 0,
            name: 'node',
            field: 'configuration.type',
          },
        },
        {
          source: 'core-validation',
          file: 'profile.json',
          message: 'Profile request must be one of: launch, attach.',
          target: {
            kind: 'profile',
            index: 1,
            name: 'attach',
            field: 'configuration.request',
          },
        },
        {
          source: 'invalid-file',
          file: 'profile.json',
          message: 'Invalid JSON in profile.json.',
          target: { kind: 'file' },
        },
      ],
    },
    {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ['Profile type is required.'],
  );
});

test('diagnostic helpers split field messages and entry issues', () => {
  const diagnostics = [
    {
      source: 'core-validation',
      file: 'config.json',
      message: 'Config profile is required.',
      target: {
        kind: 'config',
        index: 0,
        name: 'Launch',
        field: 'profile',
      },
    },
    {
      source: 'core-validation',
      file: 'config.json',
      message: 'Config with a profile cannot override "program".',
      target: {
        kind: 'config',
        index: 0,
        name: 'Launch',
        field: 'configuration.program',
      },
    },
  ] as const;

  assert.deepEqual(getFieldDiagnosticMessages(diagnostics, 'profile'), [
    'Config profile is required.',
  ]);
  assert.deepEqual(
    getEntryIssueDiagnostics(diagnostics, ['profile']).map(
      (diagnostic) => diagnostic.message,
    ),
    ['Config with a profile cannot override "program".'],
  );
});

test('mergeHelperMessages prefers diagnostic errors and deduplicates messages', () => {
  assert.deepEqual(
    mergeHelperMessages(
      ['Profile type is required.', 'Profile type is required.'],
      ['Local helper'],
    ),
    ['Profile type is required.'],
  );
  assert.deepEqual(mergeHelperMessages([], ['Local helper', undefined]), [
    'Local helper',
  ]);
});
