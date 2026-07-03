import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateGenerateInput,
  type ArgsFileLoadResult,
  type ConfigData,
  type GenerateInput,
  type ProfileData,
} from '../src/index.js';

test('validateGenerateInput reports profile field shape errors', async () => {
  const errors = await validateGenerateInput({
    profiles: [
      {
        file: 'profiles.json',
        profiles: [
          {
            name: '',
            args: ['--ok', 1],
            configuration: 'not an object',
          } as unknown as ProfileData,
          {
            name: 'missing launch fields',
            configuration: {},
          },
        ],
      },
    ],
    configs: [],
  });

  assert.deepEqual(
    errors.map((error) => ({
      field: error.field,
      message: error.message,
      target: error.target,
    })),
    [
      {
        field: 'name',
        message: 'Profile name is required.',
        target: { kind: 'profile', index: 0 },
      },
      {
        field: 'args',
        message: 'Profile args must be an array of strings.',
        target: { kind: 'profile', index: 0 },
      },
      {
        field: 'configuration',
        message: 'Profile configuration must be an object.',
        target: { kind: 'profile', index: 0 },
      },
      {
        field: 'configuration.request',
        message: 'Profile request must be one of: launch, attach.',
        target: { kind: 'profile', index: 1 },
      },
      {
        field: 'configuration.type',
        message: 'Profile type is required.',
        target: { kind: 'profile', index: 1 },
      },
    ],
  );
});

test('validateGenerateInput reports config field shape errors', async () => {
  const errors = await validateGenerateInput({
    profiles: [],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          {
            name: '',
            excluded: 'yes',
            profile: '',
            argsFile: 123,
            args: ['--ok', 1],
            configuration: [],
          } as unknown as ConfigData,
        ],
      },
    ],
  });

  assert.deepEqual(
    errors.map((error) => ({
      field: error.field,
      message: error.message,
      target: error.target,
    })),
    [
      {
        field: 'name',
        message: 'Config name is required.',
        target: { kind: 'config', index: 0 },
      },
      {
        field: 'excluded',
        message: 'Config excluded must be a boolean.',
        target: { kind: 'config', index: 0 },
      },
      {
        field: 'profile',
        message: 'Config profile is required.',
        target: { kind: 'config', index: 0 },
      },
      {
        field: 'argsFile',
        message: 'Config argsFile must be a string.',
        target: { kind: 'config', index: 0 },
      },
      {
        field: 'args',
        message: 'Config args must be an array of strings.',
        target: { kind: 'config', index: 0 },
      },
      {
        field: 'configuration',
        message: 'Config configuration must be an object.',
        target: { kind: 'config', index: 0 },
      },
    ],
  );
});

test('validateGenerateInput reports profile-only duplicate names', async () => {
  const errors = await validateGenerateInput({
    profiles: [
      {
        file: 'profiles.json',
        profiles: [validProfile('dup'), validProfile('dup')],
      },
    ],
    configs: [],
  });

  assert.equal(errors.length, 1);
  assert.equal(
    errors[0]?.message,
    'Profile name "dup" is defined in multiple entries: profiles.json#1, profiles.json#2',
  );
  assert.deepEqual(errors[0]?.target, { kind: 'profile', index: 0 });
});

test('validateGenerateInput reports config-only duplicate names', async () => {
  const errors = await validateGenerateInput({
    profiles: [
      {
        file: 'profiles.json',
        profiles: [validProfile('node')],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          validConfig('Launch', 'node'),
          validConfig('Launch', 'node'),
        ],
      },
    ],
  });

  assert.equal(errors.length, 1);
  assert.equal(
    errors[0]?.message,
    'Config name "Launch" is defined in multiple entries: configs.json#1, configs.json#2',
  );
  assert.deepEqual(errors[0]?.target, { kind: 'config', index: 0 });
});

test('validateGenerateInput reports missing argsFile reader', async () => {
  const errors = await validateGenerateInput(
    inputWithArgsFileConfig('/tmp/args.json'),
  );

  assert.deepEqual(
    errors.map((error) => ({
      field: error.field,
      message: error.message,
      target: error.target,
    })),
    [
      {
        field: 'argsFile',
        message:
          'argsFile was specified, but no args file reader was provided.',
        target: { kind: 'config', index: 0 },
      },
    ],
  );
});

test('validateGenerateInput reports argsFile reader failures and invalid content', async () => {
  const errors = await validateGenerateInput({
    profiles: [
      {
        file: 'profiles.json',
        profiles: [validProfile('node')],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          validConfig('Missing', 'node', '/tmp/missing.json'),
          validConfig('Default Error', 'node', '/tmp/default-error.json'),
          validConfig('Custom Error', 'node', '/tmp/custom-error.json'),
          validConfig('Invalid Shape', 'node', '/tmp/invalid-shape.json'),
        ],
      },
    ],
    readArgsFile(resolvedPath) {
      const results: Record<string, ArgsFileLoadResult> = {
        '/tmp/missing.json': { kind: 'not-found' },
        '/tmp/default-error.json': { kind: 'error' },
        '/tmp/custom-error.json': {
          kind: 'error',
          message: 'Cannot read generated args.',
        },
        '/tmp/invalid-shape.json': {
          kind: 'success',
          data: { args: ['--ok', 1] },
        },
      };

      return results[resolvedPath] ?? { kind: 'not-found' };
    },
  });

  assert.deepEqual(
    errors.map((error) => ({
      configName: error.configName,
      field: error.field,
      message: error.message,
      target: error.target,
    })),
    [
      {
        configName: 'Missing',
        field: 'argsFile',
        message: 'argsFile does not exist: /tmp/missing.json',
        target: { kind: 'config', index: 0 },
      },
      {
        configName: 'Default Error',
        field: 'argsFile',
        message: 'Failed to read argsFile: /tmp/default-error.json',
        target: { kind: 'config', index: 1 },
      },
      {
        configName: 'Custom Error',
        field: 'argsFile',
        message: 'Cannot read generated args.',
        target: { kind: 'config', index: 2 },
      },
      {
        configName: 'Invalid Shape',
        field: 'argsFile',
        message:
          'argsFile content is invalid. Expected an object with an "args" string array.',
        target: { kind: 'config', index: 3 },
      },
    ],
  );
});

function inputWithArgsFileConfig(argsFile: string): GenerateInput {
  return {
    profiles: [
      {
        file: 'profiles.json',
        profiles: [validProfile('node')],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [validConfig('Launch', 'node', argsFile)],
      },
    ],
  };
}

function validProfile(name: string): ProfileData {
  return {
    name,
    configuration: {
      type: 'node',
      request: 'launch',
    },
  };
}

function validConfig(
  name: string,
  profile: string,
  argsFile?: string,
): ConfigData {
  return {
    name,
    profile,
    ...(argsFile === undefined ? {} : { argsFile }),
  };
}
