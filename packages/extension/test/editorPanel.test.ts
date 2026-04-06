import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import type { WorkspaceStore } from '../src/io/workspaceStore.js';
import { EditorPanelController } from '../src/webview/editorPanel.js';

const testVscode = vscode as typeof vscode & {
  __testing: {
    reset(): void;
    createExtensionContext(): unknown;
    getLastCreatedWebviewPanel():
      | { disposed: boolean; postedMessages: unknown[] }
      | undefined;
  };
};

test.beforeEach(() => {
  testVscode.__testing.reset();
});

test('syncWithWorkspace closes the editor panel when the current target no longer exists', async () => {
  let exists = true;
  const store = {
    async readAll() {
      return {
        templates: [],
        configs: [],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:0';
    },
    async hasEntry() {
      return exists;
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'hasEntry'
  > as WorkspaceStore;

  const controller = new EditorPanelController({
    context:
      testVscode.__testing.createExtensionContext() as vscode.ExtensionContext,
    store,
    onDidMutate() {},
    async onDidReveal() {},
    async onDidGenerate() {
      return { success: true };
    },
  });

  await controller.open({
    kind: 'config',
    file: 'abc.json',
    index: 0,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.equal(panel.disposed, false);

  exists = false;
  await controller.syncWithWorkspace();

  assert.equal(panel.disposed, true);
});

test('syncWithWorkspaceData keeps the panel open when the current file is invalid', async () => {
  const store = {
    async readAll() {
      return {
        templates: [
          {
            file: 'abc.json',
            templates: [{ name: 'cpp' }],
          },
        ],
        configs: [],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:1';
    },
    async hasEntry() {
      return true;
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'hasEntry'
  > as WorkspaceStore;

  const controller = new EditorPanelController({
    context:
      testVscode.__testing.createExtensionContext() as vscode.ExtensionContext,
    store,
    onDidMutate() {},
    async onDidReveal() {},
    async onDidGenerate() {
      return { success: true };
    },
  });

  await controller.open({
    kind: 'template',
    file: 'abc.json',
    index: 0,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);

  await controller.syncWithWorkspaceData({
    templates: [],
    configs: [],
    issues: [
      {
        kind: 'template',
        file: 'abc.json',
        code: 'invalid-json',
        message: 'Invalid JSON in abc.json. Open the file and fix the syntax.',
      },
    ],
  });

  assert.equal(panel.disposed, false);
  const lastMessage = panel.postedMessages.at(-1) as
    | {
        type: 'initial-data';
        payload: {
          issues: Array<{ file: string; code: string }>;
        };
      }
    | undefined;
  assert.equal(lastMessage?.type, 'initial-data');
  assert.deepEqual(lastMessage?.payload.issues, [
    {
      file: 'abc.json',
      kind: 'template',
      code: 'invalid-json',
      message: 'Invalid JSON in abc.json. Open the file and fix the syntax.',
    },
  ]);
});
