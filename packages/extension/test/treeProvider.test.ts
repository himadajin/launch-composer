import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import { WorkspaceStore } from '../src/io/workspaceStore.js';
import { LaunchComposerTreeProvider } from '../src/treeview/provider.js';

test('tree provider keeps invalid files visible as warning nodes', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/tree-project'));

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/tree-project/.vscode/launch-composer/templates',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/tree-project/.vscode/launch-composer/templates/template.json',
    ),
    new TextEncoder().encode(''),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/tree-project/.vscode/launch-composer/templates/valid.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const provider = new LaunchComposerTreeProvider('template', store);
  const rootNodes = await provider.getChildren();

  assert.deepEqual(
    rootNodes.map((node) =>
      node.type === 'file'
        ? { file: node.file, issue: node.issue?.code }
        : { file: 'entry', issue: undefined },
    ),
    [
      { file: 'template.json', issue: 'empty' },
      { file: 'valid.json', issue: undefined },
    ],
  );

  const invalidNode = rootNodes[0];
  assert.ok(invalidNode);
  assert.equal(invalidNode.type, 'file');
  assert.deepEqual(await provider.getChildren(invalidNode), []);

  const invalidItem = provider.getTreeItem(invalidNode);
  assert.equal(invalidItem.contextValue, 'templateFileInvalid');
  assert.equal(invalidItem.description, 'empty file');

  const validNode = rootNodes[1];
  assert.ok(validNode);
  assert.equal(validNode.type, 'file');
  const childNodes = await provider.getChildren(validNode);
  assert.deepEqual(
    childNodes.map((node) => (node.type === 'entry' ? node.label : node.file)),
    ['cpp'],
  );
});

test('tree provider marks config entries as disabled when their file is disabled', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/config-tree'));

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file('/workspace/config-tree/.vscode/launch-composer/configs'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/config-tree/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": true\n    }\n  ]\n}\n',
    ),
  );

  const provider = new LaunchComposerTreeProvider('config', store);
  const rootNodes = await provider.getChildren();
  const fileNode = rootNodes[0];

  assert.ok(fileNode);
  assert.equal(fileNode?.type, 'file');
  const fileItem = provider.getTreeItem(fileNode);
  assert.equal(fileItem.contextValue, 'configFileDisabled');
  assert.equal(fileItem.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
  assert.equal(fileItem.label, 'config.json');

  const childNodes = await provider.getChildren(fileNode);
  const entryNode = childNodes[0];

  assert.ok(entryNode);
  assert.equal(entryNode?.type, 'entry');
  const item = provider.getTreeItem(entryNode);
  assert.equal(item.contextValue, 'configEntryDisabledByFile');
  assert.equal(item.description, 'disabled by file');
  assert.equal(item.checkboxState, undefined);
  assert.deepEqual(
    item.iconPath,
    new vscode.ThemeIcon(
      'circle-slash',
      new vscode.ThemeColor('disabledForeground'),
    ),
  );
  assert.equal(item.label, 'Launch');
  assert.deepEqual(item.command, {
    command: 'launch-composer.editItem',
    title: 'Edit',
    arguments: [entryNode],
  });
});

test('tree provider preserves entry checkbox state when a disabled file contains a disabled entry', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-tree-preserve-state'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/config-tree-preserve-state/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/config-tree-preserve-state/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "enabled": false,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false\n    }\n  ]\n}\n',
    ),
  );

  const provider = new LaunchComposerTreeProvider('config', store);
  const [fileNode] = await provider.getChildren();

  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');

  const [entryNode] = await provider.getChildren(fileNode);
  assert.ok(entryNode);
  assert.equal(entryNode.type, 'entry');

  const item = provider.getTreeItem(entryNode);
  assert.equal(item.contextValue, 'configEntryDisabledByFile');
  assert.equal(item.description, 'disabled by file');
  assert.equal(item.checkboxState, undefined);
  assert.deepEqual(
    item.iconPath,
    new vscode.ThemeIcon(
      'circle-slash',
      new vscode.ThemeColor('disabledForeground'),
    ),
  );
  assert.equal(item.label, 'Launch');
});

test('tree provider keeps item-level disabled config entries as unchecked checkboxes', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-tree-item-disabled'),
  );

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(
      '/workspace/config-tree-item-disabled/.vscode/launch-composer/configs',
    ),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/config-tree-item-disabled/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "enabled": true,\n  "configurations": [\n    {\n      "name": "Launch",\n      "enabled": false\n    }\n  ]\n}\n',
    ),
  );

  const provider = new LaunchComposerTreeProvider('config', store);
  const [fileNode] = await provider.getChildren();

  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');

  const [entryNode] = await provider.getChildren(fileNode);
  assert.ok(entryNode);
  assert.equal(entryNode.type, 'entry');

  const item = provider.getTreeItem(entryNode);
  assert.equal(item.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
  assert.equal(item.description, 'disabled');
  assert.equal(item.iconPath, undefined);
  assert.equal(item.label, 'Launch');
});
