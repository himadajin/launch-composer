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
  const templateProvider = new LaunchComposerTreeProvider('template', store);
  const configProvider = new LaunchComposerTreeProvider('config', store);

  const templateView = vscode.window.createTreeView<TreeNode>(
    'launchComposer.templates',
    {
      treeDataProvider: templateProvider,
      showCollapseAll: false,
    },
  );
  const configView = vscode.window.createTreeView<TreeNode>(
    'launchComposer.configs',
    {
      treeDataProvider: configProvider,
      showCollapseAll: false,
    },
  );

  const activeIssues = new Map<string, string>();

  const applySnapshot = (snapshot: WorkspaceDataSnapshot): void => {
    templateProvider.refresh(snapshot);
    configProvider.refresh(snapshot);
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

  const syncUiWithWorkspace = async (options?: {
    notifyIssues?: boolean;
  }): Promise<void> => {
    const snapshot = await store.readAll();
    if (options?.notifyIssues !== false) {
      reportIssues(snapshot.issues);
    }
    applySnapshot(snapshot);
    await editorPanel.syncWithWorkspaceData(snapshot);
  };

  const refreshViews = (): void => {
    void syncUiWithWorkspace({ notifyIssues: false }).catch(showError);
  };

  const revealTarget = async (target: EditorTarget): Promise<void> => {
    await Promise.all([
      templateProvider.reveal(templateView, target),
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

  const handleAddTemplate = async (): Promise<void> => {
    const file = await selectOrCreateFile(store, 'template');
    if (file === undefined) {
      return;
    }

    await addTemplateEntry(store, file, editorPanel, syncUiWithWorkspace);
  };

  const editorPanel = new EditorPanelController({
    context,
    store,
    onDidMutate: refreshViews,
    onDidReveal: revealTarget,
    onDidGenerate: handleGenerate,
  });

  const watcher = vscode.workspace.createFileSystemWatcher(
    store.getRelativeComposerPattern(),
  );
  watcher.onDidCreate(() => {
    void syncUiWithWorkspace({ notifyIssues: false }).catch(showError);
  });
  watcher.onDidChange(() => {
    void syncUiWithWorkspace({ notifyIssues: false }).catch(showError);
  });
  watcher.onDidDelete(() => {
    void syncUiWithWorkspace({ notifyIssues: false }).catch(showError);
  });

  const deleteSubscription = vscode.workspace.onDidDeleteFiles((event) => {
    if (!event.files.some((uri) => store.isComposerDataFile(uri))) {
      return;
    }

    void syncUiWithWorkspace().catch(showError);
  });

  const textChangeSubscription = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (!store.isComposerDataFile(event.document.uri)) {
        return;
      }

      void syncUiWithWorkspace({ notifyIssues: false }).catch(showError);
    },
  );

  const saveSubscription = vscode.workspace.onDidSaveTextDocument(
    (document) => {
      if (!store.isComposerDataFile(document.uri)) {
        return;
      }

      void syncUiWithWorkspace({ notifyIssues: true }).catch(showError);
    },
  );

  context.subscriptions.push(
    templateView,
    configView,
    watcher,
    deleteSubscription,
    textChangeSubscription,
    saveSubscription,
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
    registerCommand(COMMANDS.addTemplate, async () => {
      try {
        await handleAddTemplate();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addTemplateFile, async () => {
      try {
        const file = await promptForFileName('Template file name');
        if (file === undefined) {
          return;
        }

        const created = await store.createDataFile('template', file);
        await syncUiWithWorkspace();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.openTemplateFileJson, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'template');
      if (fileNode === undefined) {
        return;
      }

      try {
        await store.openDataFileAsJson('template', fileNode.file);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.copyTemplateFilePath, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'template');
      if (fileNode === undefined) {
        return;
      }

      try {
        await vscode.env.clipboard.writeText(
          store.getDataFilePath('template', fileNode.file),
        );
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(
      COMMANDS.copyTemplateFileRelativePath,
      async (node?: TreeNode) => {
        const fileNode = getFileNode(node, 'template');
        if (fileNode === undefined) {
          return;
        }

        try {
          await vscode.env.clipboard.writeText(
            store.getDataFileRelativePath('template', fileNode.file),
          );
        } catch (error) {
          showError(error);
        }
      },
    ),
    registerCommand(COMMANDS.renameTemplateFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'template');
      if (fileNode === undefined) {
        return;
      }

      try {
        const nextFile = await promptForFileName(
          'Template file name',
          fileNode.file,
        );
        if (nextFile === undefined) {
          return;
        }

        await store.renameDataFile('template', fileNode.file, nextFile);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteTemplateFile, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'template');
      if (fileNode === undefined) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${fileNode.file}?`))) {
          return;
        }

        await store.deleteDataFile('template', fileNode.file);
        await syncUiWithWorkspace();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addTemplateEntry, async (node?: TreeNode) => {
      const fileNode = getFileNode(node, 'template');
      if (fileNode === undefined) {
        return;
      }

      try {
        await addTemplateEntry(
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
        const extendsName = await promptForTemplateSelection(store);
        if (extendsName === null) {
          return;
        }

        const name = await promptForRequiredValue('Config name');
        if (name === undefined) {
          return;
        }

        const target = await store.addConfigEntry(
          fileNode.file,
          name,
          extendsName === '(none)' ? undefined : extendsName,
        );
        await syncUiWithWorkspace();
        await editorPanel.open(target);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.editItem, async (target?: EditorTarget) => {
      if (target === undefined) {
        return;
      }

      try {
        await editorPanel.open(target);
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
          entryNode.target.kind === 'template'
            ? 'Template name'
            : 'Config name',
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
      await setConfigEnabled(node, true, store, syncUiWithWorkspace);
    }),
    registerCommand(COMMANDS.disableConfig, async (node?: TreeNode) => {
      await setConfigEnabled(node, false, store, syncUiWithWorkspace);
    }),
    registerCommand(COMMANDS.toggleEnabled, async (node?: TreeNode) => {
      if (
        node === undefined ||
        node.type !== 'entry' ||
        node.target.kind !== 'config'
      ) {
        return;
      }

      try {
        await store.toggleConfigEnabled(node.target.file, node.target.index);
        await syncUiWithWorkspace();
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

async function addTemplateEntry(
  store: WorkspaceStore,
  file: string,
  editorPanel: EditorPanelController,
  refreshViews: () => Promise<void>,
): Promise<void> {
  const name = await promptForRequiredValue('Template name');
  if (name === undefined) {
    return;
  }

  const target = await store.addTemplateEntry(file, name);
  await refreshViews();
  await editorPanel.open(target);
}

async function selectOrCreateFile(
  store: WorkspaceStore,
  kind: 'template' | 'config',
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
        kind === 'template' ? 'Choose a template file' : 'Choose a config file',
    },
  );

  if (selection === undefined) {
    return undefined;
  }

  if (selection.value !== '__create__') {
    return selection.value;
  }

  const fileName = await promptForFileName(
    kind === 'template' ? 'Template file name' : 'Config file name',
  );
  if (fileName === undefined) {
    return undefined;
  }

  return store.createDataFile(kind, fileName);
}

async function promptForTemplateSelection(
  store: WorkspaceStore,
): Promise<string | null | undefined> {
  const templateNames = await store.listTemplateNames();
  const selection = await vscode.window.showQuickPick(
    ['(none)', ...templateNames],
    {
      placeHolder: 'Select a template',
    },
  );

  if (selection === undefined) {
    return null;
  }

  return selection;
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
  kind: 'template' | 'config',
):
  | Extract<TreeNode, { type: 'file'; kind: 'template' | 'config' }>
  | undefined {
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
  refresh: () => Promise<void>,
): Promise<void> {
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
    await refresh();
  } catch (error) {
    showError(error);
  }
}

export function deactivate(): void {}
