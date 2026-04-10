import test from 'node:test';
import assert from 'node:assert/strict';

import { activate } from '../src/extension.js';
import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from '../src/commands.js';
import { WorkspaceStore } from '../src/io/workspaceStore.js';
import * as vscode from 'vscode';

const DEFAULT_TEMPLATE_TEXT =
  '// Add template entries to this array.\n' +
  '// Each template should have a unique "name".\n' +
  '[]\n';
const DEFAULT_CONFIG_TEXT =
  '// Configure this file and add entries to "configurations".\n' +
  '// Use "extends" to reference a template when needed.\n' +
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
    '/workspace/project/.vscode/launch-composer/templates',
  ]);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/templates/template.json, .vscode/launch-composer/configs/config.json).',
  ]);

  const [templateBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/project/.vscode/launch-composer/templates/template.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(new TextDecoder().decode(templateBytes), DEFAULT_TEMPLATE_TEXT);
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
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/templates/template.json, .vscode/launch-composer/configs/config.json).',
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
      '/workspace/existing-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "existing"\n  }\n]\n'),
  );
  await vscode.commands.executeCommand(COMMANDS.init);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getInfoMessages(), [
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/templates/template.json, .vscode/launch-composer/configs/config.json).',
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs).',
  ]);

  const templateBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/existing-project/.vscode/launch-composer/templates/template.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(templateBytes),
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
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/templates/template.json, .vscode/launch-composer/configs/config.json).',
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
    'Launch Composer storage is ready (.vscode/launch-composer, .vscode/launch-composer/templates, .vscode/launch-composer/configs). Default files are ready (.vscode/launch-composer/templates/template.json).',
  ]);

  const [templateBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/partial-default-project/.vscode/launch-composer/templates/template.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/partial-default-project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(new TextDecoder().decode(templateBytes), DEFAULT_TEMPLATE_TEXT);
  assert.equal(
    new TextDecoder().decode(configBytes),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "keep-me",\n      "enabled": false\n    }\n  ]\n}\n',
  );
});

test('readAll returns empty data when Launch Composer directories do not exist', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/empty-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    templates: [],
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
    templates: [],
    configs: [],
    issues: [],
  });
});

test('readAll skips files that disappear before they can be read', async () => {
  testVscode.__testing.setMissingPathErrorStyle('vscode-enoent');
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/templates/racy.json',
  );
  testVscode.__testing.createGhostFile(
    '/workspace/racy-project/.vscode/launch-composer/configs/racy.json',
  );
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/racy-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    templates: [],
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
      '/workspace/invalid-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode(''),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/invalid-project/.vscode/launch-composer/templates/valid.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readAll();

  assert.deepEqual(data.templates, [
    {
      file: 'valid.json',
      templates: [{ name: 'cpp' }],
    },
  ]);
  assert.deepEqual(data.configs, []);
  assert.deepEqual(data.issues, [
    {
      kind: 'template',
      file: 'template.json',
      code: 'empty',
      message: 'template.json is empty. Expected a JSON array such as [].',
    },
  ]);
});

test('readTemplatesWithIssues reads template data without requiring config directories', async () => {
  const workspaceUri = vscode.Uri.file('/workspace/templates-only-project');
  const store = new WorkspaceStore(workspaceUri);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(
      workspaceUri,
      '.vscode',
      'launch-composer',
      'templates',
      'template.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const data = await store.readTemplatesWithIssues();

  assert.deepEqual(data, {
    templates: [
      {
        file: 'template.json',
        templates: [{ name: 'cpp' }],
      },
    ],
    issues: [],
  });
});

test('readConfigsWithIssues reads config data without requiring template directories', async () => {
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
      '/workspace/generate-invalid-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/generate-invalid-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode('{'),
  );

  const result = await store.generateLaunchJson();

  assert.deepEqual(result, {
    success: false,
    errors: [
      {
        file: 'template.json',
        message:
          'Invalid JSON in template.json. Open the file and fix the syntax.',
      },
    ],
  });
});

test('addTemplateEntry creates its backing file when it does not exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/template-project'),
  );

  const target = await store.addTemplateEntry('new-template.json', 'cpp');

  assert.deepEqual(target, {
    kind: 'template',
    file: 'new-template.json',
    index: 0,
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/template-project/.vscode/launch-composer/templates/new-template.json',
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
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Basic Test",\n      "enabled": true,\n      "extends": "cpp"\n    }\n  ]\n}',
  );
});

