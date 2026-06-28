import test from 'node:test';
import assert from 'node:assert/strict';

import { activate } from '../src/extension.js';
import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from '../src/commands.js';
import { WorkspaceStore } from '../src/io/workspaceStore.js';
import * as vscode from 'vscode';

import {
  configFileNode,
  configFileUri,
  DEFAULT_CONFIG_TEXT,
  DEFAULT_TEMPLATE_TEXT,
  readText,
  testVscode,
  workspaceUri,
} from './helpers.js';

test.beforeEach(() => {
  testVscode.__testing.reset();
});

test('activate registers contributed commands even without a workspace folder', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;

  activate(context);

  assert.deepEqual(
    testVscode.__testing.getRegisteredCommands(),
    [...CONTRIBUTED_COMMAND_IDS].sort(),
  );

  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), [
    'Launch Composer requires exactly one workspace folder.',
  ]);
});

test('initialize creates the Launch Composer workspace directories', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/project']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getCreatedDirectories(), [
    '/workspace',
    '/workspace/project',
    '/workspace/project/.vscode',
    '/workspace/project/.vscode/launch-composer',
    '/workspace/project/.vscode/launch-composer/configs',
    '/workspace/project/.vscode/launch-composer/profiles',
  ]);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/profiles/profile.json, .vscode/launch-composer/configs/config.json).',
  ]);

  const [profileBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/project/.vscode/launch-composer/profiles/profile.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(new TextDecoder().decode(profileBytes), DEFAULT_TEMPLATE_TEXT);
  assert.equal(new TextDecoder().decode(configBytes), DEFAULT_CONFIG_TEXT);
});

test('initialize tolerates ENOENT-style missing-path errors from the filesystem', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/sample-workspace']);
  testVscode.__testing.setMissingPathErrorStyle('enoent');

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/profiles/profile.json, .vscode/launch-composer/configs/config.json).',
  ]);
});

test('initialize is idempotent when directories and default files already exist', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/existing-project']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.init);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/existing-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "existing"\n  }\n]\n'),
  );
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/profiles/profile.json, .vscode/launch-composer/configs/config.json).',
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs).',
  ]);

  const profileBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/existing-project/.vscode/launch-composer/profiles/profile.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(profileBytes),
    '[\n  {\n    "name": "existing"\n  }\n]\n',
  );
});

test('initialize creates missing child directories when composer directory exists', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  const workspaceUri = vscode.Uri.file('/workspace/partial-project');
  testVscode.__testing.setWorkspaceFolders([workspaceUri.fsPath]);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(workspaceUri, '.vscode', 'launch-composer'),
  );

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/profiles/profile.json, .vscode/launch-composer/configs/config.json).',
  ]);
});

test('initialize creates only the missing default file when one already exists', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  const workspaceUri = vscode.Uri.file('/workspace/partial-default-project');
  testVscode.__testing.setWorkspaceFolders([workspaceUri.fsPath]);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(workspaceUri, '.vscode', 'launch-composer', 'configs'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'configs',
      'config.json',
    ),
    new TextEncoder().encode(
      '{\n  "configurations": [\n    {\n      "name": "keep-me",\n      "excluded": true\n    }\n  ]\n}\n',
    ),
  );

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/profiles, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/profiles/profile.json).',
  ]);

  const [profileBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/partial-default-project/.vscode/launch-composer/profiles/profile.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/partial-default-project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(new TextDecoder().decode(profileBytes), DEFAULT_TEMPLATE_TEXT);
  assert.equal(
    new TextDecoder().decode(configBytes),
    '{\n  "configurations": [\n    {\n      "name": "keep-me",\n      "excluded": true\n    }\n  ]\n}\n',
  );
});

test('addConfig command with zero profiles shows Create Profile guidance and creates nothing', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/add-config-project']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addConfigEntry, {
    type: 'file',
    kind: 'config',
    file: 'config.json',
  });

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Create a profile before adding a config.',
  ]);

  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/add-config-project'),
  );
  const data = await store.readAll();
  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
    generateReadiness: {
      ready: true,
      errors: [],
    },
  });
});

test('addConfig command choosing Create Profile starts profile creation without auto-creating a config', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/add-config-create-profile-project',
  ]);
  testVscode.__testing.setInfoMessageResponses(['Create Profile']);
  testVscode.__testing.setQuickPickResponses([
    { label: '$(add) Create new file', value: '__create__' },
  ]);
  testVscode.__testing.setInputBoxResponses(['profile', 'cpp']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addConfigEntry, {
    type: 'file',
    kind: 'config',
    file: 'config.json',
  });

  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/add-config-create-profile-project'),
  );
  const data = await store.readAll();
  assert.deepEqual(data, {
    profiles: [
      {
        file: 'profile.json',
        profiles: [
          {
            name: 'cpp',
            configuration: {
              type: '',
              request: 'launch',
            },
          },
        ],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: {
      ready: false,
      errors: [
        {
          file: 'profile.json',
          field: 'configuration.type',
          message: 'Profile type is required.',
        },
      ],
    },
  });
});

