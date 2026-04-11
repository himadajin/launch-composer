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

test('open sets the panel title to the current profile name', async () => {
  const store = {
    async readAll() {
      return {
        profiles: [
          {
            file: 'abc.json',
            profiles: [{ name: 'cpp' }],
          },
        ],
        configs: [],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:title-profile';
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
    kind: 'profile',
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
        profiles: [],
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
        profiles: [
          {
            file: 'abc.json',
            profiles: [{ name: 'cpp' }],
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
    kind: 'profile',
    file: 'abc.json',
    index: 0,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.equal(panel.title, 'cpp');

  await controller.syncWithWorkspaceData({
    profiles: [],
    configs: [],
    issues: [
      {
        kind: 'profile',
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
      kind: 'profile',
      code: 'invalid-json',
      message: 'Invalid JSON in abc.json. Open the file and fix the syntax.',
    },
  ]);
});

test('openCurrentAsJson opens the active entry when the file is valid', async () => {
  let openedTarget:
    | {
        kind: 'profile' | 'config';
        file: string;
        index: number;
      }
    | undefined;
  const store = {
    async readAll() {
      return {
        profiles: [],
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
        kind: 'profile' | 'config';
        file: string;
      }
    | undefined;
  const store = {
    async readAll() {
      return {
        profiles: [],
        configs: [],
        issues: [
          {
            kind: 'profile' as const,
            file: 'profile.json',
            code: 'invalid-json' as const,
            message:
              'Invalid JSON in profile.json. Open the file and fix the syntax.',
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
    kind: 'profile',
    file: 'profile.json',
    index: 0,
  });

  await controller.openCurrentAsJson();

  assert.deepEqual(openedFile, {
    kind: 'profile',
    file: 'profile.json',
  });
});

test('rename-entry message calls renameEntry and posts refreshed data', async () => {
  let profileName = 'cpp';
  let renamed:
    | {
        target: {
          kind: 'profile' | 'config';
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
        profiles: [
          {
            file: 'profile.json',
            profiles: [{ name: profileName }],
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
      profileName = name;
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
    kind: 'profile',
    file: 'profile.json',
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
      kind: 'profile',
      file: 'profile.json',
      index: 0,
      name: 'cpp-renamed',
    },
  });

  assert.deepEqual(renamed, {
    target: {
      kind: 'profile',
      file: 'profile.json',
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
      profiles: [
        {
          file: 'profile.json',
          profiles: [{ name: 'cpp-renamed' }],
        },
      ],
      configs: [],
      issues: [],
      editor: {
        kind: 'profile',
        file: 'profile.json',
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
        profiles: [],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch', profile: 'cpp' }],
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

test('update-config message refreshes only config views through onDidMutate', async () => {
  let mutation:
    | {
        kind: 'profile' | 'config' | 'both';
        expectedWatchers?: ReadonlyArray<{
          kind: 'profile' | 'config';
          file: string;
        }>;
        syncEditor?: boolean;
      }
    | undefined;
  const store = {
    async readAll() {
      return {
        profiles: [],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch', enabled: true, profile: 'cpp' }],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:6';
    },
    async patchConfigEntry() {
      return {
        status: 'ok' as const,
        revision: 'rev:7',
      };
    },
  } as Pick<
    WorkspaceStore,
    'readAll' | 'getDataFileRevision' | 'patchConfigEntry'
  > as WorkspaceStore;

  const controller = new EditorPanelController({
    context:
      testVscode.__testing.createExtensionContext() as vscode.ExtensionContext,
    store,
    onDidMutate(nextMutation) {
      mutation = nextMutation;
    },
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
    type: 'update-config',
    requestId: 'update-1',
    payload: {
      file: 'config.json',
      index: 0,
      baseRevision: 'rev:6',
      patches: [
        {
          type: 'set',
          path: ['enabled'],
          value: false,
        },
      ],
    },
  });

  assert.deepEqual(mutation, {
    kind: 'config',
    expectedWatchers: [{ kind: 'config', file: 'config.json' }],
    syncEditor: false,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  assert.deepEqual(panel.postedMessages.at(-1), {
    type: 'update-result',
    requestId: 'update-1',
    payload: {
      success: true,
      revision: 'rev:7',
    },
  });
});

test('syncWithWorkspaceData refreshes the panel title when the current config name changes', async () => {
  const store = {
    async readAll() {
      return {
        profiles: [],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch', profile: 'cpp' }],
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
    profiles: [],
    configs: [
      {
        file: 'config.json',
        configurations: [{ name: 'Launch Server', profile: 'cpp' }],
      },
    ],
    issues: [],
  });

  assert.equal(panel.title, 'Launch Server');
});

test('syncWithWorkspaceData sends a config workspace update for an open config editor', async () => {
  const store = {
    async readAll() {
      return {
        profiles: [],
        configs: [
          {
            file: 'config.json',
            configurations: [
              { name: 'Launch Server', enabled: false, profile: 'cpp' },
            ],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:config-update';
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

  await controller.syncWithWorkspaceData(
    {
      profiles: [],
      configs: [
        {
          file: 'config.json',
          configurations: [
            { name: 'Launch Server', enabled: false, profile: 'cpp' },
          ],
        },
      ],
      issues: [
        {
          kind: 'config',
          file: 'other.json',
          code: 'invalid-shape',
          message:
            'other.json must contain an object with a "configurations" array.',
        },
      ],
    },
    { kind: 'config' },
  );

  assert.deepEqual(panel.postedMessages.at(-1), {
    type: 'workspace-update',
    requestId: 'local',
    payload: {
      kind: 'config',
      configs: [
        {
          file: 'config.json',
          configurations: [
            { name: 'Launch Server', enabled: false, profile: 'cpp' },
          ],
        },
      ],
      issues: [
        {
          kind: 'config',
          file: 'other.json',
          code: 'invalid-shape',
          message:
            'other.json must contain an object with a "configurations" array.',
        },
      ],
      editorRevision: 'rev:config-update',
    },
  });
});

test('syncWithWorkspaceData sends profile workspace updates to an open config editor', async () => {
  const store = {
    async readAll() {
      return {
        profiles: [
          {
            file: 'profile.json',
            profiles: [{ name: 'node' }],
          },
        ],
        configs: [
          {
            file: 'config.json',
            configurations: [{ name: 'Launch', profile: 'node' }],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:profile-update';
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

  await controller.syncWithWorkspaceData(
    {
      profiles: [
        {
          file: 'profile.json',
          profiles: [{ name: 'node-18' }],
        },
      ],
      configs: [
        {
          file: 'config.json',
          configurations: [{ name: 'Launch', profile: 'node-18' }],
        },
      ],
      issues: [],
    },
    { kind: 'profile' },
  );

  assert.deepEqual(panel.postedMessages.at(-1), {
    type: 'workspace-update',
    requestId: 'local',
    payload: {
      kind: 'profile',
      profiles: [
        {
          file: 'profile.json',
          profiles: [{ name: 'node-18' }],
        },
      ],
      issues: [],
    },
  });
});

test('syncWithWorkspaceData skips config-only editor updates when a profile editor is open', async () => {
  const store = {
    async readAll() {
      return {
        profiles: [
          {
            file: 'profile.json',
            profiles: [{ name: 'cpp' }],
          },
        ],
        configs: [
          {
            file: 'config.json',
            configurations: [
              { name: 'Launch', enabled: false, profile: 'cpp' },
            ],
          },
        ],
        issues: [],
      };
    },
    async getDataFileRevision() {
      return 'rev:skip-config';
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
    kind: 'profile',
    file: 'profile.json',
    index: 0,
  });

  const panel = testVscode.__testing.getLastCreatedWebviewPanel();
  assert.ok(panel);
  const messageCount = panel.postedMessages.length;

  await controller.syncWithWorkspaceData(
    {
      profiles: [
        {
          file: 'profile.json',
          profiles: [{ name: 'cpp' }],
        },
      ],
      configs: [
        {
          file: 'config.json',
          configurations: [{ name: 'Launch', enabled: false, profile: 'cpp' }],
        },
      ],
      issues: [],
    },
    { kind: 'config' },
  );

  assert.equal(panel.postedMessages.length, messageCount);
});
