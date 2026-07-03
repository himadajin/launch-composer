import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLaunchArgs, buildLaunchConfig } from '../src/merge.js';

test('buildLaunchConfig merges profile and config data directly', () => {
  assert.deepEqual(
    buildLaunchConfig(
      {
        name: 'Launch',
        profile: 'node',
        args: ['--config'],
        configuration: {
          cwd: '/workspace/app',
          env: { DEBUG: '1' },
        },
      },
      {
        name: 'node',
        args: ['--profile'],
        configuration: {
          type: 'node',
          request: 'launch',
          program: '/workspace/app/index.js',
          env: { PATH: '/usr/bin' },
        },
      },
    ),
    {
      name: 'Launch',
      type: 'node',
      request: 'launch',
      program: '/workspace/app/index.js',
      cwd: '/workspace/app',
      env: { DEBUG: '1' },
      args: ['--profile', '--config'],
    },
  );
});

test('buildLaunchArgs rejects profile args combined with argsFile args', () => {
  assert.throws(
    () => buildLaunchArgs(['--profile'], ['--file'], undefined),
    /profile\.args and argsFile cannot be used together/,
  );
});

test('buildLaunchConfig rejects invalid debug request values', () => {
  assert.throws(
    () =>
      buildLaunchConfig(
        {
          name: 'Launch',
          profile: 'node',
        },
        {
          name: 'node',
          configuration: {
            type: 'node',
            request: 'start',
          },
        },
      ),
    /Debug request must be "launch" or "attach"/,
  );
});
