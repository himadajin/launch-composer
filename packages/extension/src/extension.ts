import * as vscode from 'vscode';

import { CONTRIBUTED_COMMAND_IDS } from './commands.js';
import {
  createConfigCheckboxHandler,
  createGenerateHandler,
  registerCommand,
  registerWorkspaceCommands,
} from './commands/handlers.js';
import {
  WorkspaceStore,
  type WorkspaceDataSnapshot,
} from './io/workspaceStore.js';
import type { EditorTarget } from './messages.js';
import {
  showError,
  showWorkspaceRequiredError,
} from './notifications/errors.js';
import { IssueReporter } from './notifications/issueReporter.js';
import {
  registerDataWatcher,
  WatcherEchoFilter,
} from './sync/watcherEchoFilter.js';
import {
  WorkspaceSyncController,
  type SnapshotKind,
} from './sync/workspaceSyncController.js';
import {
  LaunchComposerTreeProvider,
  type TreeNode,
} from './treeview/provider.js';
import { EditorPanelController } from './webview/editorPanel.js';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot === undefined) {
    context.subscriptions.push(
      ...CONTRIBUTED_COMMAND_IDS.map((command) =>
        registerCommand(command, showWorkspaceRequiredError),
      ),
    );
    return;
  }

  const store = new WorkspaceStore(workspaceRoot.uri);
  const profileProvider = new LaunchComposerTreeProvider('profile', store);
  const configProvider = new LaunchComposerTreeProvider('config', store);

  const profileView = vscode.window.createTreeView<TreeNode>(
    'launchComposer.profiles',
    {
      treeDataProvider: profileProvider,
      showCollapseAll: false,
    },
  );
  const configView = vscode.window.createTreeView<TreeNode>(
    'launchComposer.configs',
    {
      treeDataProvider: configProvider,
      manageCheckboxStateManually: true,
      showCollapseAll: false,
    },
  );

  const issueReporter = new IssueReporter();
  const echoFilter = new WatcherEchoFilter();

  const applySnapshot = (
    snapshot: WorkspaceDataSnapshot,
    kind: SnapshotKind = 'both',
  ): void => {
    if (kind === 'both' || kind === 'profile') {
      profileProvider.refresh(snapshot);
    }
    if (kind === 'both' || kind === 'config') {
      configProvider.refresh(snapshot);
    }
  };

  const syncController = new WorkspaceSyncController({
    store,
    echoFilter,
    applySnapshot,
    reportIssues: (issues) => issueReporter.report(issues),
    onError: showError,
  });
  const sync = (
    options?: Parameters<WorkspaceSyncController['sync']>[0],
  ): Promise<void> => syncController.sync(options);

  const revealTarget = async (target: EditorTarget): Promise<void> => {
    await Promise.all([
      profileProvider.reveal(profileView, target),
      configProvider.reveal(configView, target),
    ]);
  };

  const handleGenerate = createGenerateHandler(store, sync);

  const editorPanel = new EditorPanelController({
    context,
    store,
    onDidMutate: (mutation) => syncController.refresh(mutation),
    onDidReveal: revealTarget,
    onDidGenerate: handleGenerate,
  });
  syncController.setEditorSync((snapshot, kind) =>
    editorPanel.syncWithWorkspaceData(snapshot, { kind }),
  );

  const profileWatcher = registerDataWatcher(
    store.getRelativeProfilePattern(),
    'profile',
    echoFilter,
    sync,
    showError,
  );
  const configWatcher = registerDataWatcher(
    store.getRelativeConfigPattern(),
    'config',
    echoFilter,
    sync,
    showError,
  );

  const handleConfigCheckboxChange = createConfigCheckboxHandler({
    store,
    echoFilter,
    sync,
  });
  const checkboxSubscription = configView.onDidChangeCheckboxState((event) =>
    handleConfigCheckboxChange(event),
  );

  context.subscriptions.push(
    profileView,
    configView,
    profileWatcher,
    configWatcher,
    checkboxSubscription,
    ...registerWorkspaceCommands({
      store,
      editorPanel,
      echoFilter,
      sync,
      handleGenerate,
    }),
  );
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.length === 1 ? folders[0] : undefined;
}

export function deactivate(): void {}
