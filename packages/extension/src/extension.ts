import * as vscode from 'vscode';

import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from './commands.js';
import {
  WorkspaceStore,
  type ComposerDataIssue,
  type WorkspaceDataSnapshot,
  type WorkspaceDataWithoutReadiness,
} from './io/workspaceStore.js';
import type { EditorTarget } from './messages.js';
import {
  showError,
  showGenerateBlockedWarning,
  showWorkspaceRequiredError,
} from './notifications/errors.js';
import { IssueReporter } from './notifications/issueReporter.js';
import {
  registerDataWatcher,
  WatcherEchoFilter,
} from './sync/watcherEchoFilter.js';
import {
  LaunchComposerTreeProvider,
  type TreeNode,
} from './treeview/provider.js';
import { EditorPanelController } from './webview/editorPanel.js';

type ProfileSelectionItem =
  { label: string; value: string; description?: string } | vscode.QuickPickItem;
type SnapshotKind = 'profile' | 'config' | 'both';
type DataFileKind = 'profile' | 'config';

const DATA_FILE_COMMANDS = {
  profile: {
    fileNamePlaceHolder: 'Profile file name',
    addFile: COMMANDS.addProfileFile,
    openJson: COMMANDS.openProfileFileJson,
    copyPath: COMMANDS.copyProfileFilePath,
    copyRelativePath: COMMANDS.copyProfileFileRelativePath,
    renameFile: COMMANDS.renameProfileFile,
    deleteFile: COMMANDS.deleteProfileFile,
    addEntry: COMMANDS.addProfileEntry,
  },
  config: {
    fileNamePlaceHolder: 'Config file name',
    addFile: COMMANDS.addConfigFile,
    openJson: COMMANDS.openConfigFileJson,
    copyPath: COMMANDS.copyConfigFilePath,
    copyRelativePath: COMMANDS.copyConfigFileRelativePath,
    renameFile: COMMANDS.renameConfigFile,
    deleteFile: COMMANDS.deleteConfigFile,
    addEntry: COMMANDS.addConfigEntry,
  },
} as const;

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
  const snapshotCache: {
    profiles?: WorkspaceDataSnapshot['profiles'];
    configs?: WorkspaceDataSnapshot['configs'];
    profileIssues?: ComposerDataIssue[];
    configIssues?: ComposerDataIssue[];
  } = {};
  let syncQueue = Promise.resolve();

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

  const getCachedSnapshot = (): WorkspaceDataWithoutReadiness | undefined => {
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

    return store.withGenerateReadiness(getCachedSnapshot() ?? cachedSnapshot);
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
        issueReporter.report(snapshot.issues);
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
      echoFilter.expect(kind, file),
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
        const included = checkboxState === vscode.TreeItemCheckboxState.Checked;

        if (node.type !== 'entry' || node.target.kind !== 'config') {
          continue;
        }

        if (node.included !== included) {
          await store.setConfigExcluded(
            node.target.file,
            node.target.index,
            !included,
          );
          changedFiles.add(node.target.file);
        }
      }

      if (changedFiles.size > 0) {
        changedFiles.forEach((file) => echoFilter.expect('config', file));
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

  const handleGenerate = async (): Promise<{ success: boolean }> => {
    const generated = await store.generateLaunchJson();
    if (!generated.success) {
      await syncUiWithWorkspace({ notifyIssues: false, kind: 'both' });
      showGenerateBlockedWarning(generated.issueCount);
      return { success: false };
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

  const profileWatcher = registerDataWatcher(
    store.getRelativeProfilePattern(),
    'profile',
    echoFilter,
    syncUiWithWorkspace,
    showError,
  );
  const configWatcher = registerDataWatcher(
    store.getRelativeConfigPattern(),
    'config',
    echoFilter,
    syncUiWithWorkspace,
    showError,
  );

  const checkboxSubscription = configView.onDidChangeCheckboxState((event) =>
    handleConfigCheckboxChange(event),
  );

  const syncChangedConfigFile = async (file: string): Promise<void> => {
    echoFilter.expect('config', file);
    await syncUiWithWorkspace({ notifyIssues: false, kind: 'config' });
  };

  const addDataEntry = async (
    kind: DataFileKind,
    file: string,
  ): Promise<void> => {
    if (kind === 'profile') {
      await addProfileEntry(store, file, editorPanel, syncUiWithWorkspace);
      return;
    }

    const profileName = await promptForProfileSelection(store);
    if (profileName === undefined) {
      return;
    }

    const name = await promptForNonEmptyInput(
      'Config name',
      'A value is required.',
    );
    if (name === undefined) {
      return;
    }

    const target = await store.addConfigEntry(file, name, profileName);
    await syncUiWithWorkspace();
    await editorPanel.open(target);
  };

  const registerDataFileCommands = (
    kind: DataFileKind,
  ): vscode.Disposable[] => {
    const commands = DATA_FILE_COMMANDS[kind];

    return [
      registerSafeCommand(commands.addFile, async () => {
        const file = await promptForNonEmptyInput(
          commands.fileNamePlaceHolder,
          'A file name is required.',
        );
        if (file === undefined) {
          return;
        }

        const created = await store.createDataFile(kind, file);
        await syncUiWithWorkspace();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      }),
      registerSafeCommand(commands.openJson, async (node?: TreeNode) => {
        const fileNode = getFileNode(node, kind);
        if (fileNode === undefined) {
          return;
        }

        await store.openDataFileAsJson(kind, fileNode.file);
      }),
      registerSafeCommand(commands.copyPath, async (node?: TreeNode) => {
        const fileNode = getFileNode(node, kind);
        if (fileNode === undefined) {
          return;
        }

        await vscode.env.clipboard.writeText(
          store.getDataFilePath(kind, fileNode.file),
        );
      }),
      registerSafeCommand(
        commands.copyRelativePath,
        async (node?: TreeNode) => {
          const fileNode = getFileNode(node, kind);
          if (fileNode === undefined) {
            return;
          }

          await vscode.env.clipboard.writeText(
            store.getDataFileRelativePath(kind, fileNode.file),
          );
        },
      ),
      registerSafeCommand(commands.renameFile, async (node?: TreeNode) => {
        const fileNode = getFileNode(node, kind);
        if (fileNode === undefined) {
          return;
        }

        const nextFile = await promptForNonEmptyInput(
          commands.fileNamePlaceHolder,
          'A file name is required.',
          fileNode.file,
        );
        if (nextFile === undefined) {
          return;
        }

        await store.renameDataFile(kind, fileNode.file, nextFile);
        await syncUiWithWorkspace();
      }),
      registerSafeCommand(commands.deleteFile, async (node?: TreeNode) => {
        const fileNode = getFileNode(node, kind);
        if (fileNode === undefined) {
          return;
        }

        if (!(await confirmDelete(`Delete ${fileNode.file}?`))) {
          return;
        }

        await store.deleteDataFile(kind, fileNode.file);
        await syncUiWithWorkspace();
      }),
      registerSafeCommand(commands.addEntry, async (node?: TreeNode) => {
        const fileNode = getFileNode(node, kind);
        if (fileNode === undefined) {
          return;
        }

        await addDataEntry(kind, fileNode.file);
      }),
    ];
  };

  context.subscriptions.push(
    profileView,
    configView,
    profileWatcher,
    configWatcher,
    checkboxSubscription,
    registerSafeCommand(COMMANDS.generate, handleGenerate),
    registerSafeCommand(COMMANDS.init, handleInitialize),
    registerSafeCommand(COMMANDS.addProfile, handleAddProfile),
    ...registerDataFileCommands('profile'),
    ...registerDataFileCommands('config'),
    registerSafeCommand(COMMANDS.includeAllConfigs, (node?: TreeNode) =>
      setConfigFileIncluded(node, true, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.excludeAllConfigs, (node?: TreeNode) =>
      setConfigFileIncluded(node, false, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.editItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      await editorPanel.open(entryNode.target);
    }),
    registerSafeCommand(COMMANDS.openActiveEditorJson, () =>
      editorPanel.openCurrentAsJson(),
    ),
    registerSafeCommand(COMMANDS.openItemJson, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      await store.openEntryAsJson(entryNode.target);
    }),
    registerSafeCommand(COMMANDS.copyItemFilePath, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      await vscode.env.clipboard.writeText(
        store.getEntryFilePath(entryNode.target),
      );
    }),
    registerSafeCommand(
      COMMANDS.copyItemFileRelativePath,
      async (node?: TreeNode) => {
        const entryNode = getEntryNode(node);
        if (entryNode === undefined) {
          return;
        }

        await vscode.env.clipboard.writeText(
          store.getEntryFileRelativePath(entryNode.target),
        );
      },
    ),
    registerSafeCommand(COMMANDS.renameItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      const nextName = await promptForNonEmptyInput(
        entryNode.target.kind === 'profile' ? 'Profile name' : 'Config name',
        'A value is required.',
        entryNode.label,
      );
      if (nextName === undefined) {
        return;
      }

      await store.renameEntry(entryNode.target, nextName);
      await syncUiWithWorkspace();
    }),
    registerSafeCommand(COMMANDS.deleteItem, async (node?: TreeNode) => {
      const entryNode = getEntryNode(node);
      if (entryNode === undefined) {
        return;
      }

      if (!(await confirmDelete(`Delete ${entryNode.label}?`))) {
        return;
      }

      await store.deleteEntry(entryNode.target);
      await syncUiWithWorkspace();
    }),
    registerSafeCommand(COMMANDS.includeConfig, (node?: TreeNode) =>
      setConfigIncluded(node, true, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.excludeConfig, (node?: TreeNode) =>
      setConfigIncluded(node, false, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.toggleIncluded, async (node?: TreeNode) => {
      if (node?.type === 'entry' && node.target.kind === 'config') {
        await store.toggleConfigExcluded(node.target.file, node.target.index);
        await syncChangedConfigFile(node.target.file);
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

function registerSafeCommand<T extends unknown[]>(
  command: string,
  callback: (...args: T) => unknown,
) {
  return registerCommand(command, async (...args: T) => {
    try {
      await callback(...args);
    } catch (error) {
      showError(error);
    }
  });
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
  const name = await promptForNonEmptyInput(
    'Profile name',
    'A value is required.',
  );
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

  const fileName = await promptForNonEmptyInput(
    kind === 'profile' ? 'Profile file name' : 'Config file name',
    'A file name is required.',
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

async function promptForNonEmptyInput(
  placeHolder: string,
  requiredMessage: string,
  value?: string,
): Promise<string | undefined> {
  const options: vscode.InputBoxOptions = {
    placeHolder,
    validateInput(value) {
      return value.trim() === '' ? requiredMessage : undefined;
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

async function setConfigIncluded(
  node: TreeNode | undefined,
  included: boolean,
  store: WorkspaceStore,
  onDidChange: (file: string) => Promise<void>,
): Promise<void> {
  const entryNode = getEntryNode(node);
  if (entryNode === undefined || entryNode.target.kind !== 'config') {
    return;
  }

  if (entryNode.included === included) {
    return;
  }

  await store.setConfigExcluded(
    entryNode.target.file,
    entryNode.target.index,
    !included,
  );
  await onDidChange(entryNode.target.file);
}

async function setConfigFileIncluded(
  node: TreeNode | undefined,
  included: boolean,
  store: WorkspaceStore,
  onDidChange: (file: string) => Promise<void>,
): Promise<void> {
  const fileNode = getFileNode(node, 'config');
  if (fileNode === undefined || fileNode.issue !== undefined) {
    return;
  }

  await store.setConfigFileExcluded(fileNode.file, !included);
  await onDidChange(fileNode.file);
}

export function deactivate(): void {}
