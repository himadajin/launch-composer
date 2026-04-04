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
  '// Add config entries to this array.\n' +
  '// Use "extends" to reference a template when needed.\n' +
  '[]\n';

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
    getCreatedDirectories(): string[];
    getClipboardText(): string;
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
      '[\n  {\n    "name": "keep-me",\n    "enabled": false\n  }\n]\n',
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
    '[\n  {\n    "name": "keep-me",\n    "enabled": false\n  }\n]\n',
  );
});

test('readAll returns empty data when Launch Composer directories do not exist', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/empty-project'));

  const data = await store.readAll();

  assert.deepEqual(data, {
    templates: [],
    configs: [],
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
    '[\n  {\n    "name": "cpp"\n  }\n]',
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
    '[\n  {\n    "name": "Basic Test",\n    "enabled": false,\n    "extends": "cpp"\n  }\n]',
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
      '[\n  {\n    "name": "Launch",\n    "enabled": false,\n    "extends": "cpp"\n  }\n]\n',
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
    '[\n  {\n    "name": "Launch",\n    "enabled": false,\n    "extends": "cpp-renamed"\n  }\n]\n',
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
    '[\n  {\n    "name": "cpp"\n  }\n]',
  );
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
