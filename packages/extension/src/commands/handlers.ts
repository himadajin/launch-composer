import * as vscode from 'vscode';

import { COMMANDS } from '../commands.js';
import type { WorkspaceStore } from '../io/workspaceStore.js';
import type { MutationResult } from '../io/workspaceMutations.js';
import type { DataFileKind } from '../io/workspaceLayout.js';
import {
  showError,
  showGenerateBlockedWarning,
} from '../notifications/errors.js';
import {
  expectDataFileWrites,
  type WatcherEchoFilter,
} from '../sync/watcherEchoFilter.js';
import type { SyncOptions } from '../sync/workspaceSyncController.js';
import type { TreeNode } from '../treeview/provider.js';
import type { EditorPanelController } from '../webview/editorPanel.js';

type ProfileSelectionItem =
  { label: string; value: string; description?: string } | vscode.QuickPickItem;

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

export interface CommandDeps {
  store: WorkspaceStore;
  editorPanel: EditorPanelController;
  echoFilter: WatcherEchoFilter;
  sync: (options?: SyncOptions) => Promise<void>;
  handleGenerate: () => Promise<{ success: boolean }>;
}

export function registerCommand<T extends unknown[]>(
  command: string,
  callback: (...args: T) => unknown,
) {
  return vscode.commands.registerCommand(command, (...args) =>
    callback(...(args as T)),
  );
}

export function registerSafeCommand<T extends unknown[]>(
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

export function createGenerateHandler(
  store: WorkspaceStore,
  sync: (options?: SyncOptions) => Promise<void>,
): () => Promise<{ success: boolean }> {
  return async () => {
    const generated = await store.generateLaunchJson();
    if (!generated.success) {
      await sync({ notifyIssues: false, kind: 'both' });
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
}

export function createConfigCheckboxHandler(
  deps: Pick<CommandDeps, 'store' | 'echoFilter' | 'sync'>,
): (event: vscode.TreeCheckboxChangeEvent<TreeNode>) => Promise<void> {
  return async (event) => {
    try {
      const changedFiles = new Set<string>();
      const writtenFiles: MutationResult['writtenFiles'] = [];

      for (const [node, checkboxState] of event.items) {
        const included = checkboxState === vscode.TreeItemCheckboxState.Checked;

        if (node.type !== 'entry' || node.target.kind !== 'config') {
          continue;
        }

        if (node.included !== included) {
          const result = await deps.store.setConfigExcluded(
            node.target.file,
            node.target.index,
            !included,
          );
          changedFiles.add(node.target.file);
          writtenFiles.push(...result.writtenFiles);
        }
      }

      if (changedFiles.size > 0) {
        expectDataFileWrites(deps.echoFilter, writtenFiles);
        await deps.sync({ notifyIssues: false, kind: 'config' });
      }
    } catch (error) {
      showError(error);
    }
  };
}

export function registerWorkspaceCommands(
  deps: CommandDeps,
): vscode.Disposable[] {
  const { store, editorPanel, echoFilter, sync, handleGenerate } = deps;

  const syncChangedConfigFile = async (
    result: MutationResult,
  ): Promise<void> => {
    expectDataFileWrites(echoFilter, result.writtenFiles);
    await sync({ notifyIssues: false, kind: 'config' });
  };

  const handleInitialize = async (): Promise<void> => {
    const result = await store.ensureInitialized();
    await sync();
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

    await addProfileEntry(store, file, editorPanel, sync);
  };

  const addDataEntry = async (
    kind: DataFileKind,
    file: string,
  ): Promise<void> => {
    if (kind === 'profile') {
      await addProfileEntry(store, file, editorPanel, sync);
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
    await sync();
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
        await sync();
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
        await sync();
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
        await sync();
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

  return [
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
      await sync();
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
      await sync();
    }),
    registerSafeCommand(COMMANDS.includeConfig, (node?: TreeNode) =>
      setConfigIncluded(node, true, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.excludeConfig, (node?: TreeNode) =>
      setConfigIncluded(node, false, store, syncChangedConfigFile),
    ),
    registerSafeCommand(COMMANDS.toggleIncluded, async (node?: TreeNode) => {
      if (node?.type === 'entry' && node.target.kind === 'config') {
        const result = await store.toggleConfigExcluded(
          node.target.file,
          node.target.index,
        );
        await syncChangedConfigFile(result);
      }
    }),
  ];
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
  kind: DataFileKind,
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
  kind: DataFileKind,
): Extract<TreeNode, { type: 'file'; kind: DataFileKind }> | undefined {
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
  onDidChange: (result: MutationResult) => Promise<void>,
): Promise<void> {
  const entryNode = getEntryNode(node);
  if (entryNode === undefined || entryNode.target.kind !== 'config') {
    return;
  }

  if (entryNode.included === included) {
    return;
  }

  const result = await store.setConfigExcluded(
    entryNode.target.file,
    entryNode.target.index,
    !included,
  );
  await onDidChange(result);
}

async function setConfigFileIncluded(
  node: TreeNode | undefined,
  included: boolean,
  store: WorkspaceStore,
  onDidChange: (result: MutationResult) => Promise<void>,
): Promise<void> {
  const fileNode = getFileNode(node, 'config');
  if (fileNode === undefined || fileNode.issue !== undefined) {
    return;
  }

  const result = await store.setConfigFileExcluded(fileNode.file, !included);
  await onDidChange(result);
}
