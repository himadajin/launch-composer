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