test('addConfig command creates enabled configs by default', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/add-config-project']);
  testVscode.__testing.setQuickPickResponses([{ label: 'No template' }]);
  testVscode.__testing.setInputBoxResponses(['Launch']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addConfigEntry, {
    type: 'file',
    kind: 'config',
    file: 'config.json',
  });

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);
  assert.deepEqual(testVscode.__testing.getLastQuickPickCall(), {
    items: [
      {
        label: 'No template',
        description: 'Create a standalone config without template inheritance.',
      },
    ],
    options: {
      placeHolder: 'Select a base template',
      prompt:
        'Choose a template to inherit from, or select No template to create a standalone config.',
    },
  });

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/add-config-project/.vscode/launch-composer/configs/config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes).trim(),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "configuration": {\n        "type": "",\n        "request": "launch"\n      }\n    }\n  ]\n}',
  );
});

test('addConfig command shows templates first and No template last', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/add-config-picker-project',
  ]);

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/add-config-picker-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/add-config-picker-project/.vscode/launch-composer/templates/template.json',
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
    { kind: vscode.QuickPickItemKind.Separator, label: 'Standalone' },
    {
      label: 'No template',
      description: 'Create a standalone config without template inheritance.',
    },
  ]);
  assert.deepEqual(quickPickCall.options, {
    placeHolder: 'Select a base template',
    prompt:
      'Choose a template to inherit from, or select No template to create a standalone config.',
  });
});

test('toggleConfigFileEnabled updates the file-level enabled flag', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/toggle-config-file-project'),
  );

  await store.addConfigEntry('config.json', 'Launch', undefined);
  await store.toggleConfigFileEnabled('config.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/toggle-config-file-project/.vscode/launch-composer/configs/config.json',
    ),
  );

  assert.equal(
    new TextDecoder().decode(bytes),
    '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "configuration": {\n        "type": "",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
  );
});

test('addTemplateEntry preserves existing JSONC comments', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-add-template-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/comment-add-template-project/.vscode/launch-composer/templates/template.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-add-template-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '// template file comment\n' +
        '[\n' +
        '  // keep template comment\n' +
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

  await store.addTemplateEntry('template.json', 'node');

  const text = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(fileUri),
  );
  assert.match(text, /\/\/ template file comment/);
  assert.match(text, /\/\/ keep template comment/);
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
        '      "extends": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.addConfigEntry('config.json', 'Attach', undefined);

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
  await store.addConfigEntry('config.json', 'Launch', undefined);

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
    '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true,\n      "configuration": {\n        "type": "",\n        "request": "launch"\n      }\n    }\n  ]\n}\n',
  );
});

test('createDataFile supports unicode file names without stat-ing the target path', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/unicode-project'),
  );

  const fileName = await store.createDataFile('template', 'あ');

  assert.equal(fileName, 'あ.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/unicode-project/.vscode/launch-composer/templates/あ.json',
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
    '/workspace/rename-file-project/.vscode/launch-composer/templates/template.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    sourceUri,
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const renamed = await store.renameDataFile(
    'template',
    'template.json',
    'renamed-template.json',
  );

  assert.equal(renamed, 'renamed-template.json');

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/rename-file-project/.vscode/launch-composer/templates/renamed-template.json',
    ),
  );
  await assert.rejects(async () => vscode.workspace.fs.readFile(sourceUri));

  assert.equal(
    new TextDecoder().decode(bytes),
    '[\n  {\n    "name": "cpp"\n  }\n]\n',
  );
});

test('renameEntry updates template references in configs', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/rename-entry-project'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false,\n      "extends": "cpp"\n    }\n  ]\n}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'template',
      file: 'template.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const [templateBytes, configBytes] = await Promise.all([
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/templates/template.json',
      ),
    ),
    vscode.workspace.fs.readFile(
      vscode.Uri.file(
        '/workspace/rename-entry-project/.vscode/launch-composer/configs/config.json',
      ),
    ),
  ]);

  assert.equal(
    new TextDecoder().decode(templateBytes),
    '[\n  {\n    "name": "cpp-renamed"\n  }\n]\n',
  );
  assert.equal(
    new TextDecoder().decode(configBytes),
    '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false,\n      "extends": "cpp-renamed"\n    }\n  ]\n}\n',
  );
});

