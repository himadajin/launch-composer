import assert from 'node:assert/strict';
import test from 'node:test';

import * as vscode from 'vscode';

import type { WorkspaceStore } from '../src/io/workspaceStore.js';
import { EditorPanelController } from '../src/webview/editorPanel.js';

const testVscode = vscode as typeof vscode & {
  __testing: {
    reset(): void;
    createExtensionContext(): unknown;
    getErrorMessages(): string[];
    getLastCreatedWebviewPanel():
      | { disposed: boolean; title: string; postedMessages: unknown[] }
      | undefined;
  };
};

test.beforeEach(() => {
  testVscode.__testing.reset();
});

test('open sets the panel title to the current template name', async () => {
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
      return 'rev:title-template';
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision'
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
  assert.equal(panel.title, 'cpp');
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
  assert.equal(panel.title, 'abc.json');
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
  assert.equal(panel.title, 'cpp');

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
  assert.equal(panel.title, 'abc.json');
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

test('rename-entry message calls renameEntry and posts refreshed data', async () => {
  let templateName = 'cpp';
  let renamed:
    | {
        target: {
          kind: 'template' | 'config';
          file: string;
          index: number;
        };
        name: string;
      }
    | undefined;
  let mutateCount = 0;
  const store = {
    async readAll() {
      return {
        templates: [
          {
            file: 'template.json',
            templates: [{ name: templateName }],
          },
        ],
        configs: [],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:4';
    },
    async hasEntry() {
      return true;
    },
    async renameEntry(target, name) {
      templateName = name;
      renamed = { target, name };
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'hasEntry' | 'renameEntry'
  > as WorkspaceStore;

  const controller = new EditorPanelController({
    context:
      testVscode.__testing.createExtensionContext() as vscode.ExtensionContext,
    store,
    onDidMutate() {
      mutateCount += 1;
    },
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

  await (
    controller as unknown as {
      handleMessage(message: unknown): Promise<void>;
    }
  ).handleMessage({
    type: 'rename-entry',
    requestId: 'rename-1',
    payload: {
      kind: 'template',
      file: 'template.json',
      index: 0,
      name: 'cpp-renamed',
    },
  });

  assert.deepEqual(renamed, {
    target: {
      kind: 'template',
      file: 'template.json',
      index: 0,
    },
    name: 'cpp-renamed',
  });
  assert.equal(mutateCount, 1);

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.equal(panel.title, 'cpp-renamed');
  assert.deepEqual(panel.postedMessages.at(-2), {
    type: 'initial-data',
    requestId: 'local',
    payload: {
      templates: [
        {
          file: 'template.json',
          templates: [{ name: 'cpp-renamed' }],
        },
      ],
      configs: [],
      issues: [],
      editor: {
        kind: 'template',
        file: 'template.json',
        index: 0,
      },
      editorRevision: 'rev:4',
      autoSaveDelay: 1000,
    },
  });
  assert.deepEqual(panel.postedMessages.at(-1), {
    type: 'rename-result',
    requestId: 'rename-1',
    payload: { success: true },
  });
});

test('rename-entry message returns an error when renameEntry fails', async () => {
  const store = {
    async readAll() {
      return {
        templates: [],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch' }],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:5';
    },
    async renameEntry() {
      throw new Error('Name "Launch" is already in use.');
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'renameEntry'
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
    index: 0,
  });

  await (
    controller as unknown as {
      handleMessage(message: unknown): Promise<void>;
    }
  ).handleMessage({
    type: 'rename-entry',
    requestId: 'rename-2',
    payload: {
      kind: 'config',
      file: 'config.json',
      index: 0,
      name: 'Launch',
    },
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.deepEqual(panel.postedMessages.at(-1), {
    type: 'rename-result',
    requestId: 'rename-2',
    payload: {
      success: false,
      error: 'Name "Launch" is already in use.',
    },
  });
  assert.deepEqual(testVscode.__testing.getErrorMessages(), [
    'Name "Launch" is already in use.',
  ]);
});

test('syncWithWorkspaceData refreshes the panel title when the current config name changes', async () => {
  const store = {
    async readAll() {
      return {
        templates: [],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch' }],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:sync-title';
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
    kind: 'config',
    file: 'config.json',
    index: 0,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.equal(panel.title, 'Launch');

  await controller.syncWithWorkspaceData({
    templates: [],
    configs: [
      {
        file: 'config.json',
        configurations: [{ name: 'Launch Server' }],
      },
    ],
    issues: [],
  });

  assert.equal(panel.title, 'Launch Server');
});
