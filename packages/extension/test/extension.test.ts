import test from 'node:test';
import assert from 'node:assert/strict';

import { activate } from '../src/extension.js';
import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from '../src/commands.js';
import { WorkspaceStore } from '../src/io/workspaceStore.js';
import * as vscode from 'vscode';

const DEFAULT_TEMPLATE_TEXT =
  '// Add profile entries to this array.\n' +
  '// Each profile should have a unique "name".\n' +
  '[]\n';
const DEFAULT_CONFIG_TEXT =
  '// Configure this file and add entries to "configurations".\n' +
  '// Set "profile" to reference a profile.\n' +
  '{\n' +
  '  "enabled": true,\n' +
  '  "configurations": []\n' +
  '}\n';

const testVscode = vscode as typeof vscode & {
  __testing: {
    reset(): void;
    createExtensionContext(): unknown;
    setWorkspaceFolders(paths: string[]): void;
    setMissingPathErrorStyle(
      style: 'vscode' | 'enoent' | 'vscode-enoent',
    ): void;
    createGhostFile(filePath: string): void;
    setQuickPickResponses(responses: unknown[]): void;
    setInputBoxResponses(responses: unknown[]): void;
    setInfoMessageResponses(responses: unknown[]): void;
    getRegisteredCommands(): string[];
    getErrorMessages(): string[];
    getInfoMessages(): string[];
    getWarningMessages(): string[];
    getCreatedDirectories(): string[];
    getClipboardText(): string;
    getLastQuickPickCall():
      | {
          items: unknown[];
          options: unknown;
        }
      | undefined;
    getCreatedTreeView(id: string):
      | {
          fireCheckboxChange(event: {
            items: Array<[unknown, vscode.TreeItemCheckboxState]>;
          }): Promise<void>;
        }
      | undefined;
  };
};

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
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "keep-me",\n      "enabled": false\n    }\n  ]\n}\n',
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
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "keep-me",\n      "enabled": false\n    }\n  ]\n}\n',
  );
});

test('readAll returns empty data when Launch Composer directories do not exist', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/empty-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
  });
});

test('readAll tolerates ENOENT-style missing directories', async () => {
  testVscode.__testing.setMissingPathErrorStyle('enoent');
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/enoent-empty-project'),
  );

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
  });
});

test('readAll skips files that disappear before they can be read', async () => {
  testVscode.__testing.setMissingPathErrorStyle('vscode-enoent');
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/profiles/racy.json',
  );
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/configs/racy.json',
  );
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/racy-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    profiles: [],
    configs: [],
    issues: [],
  });
});

test('readAll keeps valid files and reports invalid files as issues', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/invalid-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode(''),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/profiles/valid.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readAll();

  assert.deepEqual(data.profiles, [
    {
      file: 'valid.json',
      profiles: [{ name: 'cpp' }],
    },
  ]);
  assert.deepEqual(data.configs, []);
  assert.deepEqual(data.issues, [
    {
      kind: 'profile',
      file: 'profile.json',
      code: 'empty',
      message: 'profile.json is empty. Expected a JSON array such as [].',
    },
  ]);
});

test('readProfilesWithIssues reads profile data without requiring config directories', async () => {
  const workspaceUri = vscode.Uri.file('/workspace/profiles-only-project');
  const store = new WorkspaceStore(workspaceUri);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(workspaceUri, '.vscode', 'launch-composer', 'profiles'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'profiles',
      'profile.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readProfilesWithIssues();

  assert.deepEqual(data, {
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'cpp' }],
      },
    ],
    issues: [],
  });
});

test('readConfigsWithIssues reads config data without requiring profile directories', async () => {
  const workspaceUri = vscode.Uri.file('/workspace/configs-only-project');
  const store = new WorkspaceStore(workspaceUri);

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
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch"\n    }\n  ]\n}\n',
    ),
  );

  const data = await store.readConfigsWithIssues();

  assert.deepEqual(data, {
    configs: [
      {
        file: 'config.json',
        enabled: true,
        configurations: [{ name: 'Launch' }],
      },
    ],
    issues: [],
  });
});

test('generateLaunchJson returns validation-style errors for invalid files', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/generate-invalid-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/generate-invalid-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/generate-invalid-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode('{'),
  );

  const result = await store.generateLaunchJson();

  assert.deepEqual(result, {
    success: false,
    errors: [
      {
        file: 'profile.json',
        message:
          'Invalid JSON in profile.json. Open the file and fix the syntax.',
      },
    ],
  });
});