test('renameEntry preserves template and config comments while updating extends', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-rename-entry-project'),
  );
  const templateUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/templates/template.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-rename-entry-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    templateUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    // keep template name comment\n' +
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
        '      // keep extends comment\n' +
        '      "extends": "cpp"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
    ),
  );

  await store.renameEntry(
    {
      kind: 'template',
      file: 'template.json',
      index: 0,
    },
    'cpp-renamed',
  );

  const templateText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(templateUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(templateText, /\/\/ keep template name comment/);
  assert.match(configText, /\/\/ keep extends comment/);
  assert.match(templateText, /"name": "cpp-renamed"/);
  assert.match(configText, /"extends": "cpp-renamed"/);
});

test('patch entry updates preserve comments around edited fields', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/comment-patch-project'),
  );
  const templateUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/templates/template.json',
  );
  const configUri = vscode.Uri.file(
    '/workspace/comment-patch-project/.vscode/launch-composer/configs/config.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/comment-patch-project/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    templateUri,
    new TextEncoder().encode(
      '[\n' +
        '  {\n' +
        '    "name": "node",\n' +
        '    "configuration": {\n' +
        '      "type": "node",\n' +
        '      "request": "launch",\n' +
        '      // keep template program comment\n' +
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

  const templateRevision = await store.getDataFileRevision(
    'template',
    'template.json',
  );
  const configRevision = await store.getDataFileRevision(
    'config',
    'config.json',
  );

  await store.patchTemplateEntry('template.json', 0, templateRevision, [
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

  const templateText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(templateUri),
  );
  const configText = new TextDecoder().decode(
    await vscode.workspace.fs.readFile(configUri),
  );

  assert.match(templateText, /\/\/ keep template program comment/);
  assert.match(configText, /\/\/ keep config cwd comment/);
  assert.match(templateText, /"program": "\$\{workspaceFolder\}\/server\.js"/);
  assert.match(configText, /"cwd": "\$\{workspaceFolder\}\/dist"/);
});

test('patchTemplateEntry rejects name updates', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/patch-template-name-project'),
  );
  const fileUri = vscode.Uri.file(
    '/workspace/patch-template-name-project/.vscode/launch-composer/templates/template.json',
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/patch-template-name-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    fileUri,
    new TextEncoder().encode(
      '[\n  {\n    "name": "cpp",\n    "type": "cppdbg",\n    "request": "launch"\n  }\n]\n',
    ),
  );

  const revision = await store.getDataFileRevision('template', 'template.json');

  await assert.rejects(
    async () =>
      store.patchTemplateEntry('template.json', 0, revision, [
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

test('copyTemplateFilePath writes the backing JSON path to the clipboard', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/copy-path-project']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.copyTemplateFilePath, {
    type: 'file',
    kind: 'template',
    file: 'template.json',
  });

  assert.equal(
    testVscode.__testing.getClipboardText(),
    '/workspace/copy-path-project/.vscode/launch-composer/templates/template.json',
  );
});

test('copyTemplateFileRelativePath writes the workspace-relative JSON path to the clipboard', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders([
    '/workspace/copy-relative-path-project',
  ]);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.copyTemplateFileRelativePath, {
    type: 'file',
    kind: 'template',
    file: 'template.json',
  });

  assert.equal(
    testVscode.__testing.getClipboardText(),
    '.vscode/launch-composer/templates/template.json',
  );
});

test('addTemplate initializes directories before listing files', async () => {
  const context =
    testVscode.__testing.createExtensionContext() as vscode.ExtensionContext;
  testVscode.__testing.setWorkspaceFolders(['/workspace/add-template-project']);
  testVscode.__testing.setQuickPickResponses([
    { label: '$(add) Create new file', value: '__create__' },
  ]);
  testVscode.__testing.setInputBoxResponses(['templates', 'cpp']);

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addTemplate);

  assert.deepEqual(testVscode.__testing.getErrorMessages(), []);

  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(
      '/workspace/add-template-project/.vscode/launch-composer/templates/templates.json',
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
      '/workspace/warn-once-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/warn-once-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode(''),
  );

  activate(context);
  await vscode.commands.executeCommand(COMMANDS.addTemplateFile);
  await vscode.commands.executeCommand(COMMANDS.addTemplateFile);

  assert.deepEqual(testVscode.__testing.getWarningMessages(), [
    'template.json is empty. Expected a JSON array such as [].',
  ]);
});

test('generate writes an empty launch.json when no templates or configs exist', async () => {
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
