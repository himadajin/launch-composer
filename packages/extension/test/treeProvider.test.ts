import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import { WorkspaceStore } from '../src/io/workspaceStore.js';
import {
  LaunchComposerTreeProvider,
  type TreeNode,
} from '../src/treeview/provider.js';

async function getSectionNodes(
  provider: LaunchComposerTreeProvider,
): Promise<{ configSection: TreeNode; profileSection: TreeNode }> {
  const rootNodes = await provider.getChildren();
  assert.equal(rootNodes.length, 2);
  const [configSection, profileSection] = rootNodes;
  assert.ok(configSection);
  assert.ok(profileSection);
  assert.equal(configSection.type, 'section');
  assert.equal(profileSection.type, 'section');
  assert.equal(configSection.kind, 'config');
  assert.equal(profileSection.kind, 'profile');
  return { configSection, profileSection };
}

test('tree provider returns an empty root when the workspace has no data files', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/tree-empty'));
  const provider = new LaunchComposerTreeProvider(store);

  assert.deepEqual(await provider.getChildren(), []);
});

test('tree provider keeps both sections when only one kind has files', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/tree-one-sided'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'node' }],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: { diagnostics: [] },
  });

  const { configSection, profileSection } = await getSectionNodes(provider);
  assert.deepEqual(await provider.getChildren(configSection), []);

  const profileFiles = await provider.getChildren(profileSection);
  assert.deepEqual(
    profileFiles.map((node) => (node.type === 'file' ? node.file : node.type)),
    ['profile.json'],
  );
});

test('tree provider renders section nodes with fixed ids and contexts', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/tree-sections'));
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [
      {
        file: 'profile.json',
        profiles: [],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: { diagnostics: [] },
  });

  const { configSection, profileSection } = await getSectionNodes(provider);

  const configItem = provider.getTreeItem(configSection);
  assert.equal(configItem.label, 'Configs');
  assert.equal(configItem.id, 'section:config');
  assert.equal(configItem.contextValue, 'configSection');
  assert.equal(
    configItem.collapsibleState,
    vscode.TreeItemCollapsibleState.Expanded,
  );
  assert.equal(configItem.checkboxState, undefined);
  assert.equal(configItem.command, undefined);

  const profileItem = provider.getTreeItem(profileSection);
  assert.equal(profileItem.label, 'Profiles');
  assert.equal(profileItem.id, 'section:profile');
  assert.equal(profileItem.contextValue, 'profileSection');
  assert.equal(
    profileItem.collapsibleState,
    vscode.TreeItemCollapsibleState.Expanded,
  );
});

test('tree provider reveals an editor target with a complete parent chain', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/tree-provider-reveal'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'node' }],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: { diagnostics: [] },
  });

  const view = vscode.window.createTreeView<TreeNode>('tree-provider-reveal', {
    treeDataProvider: provider,
  });
  await provider.reveal(view, {
    kind: 'profile',
    file: 'profile.json',
    index: 0,
  });

  const revealCalls = (
    view as unknown as {
      getRevealCalls(): Array<{
        element: TreeNode;
        options: unknown;
      }>;
    }
  ).getRevealCalls();
  assert.equal(revealCalls.length, 1);

  const [revealCall] = revealCalls;
  assert.ok(revealCall);
  assert.equal(revealCall.element.type, 'entry');
  assert.deepEqual(revealCall.element.target, {
    kind: 'profile',
    file: 'profile.json',
    index: 0,
  });
  assert.deepEqual(revealCall.options, {
    select: true,
    focus: false,
    expand: true,
  });

  const parent = provider.getParent(revealCall.element);
  assert.ok(parent);
  assert.equal(parent.type, 'file');
  assert.equal(parent.file, 'profile.json');

  const section = provider.getParent(parent);
  assert.ok(section);
  assert.equal(section.type, 'section');
  assert.equal(section.kind, 'profile');
  assert.equal(provider.getParent(section), undefined);
});