test('addConfig command shows available profiles in selection order', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/add-config-picker-project',
  ]);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/add-config-picker-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/add-config-picker-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode(
      '[\n  {\n    "name": "cpp"\n  },\n  {\n    "name": "python"\n  }\n]\n',
    ),
  );

  testVscode.__testing.setQuickPickResponses([undefined]);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addConfigEntry, {
    type: 'file',
    kind: 'config',
    file: 'config.json',
  });

  const quickPickCall = testVscode.__testing.getLastQuickPickCall();
  assert.ok(quickPickCall !== undefined);
  assert.deepEqual(quickPickCall.items, [
    { label: 'cpp', value: 'cpp' },
    { label: 'python', value: 'python' },
  ]);
  assert.deepEqual(quickPickCall.options, {
    placeHolder: 'Select a profile',
    prompt: 'Choose a profile to use for the new config.',
  });
});

test('config tree checkbox toggles the entry excluded flag', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/config-checkbox-view']);

  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-checkbox-view'),
  );
  await store.addConfigEntry('config.json', 'Launch', 'cpp');

  activate(context);

  const configTreeView = testVscode.__testing.getCreatedTreeView(
    'launchComposer.configs',
  );
  assert.ok(configTreeView);

  await configTreeView.fireCheckboxChange({
    items: [
      [
        {
          type: 'entry',
          target: { kind: 'config', file: 'config.json', index: 0 },
          label: 'Launch',
          included: true,
        },
        vscode.TreeItemCheckboxState.Unchecked,
      ],
    ],
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/config-checkbox-view/.vscode/launch-composer/configs/config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "cpp",\n      "excluded": true\n    }\n  ]\n}\n',
  );
});

test('config file bulk commands update only the selected config file entries', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  const workspace = workspaceUri('config-bulk-command');
  testVscode.__testing.setWorkspaceFolders([workspace.fsPath]);

  const store = new WorkspaceStore(workspace);
  await store.addConfigEntry('config.json', 'Launch', 'cpp');
  await store.addConfigEntry('other.json', 'Other', 'cpp');

  activate(context);

  await vscode.commands.executeCommand(
    'launch-composer.excludeAllConfigs',
    configFileNode('config.json'),
  );

  let selectedText = await readText(configFileUri(workspace, 'config.json'));
  const otherText = await readText(configFileUri(workspace, 'other.json'));
  assert.match(selectedText, /"excluded": true/);
  assert.doesNotMatch(otherText, /"excluded"/);

  await vscode.commands.executeCommand(
    'launch-composer.includeAllConfigs',
    configFileNode('config.json'),
  );

  selectedText = await readText(configFileUri(workspace, 'config.json'));
  assert.doesNotMatch(selectedText, /"excluded"/);
});

test('copyProfileFilePath writes the backing JSON path to the clipboard', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/copy-path-project']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.copyProfileFilePath, {
    type: 'file',
    kind: 'profile',
    file: 'profile.json',
  });

  assert.equal(
    testVscode.__testing.getClipboardText(),
    '/workspace/copy-path-project/.vscode/launch-composer/profiles/profile.json',
  );
});

test('copyProfileFileRelativePath writes the workspace-relative JSON path to the clipboard', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/copy-relative-path-project',
  ]);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.copyProfileFileRelativePath, {
    type: 'file',
    kind: 'profile',
    file: 'profile.json',
  });

  assert.equal(
    testVscode.__testing.getClipboardText(),
    '.vscode/launch-composer/profiles/profile.json',
  );
});

test('addProfile initializes directories before listing files', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/add-profile-project']);
  testVscode.__testing.setQuickPickResponses([
    { label: '$(add) Create new file', value: '__create__' },
  ]);
  testVscode.__testing.setInputBoxResponses(['profiles', 'cpp']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addProfile);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/add-profile-project/.vscode/launch-composer/profiles/profiles.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '[\n  {\n    "name": "cpp",\n    "configuration": {\n      "type": "",\n      "request": "launch"\n    }\n  }\n]',
  );
});

test('sync commands only warn once per invalid file until it is fixed', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/warn-once-project']);
  testVscode.__testing.setInputBoxResponses(['extra', 'extra-two']);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/warn-once-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/warn-once-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode(''),
  );

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addProfileFile);
  await vscode.commands.executeCommand(COMMANDS.addProfileFile);

  assert.deepEqual(testVscode.__testing.getWarningMessages(), [
    'profile.json is empty. Expected a JSON array such as [].',
  ]);
});

test('generate writes an empty launch.json when no profiles or configs exist', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/generate-empty-project',
  ]);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.generate);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'launch.json was generated.',
  ]);

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file('/workspace/generate-empty-project/.vscode/launch.json'),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '// This file is auto-generated by Launch Composer.\n' +
      '// Do not edit manually. Changes will be overwritten.\n' +
      '{\n' +
      '  "version": "0.2.0",\n' +
      '  "configurations": []\n' +
      '}\n',
  );
});

test('generate tolerates FileSystemError-wrapped ENOENT when launch.json does not exist', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/generate-empty-vscode-enoent-project',
  ]);
  testVscode.__testing.setMissingPathErrorStyle('vscode-enoent');

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.generate);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'launch.json was generated.',
  ]);

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/generate-empty-vscode-enoent-project/.vscode/launch.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '// This file is auto-generated by Launch Composer.\n' +
      '// Do not edit manually. Changes will be overwritten.\n' +
      '{\n' +
      '  "version": "0.2.0",\n' +
      '  "configurations": []\n' +
      '}\n',
  );
});
