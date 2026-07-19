import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import { createConfigCheckboxHandler } from '../src/commands/handlers.js';
import { WorkspaceStore } from '../src/io/workspaceStore.js';
import {
  expectDataFileWrites,
  WatcherEchoFilter,
} from '../src/sync/watcherEchoFilter.js';
import type { TreeNode } from '../src/treeview/provider.js';
import {
  configFileUri,
  testVscode,
  workspaceUri,
  writeConfigFile,
  writeProfileFile,
} from './helpers.js';

test.beforeEach(() => {
  testVscode.__testing.reset();
});

test('no-op mutations leave the next watcher event unignored, while a write ignores one event', async () => {
  const workspace = workspaceUri('watcher-write-metadata-project');
  const store = new WorkspaceStore(workspace);
  const echoFilter = new WatcherEchoFilter();

  const emptyConfigUri = await writeConfigFile(
    workspace,
    'empty.json',
    '{\n  "configurations": []\n}\n',
  );
  const profileUri = await writeProfileFile(
    workspace,
    'profile.json',
    '[\n  {\n    "name": "cpp"\n  }\n]\n',
  );

  const excludeAll = await store.setConfigFileExcluded('empty.json', true);
  const includeAll = await store.setConfigFileExcluded('empty.json', false);
  const emptyPatch = await store.patchProfileEntry(
    'profile.json',
    0,
    await store.getDataFileRevision('profile', 'profile.json'),
    [],
  );
  const sameNameRename = await store.renameEntry(
    { kind: 'profile', file: 'profile.json', index: 0 },
    'cpp',
  );

  expectDataFileWrites(echoFilter, excludeAll.writtenFiles);
  expectDataFileWrites(echoFilter, includeAll.writtenFiles);
  expectDataFileWrites(echoFilter, emptyPatch.writtenFiles);
  expectDataFileWrites(echoFilter, sameNameRename.writtenFiles);

  assert.equal(echoFilter.shouldIgnore('config', emptyConfigUri), false);
  assert.equal(echoFilter.shouldIgnore('profile', profileUri), false);

  const writtenConfigUri = await writeConfigFile(
    workspace,
    'written.json',
    '{\n  "configurations": [\n    {\n      "name": "Launch"\n    }\n  ]\n}\n',
  );
  const writeResult = await store.setConfigFileExcluded('written.json', true);

  expectDataFileWrites(echoFilter, writeResult.writtenFiles);
  assert.equal(echoFilter.shouldIgnore('config', writtenConfigUri), true);
  assert.equal(echoFilter.shouldIgnore('config', writtenConfigUri), false);
});

test('a checkbox batch expects one watcher event for multiple writes to the same file', async () => {
  const echoFilter = new WatcherEchoFilter();
  const file = 'config.json';
  const configUri = configFileUri(workspaceUri('checkbox-echo-project'), file);
  const setCalls: Array<{ file: string; index: number; excluded: boolean }> =
    [];
  const syncCalls: unknown[] = [];
  const store = {
    async setConfigExcluded(
      changedFile: string,
      index: number,
      excluded: boolean,
    ) {
      setCalls.push({ file: changedFile, index, excluded });
      return { writtenFiles: [{ kind: 'config' as const, file: changedFile }] };
    },
  } as Pick<WorkspaceStore, 'setConfigExcluded'> as WorkspaceStore;
  const handler = createConfigCheckboxHandler({
    store,
    echoFilter,
    async sync(options) {
      syncCalls.push(options);
    },
  });
  const parent: Extract<TreeNode, { type: 'file' }> = {
    type: 'file',
    kind: 'config',
    file,
    configurations: [],
  };
  const entries: TreeNode[] = [0, 1].map((index) => ({
    type: 'entry',
    parent,
    target: { kind: 'config', file, index },
    label: `Config ${index}`,
    included: true,
  }));

  await handler({
    items: entries.map((entry) => [
      entry,
      vscode.TreeItemCheckboxState.Unchecked,
    ]),
  });

  assert.deepEqual(setCalls, [
    { file, index: 0, excluded: true },
    { file, index: 1, excluded: true },
  ]);
  assert.deepEqual(syncCalls, [{ notifyIssues: false, kind: 'config' }]);
  assert.equal(echoFilter.shouldIgnore('config', configUri), true);
  assert.equal(echoFilter.shouldIgnore('config', configUri), false);
});
