import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import type { WorkspaceStore } from '../src/io/workspaceStore.js';
import { EditorPanelController } from '../src/webview/editorPanel.js';

const testVscode = vscode as typeof vscode & {
  __testing: {
    reset(): void;
    createExtensionContext(): unknown;
    getLastCreatedWebviewPanel(): { disposed: boolean } | undefined;
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
      };
    },
    async hasEntry() {
      return exists;
    },
  } as Pick<WorkspaceStore, 'readAll' | 'hasEntry'> as WorkspaceStore;

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
