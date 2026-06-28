import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLaunchArgs,
  type ConfigFileData,
  generate,
  resolveArgsFilePath,
  validateGenerateInput,
} from '../src/index.js';

test('buildLaunchArgs follows the specified precedence rules', () => {
  assert.equal(buildLaunchArgs(undefined, undefined, undefined), undefined);
  assert.deepEqual(buildLaunchArgs(undefined, undefined, ['--debug']), [
    '--debug',
  ]);
  assert.deepEqual(buildLaunchArgs(undefined, ['-v'], undefined), ['-v']);
  assert.deepEqual(buildLaunchArgs(undefined, ['-v'], ['--debug']), [
    '-v',
    '--debug',
  ]);
  assert.deepEqual(buildLaunchArgs(['-t'], undefined, undefined), ['-t']);
  assert.deepEqual(buildLaunchArgs(['-t'], undefined, ['--debug']), [
    '-t',
    '--debug',
  ]);
});

test('generate shallow-merges profile and config for included entries only', async () => {
  const result = await generate({
    profiles: [
      {
        file: 'cpp.json',
        profiles: [
          {
            name: 'cpp',
            args: ['--profile'],
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '${workspaceFolder}/build/myapp',
              env: { PATH: '/usr/bin' },
            },
          },
        ],
      },
    ],
    configs: [
      {
        file: 'basic.json',
        configurations: [
          {
            name: 'Basic Test',
            profile: 'cpp',
            args: ['--config'],
            configuration: {
              env: { DEBUG: '1' },
              cwd: '${workspaceFolder}/test',
            },
          },
          {
            name: 'Excluded',
            excluded: true,
            profile: 'cpp',
          },
        ],
      },
    ],
  });

  assert.equal(result.success, true);
  if (!result.success) {
    throw new Error('Expected success');
  }

  assert.deepEqual(result.launchJson, {
    version: '0.2.0',
    configurations: [
      {
        name: 'Basic Test',
        type: 'cppdbg',
        request: 'launch',
        program: '${workspaceFolder}/build/myapp',
        env: { DEBUG: '1' },
        cwd: '${workspaceFolder}/test',
        args: ['--profile', '--config'],
      },
    ],
  });
});

test('generate resolves argsFile via workspaceFolder and appends config args', async () => {
  const result = await generate({
    profiles: [
      {
        file: 'profile.json',
        profiles: [
          {
            name: 'cpp',
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '/tmp/bin/app',
            },
          },
        ],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          {
            name: 'Replay',
            profile: 'cpp',
            argsFile: '${workspaceFolder}/tmp/args.json',
            args: ['--debug'],
          },
        ],
      },
    ],
    variables: {
      workspaceFolder: '/workspace/project',
    },
    readArgsFile(resolvedPath) {
      assert.equal(resolvedPath, '/workspace/project/tmp/args.json');
      return {
        kind: 'success',
        data: {
          args: ['-v', 'input.txt'],
          generatedAt: '2026-03-16T10:30:00Z',
        },
      };
    },
  });

  assert.equal(result.success, true);
  if (!result.success) {
    throw new Error('Expected success');
  }

  assert.deepEqual(result.launchJson.configurations[0]?.args, [
    '-v',
    'input.txt',
    '--debug',
  ]);
});

test('validateGenerateInput reports spec violations together', async () => {
  const errors = await validateGenerateInput({
    profiles: [
      {
        file: 'cpp.json',
        profiles: [
          {
            name: 'cpp',
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '/bin/app',
            },
          },
          {
            name: 'cpp',
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '/bin/app2',
            },
          },
        ],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        configurations: [
          {
            name: 'cpp',
            profile: 'missing',
            argsFile: 'relative/path.json',
            configuration: {
              program: '/override',
            },
          },
        ],
      },
    ],
  });

  assert.equal(errors.length, 4);
  assert.match(
    errors.map((error) => error.message).join('\n'),
    /Name "cpp" is used by multiple profiles\/configs/,
  );
  assert.match(
    errors.map((error) => error.message).join('\n'),
    /unknown profile/,
  );
  assert.match(
    errors.map((error) => error.message).join('\n'),
    /absolute path/,
  );
  assert.deepEqual(
    errors.map((error) => ({
      field: error.field,
      target: error.target,
    })),
    [
      { field: 'name', target: { kind: 'profile', index: 0 } },
      { field: 'profile', target: { kind: 'config', index: 0 } },
      {
        field: 'configuration.program',
        target: { kind: 'config', index: 0 },
      },
      { field: 'argsFile', target: { kind: 'config', index: 0 } },
    ],
  );
});