test('tree provider does not reveal targets that no longer exist', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/tree-provider-reveal-missing'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'node' }],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: { diagnostics: [] },
  });

  const view = vscode.window.createTreeView<TreeNode>(
    'tree-provider-reveal-missing',
    {
      treeDataProvider: provider,
    },
  );
  await provider.reveal(view, {
    kind: 'config',
    file: 'config.json',
    index: 0,
  });
  await provider.reveal(view, {
    kind: 'profile',
    file: 'other.json',
    index: 0,
  });
  await provider.reveal(view, {
    kind: 'profile',
    file: 'profile.json',
    index: 5,
  });

  const revealCalls = (
    view as unknown as {
      getRevealCalls(): Array<{ element: TreeNode; options: unknown }>;
    }
  ).getRevealCalls();
  assert.deepEqual(revealCalls, []);
});

test('tree provider keeps invalid files visible as warning nodes', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/tree-project'));

  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file('/workspace/tree-project/.vscode/launch-composer/profiles'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/tree-project/.vscode/launch-composer/profiles/profile.json',
    ),
    new TextEncoder().encode(''),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/tree-project/.vscode/launch-composer/profiles/valid.json',
    ),
    new TextEncoder().encode('[\n  {\n    "name": "cpp"\n  }\n]\n'),
  );

  const provider = new LaunchComposerTreeProvider(store);
  const { profileSection } = await getSectionNodes(provider);
  const fileNodes = await provider.getChildren(profileSection);

  assert.deepEqual(
    fileNodes.map((node) =>
      node.type === 'file'
        ? { file: node.file, issue: node.issue?.code }
        : { file: node.type, issue: undefined },
    ),
    [
      { file: 'profile.json', issue: 'empty' },
      { file: 'valid.json', issue: undefined },
    ],
  );

  const invalidNode = fileNodes[0];
  assert.ok(invalidNode);
  assert.equal(invalidNode.type, 'file');
  assert.deepEqual(await provider.getChildren(invalidNode), []);

  const invalidItem = provider.getTreeItem(invalidNode);
  assert.equal(invalidItem.contextValue, 'profileFileInvalid');
  assert.equal(invalidItem.description, 'empty file');

  const validNode = fileNodes[1];
  assert.ok(validNode);
  assert.equal(validNode.type, 'file');
  const childNodes = await provider.getChildren(validNode);
  assert.deepEqual(
    childNodes.map((node) => (node.type === 'entry' ? node.label : node.type)),
    ['cpp'],
  );
});

test('tree provider shows included config entries as checked checkboxes', async () => {
  const store = new WorkspaceStore(vscode.Uri.file('/workspace/config-tree'));

  await writeValidProfile('/workspace/config-tree');
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file('/workspace/config-tree/.vscode/launch-composer/configs'),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      '/workspace/config-tree/.vscode/launch-composer/configs/config.json',
    ),
    new TextEncoder().encode(
      '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "node"\n    }\n  ]\n}\n',
    ),
  );

  const provider = new LaunchComposerTreeProvider(store);
  const { configSection } = await getSectionNodes(provider);
  const fileNodes = await provider.getChildren(configSection);
  const fileNode = fileNodes[0];

  assert.ok(fileNode);
  assert.equal(fileNode?.type, 'file');
  const fileItem = provider.getTreeItem(fileNode);
  assert.equal(fileItem.contextValue, 'configFile');
  assert.equal(fileItem.checkboxState, undefined);
  assert.equal(fileItem.label, 'config.json');

  const childNodes = await provider.getChildren(fileNode);
  const entryNode = childNodes[0];

  assert.ok(entryNode);
  assert.equal(entryNode?.type, 'entry');
  const item = provider.getTreeItem(entryNode);
  assert.equal(item.contextValue, 'configEntryEnabled');
  assert.deepEqual(item.checkboxState, {
    state: vscode.TreeItemCheckboxState.Checked,
    tooltip: 'Include this config when generating launch.json.',
  });
  assert.equal(item.description, undefined);
  assert.equal(item.iconPath, undefined);
  assert.equal(item.label, 'Launch');
  assert.deepEqual(item.command, {
    command: 'launch-composer.editItem',
    title: 'Edit',
    arguments: [entryNode],
  });
});

