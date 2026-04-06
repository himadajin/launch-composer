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

test('openCurrentAsJson opens the active entry when the file is valid', async () => {
  let openedTarget:
    | {
        kind: 'template' | 'config';
        file: string;
        index: number;
      }
    | undefined;
  const store = {
    async readAll() {
      return {
        templates: [],
        configs: [],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:2';
    },
    async openEntryAsJson(target) {
      openedTarget = target;
    },
    async openDataFileAsJson() {
      assert.fail('expected entry JSON to open');
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'openEntryAsJson' | 'openDataFileAsJson'
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
    file: 'config.json',
    index: 2,
  });

  await controller.openCurrentAsJson();

  assert.deepEqual(openedTarget, {
    kind: 'config',
    file: 'config.json',
    index: 2,
  });
});

test('openCurrentAsJson opens the backing file when the active file is invalid', async () => {
  let openedFile:
    | {
        kind: 'template' | 'config';
        file: string;
      }
    | undefined;
  const store = {
    async readAll() {
      return {
        templates: [],
        configs: [],
        issues: [
          {
            kind: 'template' as const,
            file: 'template.json',
            code: 'invalid-json' as const,
            message:
              'Invalid JSON in template.json. Open the file and fix the syntax.',
          },
        ],
      };
    },
    async getDataFileRevision() {
      return 'rev:3';
    },
    async openEntryAsJson() {
      assert.fail('expected backing file JSON to open');
    },
    async openDataFileAsJson(kind, file) {
      openedFile = { kind, file };
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'openEntryAsJson' | 'openDataFileAsJson'
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
    file: 'template.json',
    index: 0,
  });

  await controller.openCurrentAsJson();

  assert.deepEqual(openedFile, {
    kind: 'template',
    file: 'template.json',
  });
});
