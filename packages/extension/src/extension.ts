import * as path from 'node:path';

import type { ValidationError } from '@launch-composer/core';
import * as vscode from 'vscode';

import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from './commands.js';
import {
  WorkspaceStore,
  type ComposerDataIssue,
  type WorkspaceDataSnapshot,
} from './io/workspaceStore.js';
import type { EditorTarget } from './messages.js';
import {
  LaunchComposerTreeProvider,
  type TreeNode,
} from './treeview/provider.js';
import { EditorPanelController } from './webview/editorPanel.js';

type ProfileSelectionItem =
  | { label: string; value: string; description?: string }
  | vscode.QuickPickItem;
type SnapshotKind = 'profile' | 'config' | 'both';

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

  const activeIssues = new Map<string, string>();
  const pendingWatcherEvents = new Map<string, number>();
  const snapshotCache: {
    profiles?: WorkspaceDataSnapshot['profiles'];
    configs?: WorkspaceDataSnapshot['configs'];
    profileIssues?: ComposerDataIssue[];
    configIssues?: ComposerDataIssue[];
  } = {};
  let syncQueue = Promise.resolve();

  const queueWatcherEvent = (
    kind: 'profile' | 'config',
    file: string,
  ): void => {
    const key = `${kind}:${file}`;
    pendingWatcherEvents.set(key, (pendingWatcherEvents.get(key) ?? 0) + 1);
  };

  const shouldIgnoreWatcherEvent = (
    kind: 'profile' | 'config',
    uri: vscode.Uri,
  ): boolean => {
    const key = `${kind}:${path.basename(uri.fsPath)}`;
    const remaining = pendingWatcherEvents.get(key);
    if (remaining === undefined) {
      return false;
    }

    if (remaining <= 1) {
      pendingWatcherEvents.delete(key);
    } else {
      pendingWatcherEvents.set(key, remaining - 1);
    }

    return true;
  };

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

  const reportIssues = (issues: ComposerDataIssue[]): void => {
    const nextIssues = new Map(
      issues.map((issue) => [getIssueKey(issue), getIssueFingerprint(issue)]),
    );

    for (const issue of issues) {
      const key = getIssueKey(issue);
      const fingerprint = getIssueFingerprint(issue);
      if (activeIssues.get(key) === fingerprint) {
        continue;
      }

      activeIssues.set(key, fingerprint);
      void vscode.window.showWarningMessage(issue.message);
    }

    for (const key of [...activeIssues.keys()]) {
      if (!nextIssues.has(key)) {
        activeIssues.delete(key);
      }
    }
  };

  const cacheSnapshot = (snapshot: WorkspaceDataSnapshot): void => {
    snapshotCache.profiles = snapshot.profiles;
    snapshotCache.configs = snapshot.configs;
    snapshotCache.profileIssues = snapshot.issues.filter(
      (issue) => issue.kind === 'profile',
    );
    snapshotCache.configIssues = snapshot.issues.filter(
      (issue) => issue.kind === 'config',
    );
  };

  const getCachedSnapshot = (): WorkspaceDataSnapshot | undefined => {
    if (
      snapshotCache.profiles === undefined ||
      snapshotCache.configs === undefined ||
      snapshotCache.profileIssues === undefined ||
      snapshotCache.configIssues === undefined
    ) {
      return undefined;
    }

    return {
      profiles: snapshotCache.profiles,
      configs: snapshotCache.configs,
      issues: [...snapshotCache.profileIssues, ...snapshotCache.configIssues],
    };
  };

  const readSnapshotForKind = async (
    kind: SnapshotKind,
  ): Promise<WorkspaceDataSnapshot> => {
    const cachedSnapshot = getCachedSnapshot();
    if (kind === 'both' || cachedSnapshot === undefined) {
      const snapshot = await store.readAll();
      cacheSnapshot(snapshot);
      return snapshot;
    }

    if (kind === 'profile') {
      const profileData = await store.readProfilesWithIssues();
      snapshotCache.profiles = profileData.profiles;
      snapshotCache.profileIssues = profileData.issues;
    } else {
      const configData = await store.readConfigsWithIssues();
      snapshotCache.configs = configData.configs;
      snapshotCache.configIssues = configData.issues;
    }

    return getCachedSnapshot() ?? cachedSnapshot;
  };

  const syncUiWithWorkspace = async (options?: {
    notifyIssues?: boolean;
    kind?: SnapshotKind;
    syncEditor?: boolean;
  }): Promise<void> => {
    const nextSync = syncQueue.then(async () => {
      const kind = options?.kind ?? 'both';
      const snapshot = await readSnapshotForKind(kind);
      if (options?.notifyIssues !== false) {
        reportIssues(snapshot.issues);
      }
      applySnapshot(snapshot, kind);
      if (options?.syncEditor !== false) {
        await editorPanel.syncWithWorkspaceData(snapshot, { kind });
      }
    });

    syncQueue = nextSync.catch(() => undefined);
    await nextSync;
  };

  const refreshViews = (options?: {
    kind?: SnapshotKind;
    expectedWatchers?: ReadonlyArray<{
      kind: 'profile' | 'config';
      file: string;
    }>;
    syncEditor?: boolean;
  }): void => {
    options?.expectedWatchers?.forEach(({ kind, file }) =>
      queueWatcherEvent(kind, file),
    );
    const syncOptions: {
      notifyIssues: boolean;
      kind?: SnapshotKind;
      syncEditor?: boolean;
    } = {
      notifyIssues: false,
    };
    if (options?.kind !== undefined) {
      syncOptions.kind = options.kind;
    }
    if (options?.syncEditor !== undefined) {
      syncOptions.syncEditor = options.syncEditor;
    }

    void syncUiWithWorkspace(syncOptions).catch(showError);
  };

  const handleConfigCheckboxChange = async (
    event: vscode.TreeCheckboxChangeEvent<TreeNode>,
  ): Promise<void> => {
    try {
      const changedFiles = new Set<string>();

      for (const [node, checkboxState] of event.items) {
        const enabled = checkboxState === vscode.TreeItemCheckboxState.Checked;

        if (node.type === 'file' && node.kind === 'config') {
          if (node.enabled !== enabled) {
            await store.toggleConfigFileEnabled(node.file);
            changedFiles.add(node.file);
          }
          continue;
        }

        if (node.type !== 'entry' || node.target.kind !== 'config') {
          continue;
        }

        if (node.inheritedDisabled) {
          continue;
        }

        if (node.enabled !== enabled) {
          await store.toggleConfigEnabled(node.target.file, node.target.index);
          changedFiles.add(node.target.file);
        }
      }

      if (changedFiles.size > 0) {
        changedFiles.forEach((file) => queueWatcherEvent('config', file));
        await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
      }
    } catch (error) {
      showError(error);
    }
  };

  const revealTarget = async (target: EditorTarget): Promise<void> => {
    await Promise.all([
      profileProvider.reveal(profileView, target),
      configProvider.reveal(configView, target),
    ]);
  };

  const handleGenerate = async (): Promise<{
    success: boolean;
    errors?: ValidationError[];
  }> => {
    const generated = await store.generateLaunchJson();
    if (!generated.success) {
      showValidationErrors(generated.errors);
      return {
        success: false,
        errors: generated.errors,
      };
    }

    if (!(await confirmOverwrite(store))) {
      return { success: false };
    }

    await store.writeLaunchJson(generated);
    void vscode.window.showInformationMessage('launch.json was generated.');
    return { success: true };
  };

  const handleInitialize = async (): Promise<void> => {
    const result = await store.ensureInitialized();
    await syncUiWithWorkspace();
    const fileSuffix =
      result.ensuredFiles.length === 0
        ? ''
        : ` Default files are ready (${result.ensuredFiles.join(', ')}).`;
    void vscode.window.showInformationMessage(
      `Launch Composer storage is ready (${result.ensuredDirectories.join(', ')}).${fileSuffix}`,
    );
  };

  const handleAddProfile = async (): Promise<void> => {
    const file = await selectOrCreateFile(store, 'profile');
    if (file === undefined) {
      return;
    }

    await addProfileEntry(store, file, editorPanel, syncUiWithWorkspace);
  };

  const editorPanel = new EditorPanelController({
    context,
    store,
    onDidMutate: refreshViews,
    onDidReveal: revealTarget,
    onDidGenerate: handleGenerate,
  });

  const profileWatcher = vscode.workspace.createFileSystemWatcher(
    store.getRelativeProfilePattern(),
  );
  profileWatcher.onDidCreate((uri) => {
    if (shouldIgnoreWatcherEvent('profile', uri)) {
      return;
    }
    void syncUiWithWorkspace({ notifyIssues: false, kind: 'profile' }).catch(
      showError,
    );
  });
  profileWatcher.onDidChange((uri) => {
    if (shouldIgnoreWatcherEvent('profile', uri)) {
      return;
    }
    void syncUiWithWorkspace({ notifyIssues: true, kind: 'profile' }).catch(
      showError,
    );
  });
  profileWatcher.onDidDelete((uri) => {
    if (shouldIgnoreWatcherEvent('profile', uri)) {
      return;
    }
    void syncUiWithWorkspace({ kind: 'profile' }).catch(showError);
  });

  const configWatcher = vscode.workspace.createFileSystemWatcher(
    store.getRelativeConfigPattern(),
  );
  configWatcher.onDidCreate((uri) => {
    if (shouldIgnoreWatcherEvent('config', uri)) {
      return;
    }
    void syncUiWithWorkspace({ notifyIssues: false, kind: 'config' }).catch(
      showError,
    );
  });
  configWatcher.onDidChange((uri) => {
    if (shouldIgnoreWatcherEvent('config', uri)) {
      return;
    }
    void syncUiWithWorkspace({ notifyIssues: true, kind: 'config' }).catch(
      showError,
    );
  });
  configWatcher.onDidDelete((uri) => {
    if (shouldIgnoreWatcherEvent('config', uri)) {
      return;
    }
    void syncUiWithWorkspace({ kind: 'config' }).catch(showError);
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
    registerCommand(COMMANDS.generate, async () => {
      try {
        await handleGenerate();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.init, async () => {
      try {
        await handleInitialize();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addProfile, async () => {
      try {
        await handleAddProfile();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addProfileFile, async () => {
      try {
        const file = await promptForFileName('Profile file name');
        if (file === undefined) {
          return;
        }

        const created = await store.createDataFile('profile', file);
        await syncUiWithWorkspace();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.openProfileFileJson, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'profile');
      if (fileNode === undefined) {
        return;
      }

      try {
        await store.openDataFileAsJson('profile', fileNode.file);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.copyProfileFilePath, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'profile');
      if (fileNode === undefined) {
        return;
      }

      try {
        await vscode.env.clipboard.writeText(
          store.getDataFilePath('profile', fileNode.file),
        );
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(
      COMMANDS.copyProfileFileRelativePath,
      async (node?: TreeNode) => {
        const fileNode = getFileNode(node, 'profile');
        if (fileNode === undefined) {
          return;
        }

        try {
          await vscode.env.clipboard.writeText(
            store.getDataFileRelativePath('profile', fileNode.file),
          );
        } catch (error) {
          showError(error);
        }
      },
    ),
    registerCommand(COMMANDS.renameProfileFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'profile');
      if (fileNode === undefined) {
        return;
      }

      try {
        const nextFile = await promptForFileName(
          'Profile file name',
          fileNode.file,
        );
        if (nextFile === undefined) {
          return;
        }

        await store.renameDataFile('profile', fileNode.file, nextFile);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteProfileFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'profile');
      if (fileNode === undefined) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${fileNode.file}?`))) {
          return;
        }

        await store.deleteDataFile('profile', fileNode.file);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addProfileEntry, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'profile');
      if (fileNode === undefined) {
        return;
      }

      try {
        await addProfileEntry(
          store,
          fileNode.file,
          editorPanel,
          syncUiWithWorkspace,
        );
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addConfigFile, async () => {
      try {
        const file = await promptForFileName('Config file name');
        if (file === undefined) {
          return;
        }

        const created = await store.createDataFile('config', file);
        await syncUiWithWorkspace();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.openConfigFileJson, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'config');
      if (fileNode === undefined) {
        return;
      }

      try {
        await store.openDataFileAsJson('config', fileNode.file);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.copyConfigFilePath, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'config');
      if (fileNode === undefined) {
        return;
      }

      try {
        await vscode.env.clipboard.writeText(
          store.getDataFilePath('config', fileNode.file),
        );
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(
      COMMANDS.copyConfigFileRelativePath,
      async (node?: TreeNode) => {
        const fileNode = getFileNode(node, 'config');
        if (fileNode === undefined) {
          return;
        }

        try {
          await vscode.env.clipboard.writeText(
            store.getDataFileRelativePath('config', fileNode.file),
          );
        } catch (error) {
          showError(error);
        }
      },
    ),
    registerCommand(COMMANDS.renameConfigFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'config');
      if (fileNode === undefined) {
        return;
      }

      try {
        const nextFile = await promptForFileName(
          'Config file name',
          fileNode.file,
        );
        if (nextFile === undefined) {
          return;
        }

        await store.renameDataFile('config', fileNode.file, nextFile);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteConfigFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'config');
      if (fileNode === undefined) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${fileNode.file}?`))) {
          return;
        }

        await store.deleteDataFile('config', fileNode.file);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addConfigEntry, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'config');
      if (fileNode === undefined) {
        return;
      }

      try {
        const profileName = await promptForProfileSelection(store);
        if (profileName === undefined) {
          return;
        }

        const name = await promptForRequiredValue('Config name');
        if (name === undefined) {
          return;
        }

        const target = await store.addConfigEntry(
          fileNode.file,
          name,
          profileName,
        );
        await syncUiWithWorkspace();
        await editorPanel.open(target);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.editItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      try {
        await editorPanel.open(entryNode.target);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.openActiveEditorJson, async () => {
      try {
        await editorPanel.openCurrentAsJson();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.openItemJson, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      try {
        await store.openEntryAsJson(entryNode.target);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.copyItemFilePath, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      try {
        await vscode.env.clipboard.writeText(
          store.getEntryFilePath(entryNode.target),
        );
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(
      COMMANDS.copyItemFileRelativePath,
      async (node?: TreeNode) => {
        const entryNode = getEntryNode(node);
        if (entryNode === undefined) {
          return;
        }

        try {
          await vscode.env.clipboard.writeText(
            store.getEntryFileRelativePath(entryNode.target),
          );
        } catch (error) {
          showError(error);
        }
      },
    ),
    registerCommand(COMMANDS.renameItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      try {
        const nextName = await promptForRequiredValue(
          entryNode.target.kind === 'profile' ? 'Profile name' : 'Config name',
          entryNode.label,
        );
        if (nextName === undefined) {
          return;
        }

        await store.renameEntry(entryNode.target, nextName);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${entryNode.label}?`))) {
          return;
        }

        await store.deleteEntry(entryNode.target);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.enableConfig, async (node?: TreeNode) => {
      await setConfigEnabled(node, true, store, async (file) => {
        queueWatcherEvent('config', file);
        await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
      });
    }),
    registerCommand(COMMANDS.disableConfig, async (node?: TreeNode) => {
      await setConfigEnabled(node, false, store, async (file) => {
        queueWatcherEvent('config', file);
        await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
      });
    }),
    registerCommand(COMMANDS.toggleEnabled, async (node?: TreeNode) => {
      try {
        if (node?.type === 'entry' && node.target.kind === 'config') {
          await store.toggleConfigEnabled(node.target.file, node.target.index);
          queueWatcherEvent('config', node.target.file);
          await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
        } else if (node?.type === 'file' && node.kind === 'config') {
          await store.toggleConfigFileEnabled(node.file);
          queueWatcherEvent('config', node.file);
          await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
        }
      } catch (error) {
        showError(error);
      }
    }),
  );
}

function registerCommand<T extends unknown[]>(
  command: string,
  callback: (...args: T) => unknown,
) {
  return vscode.commands.registerCommand(command, (...args) =>
    callback(...(args as T)),
  );
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.length === 1 ? folders[0] : undefined;
}

async function addProfileEntry(
  store: WorkspaceStore,
  file: string,
  editorPanel: EditorPanelController,
  refreshViews: () => Promise<void>,
): Promise<void> {
  const name = await promptForRequiredValue('Profile name');
  if (name === undefined) {
    return;
  }

  const target = await store.addProfileEntry(file, name);
  await refreshViews();
  await editorPanel.open(target);
}

async function selectOrCreateFile(
  store: WorkspaceStore,
  kind: 'profile' | 'config',
): Promise<string | undefined> {
  const files = await store.listFiles(kind);
  const createLabel = '$(add) Create new file';

  const selection = await vscode.window.showQuickPick(
    [
      ...files.map((file) => ({ label: file, value: file })),
      { label: createLabel, value: '__create__' },
    ],
    {
      placeHolder:
        kind === 'profile' ? 'Choose a profile file' : 'Choose a config file',
    },
  );

  if (selection === undefined) {
    return undefined;
  }

  if (selection.value !== '__create__') {
    return selection.value;
  }

  const fileName = await promptForFileName(
    kind === 'profile' ? 'Profile file name' : 'Config file name',
  );
  if (fileName === undefined) {
    return undefined;
  }

  return store.createDataFile(kind, fileName);
}

async function promptForProfileSelection(
  store: WorkspaceStore,
): Promise<string | undefined> {
  const profileNames = await store.listProfileNames();
  if (profileNames.length === 0) {
    const action = 'Create Profile';
    const selection = await vscode.window.showInformationMessage(
      'Create a profile before adding a config.',
      action,
    );

    if (selection === action) {
      await vscode.commands.executeCommand(COMMANDS.addProfile);
    }

    return undefined;
  }

  const items: ProfileSelectionItem[] = profileNames.map((name) => ({
    label: name,
    value: name,
  }));

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile',
    prompt: 'Choose a profile to use for the new config.',
  });

  if (selection === undefined) {
    return undefined;
  }

  return 'value' in selection ? selection.value : undefined;
}

async function promptForFileName(
  placeHolder: string,
  value?: string,
): Promise<string | undefined> {
  const options: vscode.InputBoxOptions = {
    placeHolder,
    validateInput(value) {
      return value.trim() === '' ? 'A file name is required.' : undefined;
    },
  };
  if (value !== undefined) {
    options.value = value;
  }

  return vscode.window.showInputBox(options);
}

async function promptForRequiredValue(
  placeHolder: string,
  value?: string,
): Promise<string | undefined> {
  const options: vscode.InputBoxOptions = {
    placeHolder,
    validateInput(value) {
      return value.trim() === '' ? 'A value is required.' : undefined;
    },
  };
  if (value !== undefined) {
    options.value = value;
  }

  return vscode.window.showInputBox(options);
}

async function confirmDelete(message: string): Promise<boolean> {
  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Delete',
  );
  return result === 'Delete';
}

async function confirmOverwrite(store: WorkspaceStore): Promise<boolean> {
  const configuration = vscode.workspace.getConfiguration('launch-composer');
  const shouldConfirm = configuration.get<boolean>('confirmOverwrite', true);
  if (!shouldConfirm) {
    return true;
  }

  if (!(await store.launchJsonExists())) {
    return true;
  }

  const result = await vscode.window.showWarningMessage(
    'launch.json will be overwritten. Continue?',
    { modal: true },
    'Yes',
    "Yes, Don't Ask Again",
  );

  if (result === "Yes, Don't Ask Again") {
    await configuration.update(
      'confirmOverwrite',
      false,
      vscode.ConfigurationTarget.Workspace,
    );
    return true;
  }

  return result === 'Yes';
}

function showValidationErrors(errors: ValidationError[]): void {
  const message = errors
    .map((error) => {
      const details = [error.file];
      if (error.configName !== undefined) {
        details.push(error.configName);
      }
      if (error.field !== undefined) {
        details.push(error.field);
      }

      return `${details.join(' / ')}: ${error.message}`;
    })
    .join('\n');

  void vscode.window.showErrorMessage(message);
}

function showError(error: unknown): void {
  const message =
    error instanceof Error ? error.message : 'An unknown error occurred.';
  void vscode.window.showErrorMessage(message);
}

function showWorkspaceRequiredError(): void {
  void vscode.window.showErrorMessage(
    'Launch Composer requires exactly one workspace folder.',
  );
}

function getIssueKey(issue: ComposerDataIssue): string {
  return `${issue.kind}:${issue.file}`;
}

function getIssueFingerprint(issue: ComposerDataIssue): string {
  return `${issue.code}:${issue.message}`;
}

function getFileNode(
  node: TreeNode | undefined,
  kind: 'profile' | 'config',
): Extract<TreeNode, { type: 'file'; kind: 'profile' | 'config' }> | undefined {
  if (node === undefined || node.type !== 'file' || node.kind !== kind) {
    return undefined;
  }

  return node;
}

function getEntryNode(
  node: TreeNode | undefined,
): Extract<TreeNode, { type: 'entry' }> | undefined {
  if (node === undefined || node.type !== 'entry') {
    return undefined;
  }

  return node;
}

async function setConfigEnabled(
  node: TreeNode | undefined,
  enabled: boolean,
  store: WorkspaceStore,
  onDidChange: (file: string) => Promise<void>,
): Promise<void> {
  if (node?.type === 'file' && node.kind === 'config') {
    if (node.enabled === enabled) {
      return;
    }

    try {
      await store.toggleConfigFileEnabled(node.file);
      await onDidChange(node.file);
    } catch (error) {
      showError(error);
    }
    return;
  }

  const entryNode = getEntryNode(node);
  if (entryNode === undefined || entryNode.target.kind !== 'config') {
    return;
  }

  if (entryNode.enabled === enabled) {
    return;
  }

  try {
    await store.toggleConfigEnabled(
      entryNode.target.file,
      entryNode.target.index,
    );
    await onDidChange(entryNode.target.file);
  } catch (error) {
    showError(error);
  }
}

export function deactivate(): void {}
