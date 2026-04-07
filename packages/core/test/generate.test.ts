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

test('generate shallow-merges template and config for enabled entries only', async () => {
  const result = await generate({
    templates: [
      {
        file: 'cpp.json',
        templates: [
          {
            name: 'cpp',
            type: 'cppdbg',
            request: 'launch',
            program: '${workspaceFolder}/build/myapp',
            env: { PATH: '/usr/bin' },
            args: ['--template'],
          },
        ],
      },
    ],
    configs: [
      {
        file: 'basic.json',
        enabled: true,
        configurations: [
          {
            name: 'Basic Test',
            enabled: true,
            extends: 'cpp',
            args: ['--config'],
            configuration: {
              env: { DEBUG: '1' },
              cwd: '${workspaceFolder}/test',
            },
          },
          {
            name: 'Disabled',
            enabled: false,
            extends: 'cpp',
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
        args: ['--template', '--config'],
      },
    ],
  });
});

test('generate resolves argsFile via workspaceFolder and appends config args', async () => {
  const result = await generate({
    templates: [],
    configs: [
      {
        file: 'configs.json',
        enabled: true,
        configurations: [
          {
            name: 'Replay',
            enabled: true,
            argsFile: '${workspaceFolder}/tmp/args.json',
            args: ['--debug'],
            configuration: {
              type: 'cppdbg',
              request: 'launch',
              program: '/tmp/bin/app',
            },
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
    templates: [
      {
        file: 'cpp.json',
        templates: [
          {
            name: 'cpp',
            type: 'cppdbg',
            request: 'launch',
            program: '/bin/app',
          },
          {
            name: 'cpp',
            type: 'cppdbg',
            request: 'launch',
            program: '/bin/app2',
          },
        ],
      },
    ],
    configs: [
      {
        file: 'configs.json',
        enabled: true,
        configurations: [
          {
            name: 'cpp',
            enabled: true,
            extends: 'missing',
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
    /Name "cpp" is used by multiple templates\/configs/,
  );
  assert.match(
    errors.map((error) => error.message).join('\n'),
    /unknown template/,
  );
  assert.match(
    errors.map((error) => error.message).join('\n'),
    /absolute path/,
  );
});

test('generate fails when a template request is not launch or attach', async () => {
  const result = await generate({
    templates: [
      {
        file: 'template.json',
        templates: [
          {
            name: 'cpp',
            type: 'cppdbg',
            request: 'start',
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
    /Template request must be one of/,
  );
});

test('generate fails when a standalone config request is not launch or attach', async () => {
  const result = await generate({
    templates: [],
    configs: [
      {
        file: 'config.json',
        enabled: true,
        configurations: [
          {
            name: 'Draft',
            enabled: true,
            configuration: {
              type: 'cppdbg',
              request: 'start',
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.success, false);
  if (result.success) {
    throw new Error('Expected failure');
  }

  assert.match(
    result.errors[0]?.message ?? '',
    /Config request must be one of/,
  );
});

test('generate fails when template args and config argsFile are combined', async () => {
  const result = await generate({
    templates: [
      {
        file: 'template.json',
        templates: [
          {
            name: 'cpp',
            type: 'cppdbg',
            request: 'launch',
            program: '/bin/app',
            args: ['--template'],
          },
        ],
      },
    ],
    configs: [
      {
        file: 'config.json',
        enabled: true,
        configurations: [
          {
            name: 'Test',
            enabled: true,
            extends: 'cpp',
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
});

test('generate excludes all configs when the config file is disabled', async () => {
  const result = await generate({
    templates: [],
    configs: [
      {
        file: 'config.json',
        enabled: false,
        configurations: [
          {
            name: 'Draft',
            enabled: true,
            configuration: {
              type: 'cppdbg',
              request: 'launch',
            },
          },
        ],
      },
    ],
  });

  assert.equal(result.success, true);
  if (!result.success) {
    throw new Error('Expected success');
  }

  assert.deepEqual(result.launchJson.configurations, []);
});

test('generate treats omitted enabled values as enabled', async () => {
  const result = await generate({
    templates: [],
    configs: [
      {
        file: 'config.json',
        configurations: [
          {
            name: 'Default Enabled',
            configuration: {
              type: 'cppdbg',
              request: 'launch',
            },
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
    templates: [],
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
});