test('tree provider keeps excluded config entries as unchecked checkboxes', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-tree-preserve-state'),
  );

  await writeValidProfile('/workspace/config-tree-preserve-state');
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
      '{\n  "configurations": [\n    {\n      "name": "Launch",\n      "profile": "node",\n      "excluded": true\n    }\n  ]\n}\n',
    ),
  );

  const provider = new LaunchComposerTreeProvider(store);
  const { configSection } = await getSectionNodes(provider);
  const [fileNode] = await provider.getChildren(configSection);

  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');

  const [entryNode] = await provider.getChildren(fileNode);
  assert.ok(entryNode);
  assert.equal(entryNode.type, 'entry');

  const item = provider.getTreeItem(entryNode);
  assert.equal(item.contextValue, 'configEntryDisabled');
  assert.equal(item.description, 'excluded');
  assert.deepEqual(item.checkboxState, {
    state: vscode.TreeItemCheckboxState.Unchecked,
    tooltip: 'Include this config when generating launch.json.',
  });
  assert.equal(item.iconPath, undefined);
  assert.equal(item.label, 'Launch');
});

test('tree provider decorates profile entries with diagnostics', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/profile-tree-diagnostics'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [
      {
        file: 'profile.json',
        profiles: [{ name: 'node' }],
      },
    ],
    configs: [],
    issues: [],
    generateReadiness: {
      diagnostics: [
        {
          source: 'core-validation',
          file: 'profile.json',
          message: 'Profile type is required.',
          target: {
            kind: 'profile',
            index: 0,
            name: 'node',
            field: 'configuration.type',
          },
        },
      ],
    },
  });

  const { profileSection } = await getSectionNodes(provider);
  const [fileNode] = await provider.getChildren(profileSection);
  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');
  const fileItem = provider.getTreeItem(fileNode);
  assert.equal(fileItem.description, undefined);
  assert.equal(fileItem.iconPath, undefined);

  const [entryNode] = await provider.getChildren(fileNode);
  assert.ok(entryNode);
  assert.equal(entryNode.type, 'entry');
  const item = provider.getTreeItem(entryNode);
  assert.equal(item.description, '1 issue');
  assert.equal(item.tooltip, 'Profile type is required.');
  assert.notEqual(item.iconPath, undefined);
});

async function writeValidProfile(workspacePath: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.file(`${workspacePath}/.vscode/launch-composer/profiles`),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(
      `${workspacePath}/.vscode/launch-composer/profiles/profile.json`,
    ),
    new TextEncoder().encode(
      '[\n  {\n    "name": "node",\n    "configuration": {\n      "type": "node",\n      "request": "launch"\n    }\n  }\n]\n',
    ),
  );
}

test('tree provider combines excluded config state with diagnostic count', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-tree-diagnostics'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [],
    configs: [
      {
        file: 'config.json',
        configurations: [
          {
            name: 'Launch',
            profile: '',
            excluded: true,
          },
        ],
      },
    ],
    issues: [],
    generateReadiness: {
      diagnostics: [
        {
          source: 'core-validation',
          file: 'config.json',
          message: 'Config profile is required.',
          target: {
            kind: 'config',
            index: 0,
            name: 'Launch',
            field: 'profile',
          },
        },
      ],
    },
  });

  const { configSection } = await getSectionNodes(provider);
  const [fileNode] = await provider.getChildren(configSection);
  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');
  const [entryNode] = await provider.getChildren(fileNode);
  assert.ok(entryNode);
  assert.equal(entryNode.type, 'entry');

  const item = provider.getTreeItem(entryNode);
  assert.equal(item.description, 'excluded, 1 issue');
  assert.equal(item.tooltip, 'Config profile is required.');
  assert.notEqual(item.iconPath, undefined);
});

test('tree provider decorates config files with file-level diagnostics', async () => {
  const store = new WorkspaceStore(
    vscode.Uri.file('/workspace/config-file-tree-diagnostics'),
  );
  const provider = new LaunchComposerTreeProvider(store);
  provider.refresh({
    profiles: [],
    configs: [
      {
        file: 'config.json',
        configurations: [],
      },
    ],
    issues: [],
    generateReadiness: {
      diagnostics: [
        {
          source: 'core-validation',
          file: 'config.json',
          message: 'Config file must contain a configurations array.',
          target: {
            kind: 'file',
            field: 'configurations',
          },
        },
      ],
    },
  });

  const { configSection } = await getSectionNodes(provider);
  const [fileNode] = await provider.getChildren(configSection);
  assert.ok(fileNode);
  assert.equal(fileNode.type, 'file');

  const item = provider.getTreeItem(fileNode);
  assert.equal(item.description, '1 issue');
  assert.equal(
    item.tooltip,
    'Config file must contain a configurations array.',
  );
  assert.notEqual(item.iconPath, undefined);
});
