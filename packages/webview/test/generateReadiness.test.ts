import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GENERATE_READINESS,
  formatValidationError,
  getEditorDiagnostics,
  getEntryIssueDiagnostics,
  getFieldDiagnosticMessages,
  mergeHelperMessages,
  mergeWorkspaceUpdatePayload,
  normalizeInitialDataPayload,
  normalizeGenerateReadiness,
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

test('normalizeGenerateReadiness fills missing diagnostics for old persisted state', () => {
  assert.deepEqual(
    normalizeGenerateReadiness({
      ready: false,
      errors: [
        {
          file: 'profile.json',
          field: 'configuration.type',
          message: 'Profile type is required.',
        },
      ],
    }),
    {
      ready: false,
      errors: [
        {
          file: 'profile.json',
          field: 'configuration.type',
          message: 'Profile type is required.',
        },
      ],
      diagnostics: [],
    },
  );
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
        diagnostics: [
          {
            severity: 'error',
            source: 'core-validation',
            file: 'config.json',
            field: 'profile',
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
    ready: false,
    errors: [
      {
        file: 'config.json',
        configName: 'Launch',
        field: 'profile',
        message: 'Config profile is required.',
      },
    ],
    diagnostics: [
      {
        severity: 'error',
        source: 'core-validation',
        file: 'config.json',
        field: 'profile',
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

test('getEditorDiagnostics filters diagnostics to the current editor target', () => {
  const diagnostics = getEditorDiagnostics(
    {
      ready: false,
      errors: [],
      diagnostics: [
        {
          severity: 'error',
          source: 'core-validation',
          file: 'profile.json',
          field: 'configuration.type',
          message: 'Profile type is required.',
          target: {
            kind: 'profile',
            index: 0,
            name: 'node',
            field: 'configuration.type',
          },
        },
        {
          severity: 'error',
          source: 'core-validation',
          file: 'profile.json',
          field: 'configuration.request',
          message: 'Profile request must be one of: launch, attach.',
          target: {
            kind: 'profile',
            index: 1,
            name: 'attach',
            field: 'configuration.request',
          },
        },
        {
          severity: 'error',
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
      severity: 'error',
      source: 'core-validation',
      file: 'config.json',
      field: 'profile',
      message: 'Config profile is required.',
      target: {
        kind: 'config',
        index: 0,
        name: 'Launch',
        field: 'profile',
      },
    },
    {
      severity: 'error',
      source: 'core-validation',
      file: 'config.json',
      field: 'configuration.program',
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