test('addProfileEntry creates its backing file when it does not exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/profile-project'),
  );

  const target = await store.addProfileEntry('new-profile.json', 'cpp');

  assert.deepEqual(target, {
    kind: 'profile',
    file: 'new-profile.json',
    index: 0,
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/profile-project/.vscode/launch-composer/profiles/new-profile.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '[\n  {\n    "name": "cpp",\n    "configuration": {\n      "type": "",\n      "request": "launch"\n    }\n  }\n]',
  );
});

test('addConfigEntry creates its backing file when it does not exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-project'),
  );

  const target = await store.addConfigEntry(
    'new-config.json',
    'Basic Test',
    'cpp',
  );

  assert.deepEqual(target, {
    kind: 'config',
    file: 'new-config.json',
    index: 0,
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/config-project/.vscode/launch-composer/configs/new-config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Basic Test",\n      "enabled": true,\n      "profile": "cpp"\n    }\n  ]\n}',
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

test('toggleConfigFileEnabled updates the file-level enabled flag', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/toggle-config-file-project'),
  );

  await store.addConfigEntry('config.json', 'Launch', 'cpp');
  await store.toggleConfigFileEnabled('config.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/toggle-config-file-project/.vscode/launch-composer/configs/config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "profile": "cpp"\n    }\n  ]\n}\n',
  );
});

test('addProfileEntry preserves existing JSONC comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-add-profile-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-add-profile-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-add-profile-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '// profile file comment\n' +
        '[\n' +
        '  // keep profile comment\n' +
        '  {\n' +
        '    "name": "cpp",\n' +
        '    "configuration": {\n' +
        '      "type": "cppdbg",\n' +
        '      "request": "launch"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );

  await store.addProfileEntry('profile.json', 'node');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ profile file comment/);
  assert.match(text, /\/\/ keep profile comment/);
  assert.match(text, /"name": "node"/);
});

test('addConfigEntry preserves existing JSONC comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-add-config-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-add-config-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-add-config-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  // keep file comment\n' +
        '  "enabled": true,\n' +
        '  "configurations": [\n' +
        '    // keep config comment\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      "enabled": true,\n' +
        '      "profile": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.addConfigEntry('config.json', 'Attach', 'cpp');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ keep file comment/);
  assert.match(text, /\/\/ keep config comment/);
  assert.match(text, /"name": "Attach"/);
});

test('deleteEntry preserves comments around remaining entries', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-delete-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-delete-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-delete-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  "enabled": true,\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Delete Me",\n' +
        '      "enabled": true,\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    },\n' +
        '    {\n' +
        '      "name": "Keep Me",\n' +
        '      // keep surviving comment\n' +
        '      "enabled": true,\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.deleteEntry({
    kind: 'config',
    file: 'config.json',
    index: 0,
  });

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.doesNotMatch(text, /Delete Me/);
  assert.match(text, /\/\/ keep surviving comment/);
  assert.match(text, /Keep Me/);
});

test('toggle config flags preserve unrelated comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-toggle-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-toggle-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-toggle-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n' +
        '  // keep file enabled comment\n' +
        '  "enabled": true,\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      // keep entry enabled comment\n' +
        '      "enabled": true,\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.toggleConfigEnabled('config.json', 0);
  await store.toggleConfigFileEnabled('config.json');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ keep file enabled comment/);
  assert.match(text, /\/\/ keep entry enabled comment/);
  assert.match(text, /"enabled": false/);
});

test('config tree checkbox toggles the file-level enabled flag', async () => {
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
          type: 'file',
          kind: 'config',
          file: 'config.json',
          enabled: true,
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
    '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "profile": "cpp"\n    }\n  ]\n}\n',
  );
});

test('createDataFile supports unicode file names without stat-ing the target path', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/unicode-project'),
  );

  const fileName = await store.createDataFile('profile', 'あ');

  assert.equal(fileName, 'あ.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/unicode-project/.vscode/launch-composer/profiles/あ.json',
    ),
  );

  assert.equal(new TextDecoder().decode(bytes), '[]\n');
});

test('deleteDataFile tolerates a file that has already been removed', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/delete-project'),
  );

  await store.deleteDataFile('config', 'missing.json');

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
});

test('renameDataFile moves the JSON file without changing its contents', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/rename-file-project'),
  );
  const sourceUri = vscode.Uri.file(
    '/workspace/rename-file-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    sourceUri,
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const renamed = await store.renameDataFile(
    'profile',
    'profile.json',
    'renamed-profile.json',
  );

  assert.equal(renamed, 'renamed-profile.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/profiles/renamed-profile.json',
    ),
  );
  await assert.rejects(async () => vscode.workspace.fs.readFile(sourceUri));

  assert.equal(
    new TextDecoder().decode(bytes),
    '[\n  {\n    "name": "cpp"\n  }\n]\n',
  );
});

