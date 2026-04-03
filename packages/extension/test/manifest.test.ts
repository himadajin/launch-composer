import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CONTRIBUTED_COMMAND_IDS,
  SINGLE_WORKSPACE_ENABLEMENT,
} from '../src/commands.js';

test('package.json command contributions stay aligned with the extension implementation', async () => {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    activationEvents?: string[];
    contributes: {
      viewsContainers: {
        activitybar: Array<{
          id: string;
          title: string;
          icon: string;
        }>;
      };
      views: Record<
        string,
        Array<{
          id: string;
          name: string;
        }>
      >;
      commands: Array<{
        command: string;
        enablement?: string;
      }>;
    };
  };

  const contributedCommands = packageJson.contributes.commands.map(
    (command) => command.command,
  );

  assert.deepEqual(contributedCommands, CONTRIBUTED_COMMAND_IDS);
  assert.equal(packageJson.activationEvents, undefined);
  assert.deepEqual(packageJson.contributes.viewsContainers.activitybar, [
    {
      id: 'launchComposer',
      title: 'Launch Composer',
      icon: 'resources/launch-composer.svg',
    },
  ]);
  assert.deepEqual(packageJson.contributes.views.launchComposer, [
    {
      id: 'launchComposer.templates',
      name: 'TEMPLATES',
    },
    {
      id: 'launchComposer.configs',
      name: 'CONFIGS',
    },
  ]);
  assert.equal(packageJson.contributes.views.explorer, undefined);

  for (const command of packageJson.contributes.commands) {
    assert.equal(command.enablement, SINGLE_WORKSPACE_ENABLEMENT);
  }
});
