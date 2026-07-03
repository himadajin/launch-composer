import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlaceholderConfig,
  createPlaceholderProfile,
  updatePayload,
} from '../src/payloadUpdates.js';
import type { InitialDataPayload } from '../src/types.js';

const READY_TO_GENERATE = {
  diagnostics: [],
};

test('updatePayload replaces the active profile entry only', () => {
  const payload = createPayload({
    editor: {
      kind: 'profile',
      file: 'profiles.json',
      index: 1,
    },
  });

  const updated = updatePayload(payload, payload.editor, {
    name: 'updated',
    configuration: {
      type: 'node',
      request: 'attach',
    },
  });

  assert.deepEqual(updated.profiles, [
    {
      file: 'profiles.json',
      profiles: [
        {
          name: 'base',
          configuration: {
            type: 'node',
            request: 'launch',
          },
        },
        {
          name: 'updated',
          configuration: {
            type: 'node',
            request: 'attach',
          },
        },
      ],
    },
    {
      file: 'other.json',
      profiles: [{ name: 'other' }],
    },
  ]);
  assert.equal(payload.profiles[0]?.profiles[1]?.name, 'second');
});

test('updatePayload replaces the active config entry only', () => {
  const payload = createPayload({
    editor: {
      kind: 'config',
      file: 'configs.json',
      index: 0,
    },
  });

  const updated = updatePayload(payload, payload.editor, {
    name: 'updated config',
    profile: 'base',
    args: ['--debug'],
  });

  assert.deepEqual(updated.configs, [
    {
      file: 'configs.json',
      configurations: [
        {
          name: 'updated config',
          profile: 'base',
          args: ['--debug'],
        },
        {
          name: 'second config',
          profile: 'base',
        },
      ],
    },
    {
      file: 'other-configs.json',
      configurations: [{ name: 'other config', profile: 'other' }],
    },
  ]);
  assert.equal(payload.configs[0]?.configurations[0]?.name, 'config');
});

test('placeholder helpers create editable default entries', () => {
  assert.deepEqual(createPlaceholderProfile('profiles.json'), {
    name: 'profiles.json',
    configuration: {
      type: '',
      request: 'launch',
    },
  });
  assert.deepEqual(createPlaceholderConfig('configs.json'), {
    name: 'configs.json',
    profile: '',
  });
});

function createPayload({
  editor,
}: {
  editor: InitialDataPayload['editor'];
}): InitialDataPayload {
  return {
    profiles: [
      {
        file: 'profiles.json',
        profiles: [
          {
            name: 'base',
            configuration: {
              type: 'node',
              request: 'launch',
            },
          },
          {
            name: 'second',
            configuration: {
              type: 'node',
              request: 'launch',
            },
          },
        ],
      },
      {
        file: 'other.json',
        profiles: [{ name: 'other' }],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          {
            name: 'config',
            profile: 'base',
          },
          {
            name: 'second config',
            profile: 'base',
          },
        ],
      },
      {
        file: 'other-configs.json',
        configurations: [{ name: 'other config', profile: 'other' }],
      },
    ],
    issues: [],
    generateReadiness: READY_TO_GENERATE,
    editor,
    editorRevision: 'rev:1',
    autoSaveDelay: 1000,
  };
}