test('generate fails when a profile request is not launch or attach', async () => {
  const result = await generate({
    profiles: [
      {
        file: 'profile.json',
        profiles: [
          {
            name: 'cpp',
            configuration: {
              type: 'cppdbg',
              request: 'start',
            },
          },
        ],
      },
    ],
    configs: [],
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error('Expected failure');
  }

  assert.match(
    result.errors[0]?.message ?? '',
    /Profile request must be one of/,
  );
  assert.deepEqual(result.errors[0]?.target, {
    kind: 'profile',
    index: 0,
  });
});

test('generate fails when config.profile is missing', async () => {
  const result = await generate({
    profiles: [],
    configs: [
      {
        file: 'config.json',
        configurations: [
          {
            name: 'Draft',
            profile: '',
          },
        ],
      },
    ],
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error('Expected failure');
  }

  assert.match(result.errors[0]?.message ?? '', /Config profile is required/);
  assert.deepEqual(result.errors[0]?.target, {
    kind: 'config',
    index: 0,
  });
});

test('generate fails when profile args and config argsFile are combined', async () => {
  const result = await generate({
    profiles: [
      {
        file: 'profile.json',
        profiles: [
          {
            name: 'cpp',
            args: ['--profile'],
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '/bin/app',
            },
          },
        ],
      },
    ],
    configs: [
      {
        file: 'config.json',
        configurations: [
          {
            name: 'Test',
            profile: 'cpp',
            argsFile: '/tmp/args.json',
          },
        ],
      },
    ],
    readArgsFile() {
      return { kind: 'success', data: { args: ['--from-file'] } };
    },
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error('Expected failure');
  }

  assert.match(result.errors[0]?.message ?? '', /cannot specify argsFile/);
  assert.deepEqual(result.errors[0]?.target, {
    kind: 'config',
    index: 0,
  });
});

test('generate treats omitted excluded values as included', async () => {
  const result = await generate({
    profiles: [
      {
        file: 'profile.json',
        profiles: [
          {
            name: 'cpp',
            configuration: {
              type: 'cppdbg',
              request: 'launch',
            },
          },
        ],
      },
    ],
    configs: [
      {
        file: 'config.json',
        configurations: [
          {
            name: 'Default Enabled',
            profile: 'cpp',
          },
        ],
      },
    ],
  });

  assert.equal(result.success, true);
  if (!result.success) {
    throw new Error('Expected success');
  }

  assert.deepEqual(result.launchJson.configurations, [
    {
      name: 'Default Enabled',
      type: 'cppdbg',
      request: 'launch',
    },
  ]);
});

test('resolveArgsFilePath supports Unix and Windows absolute paths', () => {
  assert.deepEqual(resolveArgsFilePath('/tmp/args.json', {}), {
    ok: true,
    value: '/tmp/args.json',
  });
  assert.deepEqual(resolveArgsFilePath('C:\\tmp\\args.json', {}), {
    ok: true,
    value: 'C:\\tmp\\args.json',
  });
  assert.equal(
    resolveArgsFilePath('${workspaceFolder}/args.json', {
      workspaceFolder: '/workspace/project',
    }).ok,
    true,
  );
});

test('validateGenerateInput rejects legacy config array files', async () => {
  const errors = await validateGenerateInput({
    profiles: [],
    configs: [
      {
        file: 'legacy.json',
      } as unknown as ConfigFileData,
    ],
  });

  assert.match(
    errors.map((error) => error.message).join('\n'),
    /configurations must be an array/i,
  );
  assert.deepEqual(errors[0]?.target, { kind: 'configFile' });
});
