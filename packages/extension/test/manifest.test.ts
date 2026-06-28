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
        commandPalette?: Array<{
          command: string;
          when?: string;
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
        item.command === 'launch-composer.includeConfig' &&
        item.when === 'viewItem == configEntryDisabled' &&
        item.group === '0_state@1',
    ),
  );
  assert.ok(
    itemContextMenu.some(
      (item) =>
        item.command === 'launch-composer.excludeConfig' &&
        item.when === 'viewItem == configEntryEnabled' &&
        item.group === '0_state@1',
    ),
  );
  assert.ok(
    itemContextMenu.some(
      (item) =>
        item.command === 'launch-composer.includeAllConfigs' &&
        item.when ===
          'view == launchComposer.configs && viewItem == configFile' &&
        item.group === '0_state@1',
    ),
  );
  assert.ok(
    itemContextMenu.some(
      (item) =>
        item.command === 'launch-composer.excludeAllConfigs' &&
        item.when ===
          'view == launchComposer.configs && viewItem == configFile' &&
        item.group === '0_state@2',
    ),
  );
  assert.ok(
    itemContextMenu.every(
      (item) =>
        item.command !== 'launch-composer.includeConfig' ||
        !(item.when ?? '').includes('configFile'),
    ),
  );
  assert.ok(
    itemContextMenu.every(
      (item) =>
        item.command !== 'launch-composer.excludeConfig' ||
        !(item.when ?? '').includes('configFile'),
    ),
  );
  assert.ok(
    itemContextMenu.every(
      (item) =>
        ![
          'launch-composer.includeAllConfigs',
          'launch-composer.excludeAllConfigs',
        ].includes(item.command) ||
        !(item.when ?? '').includes('configFileInvalid'),
    ),
  );
  const inlineMenu = itemContextMenu.filter((item) => item.group === 'inline');
  assert.deepEqual(inlineMenu.map((item) => item.command).sort(), [
    'launch-composer.addConfigEntry',
    'launch-composer.addProfileEntry',
    'launch-composer.openItemJson',
  ]);

  const commandPalette = packageJson.contributes.menus?.commandPalette;
  assert.ok(commandPalette);
  assert.ok(
    commandPalette.some(
      (item) =>
        item.command === 'launch-composer.includeAllConfigs' &&
        item.when === 'false',
    ),
  );
  assert.ok(
    commandPalette.some(
      (item) =>
        item.command === 'launch-composer.excludeAllConfigs' &&
        item.when === 'false',
    ),
  );

  for (const command of packageJson.contributes.commands) {
    assert.equal(command.enablement, SINGLE_WORKSPACE_ENABLEMENT);
  }
});