test('renameEntry updates profile references in configs', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/rename-entry-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false,\n      "profile": "cpp"\n    }\n  ]\n}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const [profileBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/profiles/profile.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(
    new TextDecoder().decode(profileBytes),
    '[\n  {\n    "name": "cpp-renamed"\n  }\n]\n',
  );
  assert.equal(
    new TextDecoder().decode(configBytes),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false,\n      "profile": "cpp-renamed"\n    }\n  ]\n}\n',
  );
});

test('renameEntry preserves profile and config comments while updating profile', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-rename-entry-project'),
  );
  const profileUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/profiles/profile.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    profileUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    // keep profile name comment\n' +
        '    "name": "cpp",\n' +
        '    "configuration": {\n' +
        '      "type": "cppdbg",\n' +
        '      "request": "launch"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );
  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(
      '{\n' +
        '  "enabled": true,\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      // keep profile comment\n' +
        '      "profile": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'profile',
      file: 'profile.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const profileText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(profileUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(profileText, /\/\/ keep profile name comment/);
  assert.match(configText, /\/\/ keep profile comment/);
  assert.match(profileText, /"name": "cpp-renamed"/);
  assert.match(configText, /"profile": "cpp-renamed"/);
});

test('patch entry updates preserve comments around edited fields', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-patch-project'),
  );
  const profileUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/profiles/profile.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    profileUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    "name": "node",\n' +
        '    "configuration": {\n' +
        '      "type": "node",\n' +
        '      "request": "launch",\n' +
        '      // keep profile program comment\n' +
        '      "program": "${workspaceFolder}/old.js"\n' +
        '    }\n' +
        '  }\n' +
        ']\n',
    ),
  );
  await vscode.workspace.fs.writeFile(
    configUri,
    new TextEncoder().encode(
      '{\n' +
        '  "enabled": true,\n' +
        '  "configurations": [\n' +
        '    {\n' +
        '      "name": "Launch",\n' +
        '      "enabled": true,\n' +
        '      "configuration": {\n' +
        '        "type": "node",\n' +
        '        "request": "launch",\n' +
        '        // keep config cwd comment\n' +
        '        "cwd": "${workspaceFolder}"\n' +
        '      }\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  const profileRevision = await store.getDataFileRevision(
    'profile',
    'profile.json',
  );
  const configRevision = await store.getDataFileRevision(
    'config',
    'config.json',
  );

  await store.patchProfileEntry('profile.json', 0, profileRevision, [
    {
      type: 'set',
      path: ['configuration', 'program'],
      value: '${workspaceFolder}/server.js',
    },
  ]);
  await store.patchConfigEntry('config.json', 0, configRevision, [
    {
      type: 'set',
      path: ['configuration', 'cwd'],
      value: '${workspaceFolder}/dist',
    },
  ]);

  const profileText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(profileUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(profileText, /\/\/ keep profile program comment/);
  assert.match(configText, /\/\/ keep config cwd comment/);
  assert.match(profileText, /"program": "\$\{workspaceFolder\}\/server\.js"/);
  assert.match(configText, /"cwd": "\$\{workspaceFolder\}\/dist"/);
});

test('patchProfileEntry rejects name updates', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/patch-profile-name-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/patch-profile-name-project/.vscode/launch-composer/profiles/profile.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/patch-profile-name-project/.vscode/launch-composer/profiles',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '[\n  {\n    "name": "cpp",\n    "type": "cppdbg",\n    "request": "launch"\n  }\n]\n',
    ),
  );

  const revision = await store.getDataFileRevision('profile', 'profile.json');

  await assert.rejects(
    async () =>
      store.patchProfileEntry('profile.json', 0, revision, [
        {
          type: 'set',
          path: ['name'],
          value: 'cpp-renamed',
        },
      ]),
    /Entry name changes must use the rename entry flow\./,
  );

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  assert.equal(
    new TextDecoder().decode(bytes),
    '[\n  {\n    "name": "cpp",\n    "type": "cppdbg",\n    "request": "launch"\n  }\n]\n',
  );
});

test('patchConfigEntry rejects name updates', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/patch-config-name-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/patch-config-name-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/patch-config-name-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "configuration": {\n        "type": "cppdbg",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
    ),
  );

  const revision = await store.getDataFileRevision('config', 'config.json');

  await assert.rejects(
    async () =>
      store.patchConfigEntry('config.json', 0, revision, [
        {
          type: 'set',
          path: ['name'],
          value: 'Launch Renamed',
        },
      ]),
    /Entry name changes must use the rename entry flow\./,
  );

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "configuration": {\n        "type": "cppdbg",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
  );
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
