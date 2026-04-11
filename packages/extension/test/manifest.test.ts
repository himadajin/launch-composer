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
    publisher: string;
    license: string;
    homepage: string;
    repository: {
      type: string;
      url: string;
    };
    bugs: {
      url: string;
    };
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
      menus?: {
        'view/item/context'?: Array<{
          command: string;
          when?: string;
          group?: string;
        }>;
      };
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
      id: 'launchComposer.configs',
      name: 'CONFIGS',
    },
    {
      id: 'launchComposer.profiles',
      name: 'PROFILES',
    },
  ]);
  assert.equal(packageJson.contributes.views.explorer, undefined);
  assert.equal(packageJson.publisher, 'himadajin');
  assert.equal(packageJson.license, 'MIT');
  assert.equal(
    packageJson.homepage,
    'https://github.com/himadajin/launch-composer',
  );
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'https://github.com/himadajin/launch-composer.git',
  });
  assert.deepEqual(packageJson.bugs, {
    url: 'https://github.com/himadajin/launch-composer/issues',
  });

  const itemContextMenu = packageJson.contributes.menus?.['view/item/context'];
  assert.ok(itemContextMenu);
  assert.ok(
    itemContextMenu.some(
      (item) =>
        item.command === 'launch-composer.enableConfig' &&
        item.group === '0_state@1',
    ),
  );
  assert.ok(
    itemContextMenu.some(
      (item) =>
        item.command === 'launch-composer.disableConfig' &&
        item.group === '0_state@1',
    ),
  );
  const inlineMenu = itemContextMenu.filter((item) => item.group === 'inline');
  assert.deepEqual(inlineMenu.map((item) => item.command).sort(), [
    'launch-composer.addConfigEntry',
    'launch-composer.addProfileEntry',
    'launch-composer.openItemJson',
  ]);

  for (const command of packageJson.contributes.commands) {
    assert.equal(command.enablement, SINGLE_WORKSPACE_ENABLEMENT);
  }
});
