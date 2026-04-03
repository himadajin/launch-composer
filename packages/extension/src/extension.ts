import type { ValidationError } from '@launch-composer/core';
import * as vscode from 'vscode';

import { COMMANDS, CONTRIBUTED_COMMAND_IDS } from './commands.js';
import { WorkspaceStore } from './io/workspaceStore.js';
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

  const refreshViews = (): void => {
    templateProvider.refresh();
    configProvider.refresh();
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
    refreshViews();
    void vscode.window.showInformationMessage(
      `Launch Composer initialized (${result.ensured.join(', ')}).`,
    );
  };

  const handleAddTemplate = async (): Promise<void> => {
    const file = await selectOrCreateFile(store, 'template');
    if (file === undefined) {
      return;
    }

    await addTemplateEntry(store, file, editorPanel, refreshViews);
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
  watcher.onDidCreate(refreshViews);
  watcher.onDidChange(refreshViews);
  watcher.onDidDelete(refreshViews);

  context.subscriptions.push(
    templateView,
    configView,
    watcher,
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
        refreshViews();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteTemplateFile, async (node?: TreeNode) => {
      if (
        node === undefined ||
        node.type !== 'file' ||
        node.kind !== 'template'
      ) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${node.file}?`))) {
          return;
        }

        await store.deleteDataFile('template', node.file);
        refreshViews();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addTemplateEntry, async (node?: TreeNode) => {
      if (
        node === undefined ||
        node.type !== 'file' ||
        node.kind !== 'template'
      ) {
        return;
      }

      try {
        await addTemplateEntry(store, node.file, editorPanel, refreshViews);
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
        refreshViews();
        void vscode.window.showInformationMessage(`Created ${created}.`);
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.deleteConfigFile, async (node?: TreeNode) => {
      if (
        node === undefined ||
        node.type !== 'file' ||
        node.kind !== 'config'
      ) {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${node.file}?`))) {
          return;
        }

        await store.deleteDataFile('config', node.file);
        refreshViews();
      } catch (error) {
        showError(error);
      }
    }),
    registerCommand(COMMANDS.addConfigEntry, async (node?: TreeNode) => {
      if (
        node === undefined ||
        node.type !== 'file' ||
        node.kind !== 'config'
      ) {
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
          node.file,
          name,
          extendsName === '(none)' ? undefined : extendsName,
        );
        refreshViews();
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
    registerCommand(COMMANDS.deleteItem, async (node?: TreeNode) => {
      if (node === undefined || node.type !== 'entry') {
        return;
      }

      try {
        if (!(await confirmDelete(`Delete ${node.label}?`))) {
          return;
        }

        await store.deleteEntry(node.target);
        refreshViews();
      } catch (error) {
        showError(error);
      }
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
        refreshViews();
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
  refreshViews: () => void,
): Promise<void> {
  const name = await promptForRequiredValue('Template name');
  if (name === undefined) {
    return;
  }

  const target = await store.addTemplateEntry(file, name);
  refreshViews();
  await editorPanel.open(target);
}

async function selectOrCreateFile(
  store: WorkspaceStore,
  kind: 'template' | 'config',
): Promise<string | undefined> {
  await store.ensureInitialized();
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
  await store.ensureInitialized();
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
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    placeHolder,
    validateInput(value) {
      return value.trim() === '' ? 'A file name is required.' : undefined;
    },
  });
}

async function promptForRequiredValue(
  placeHolder: string,
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    placeHolder,
    validateInput(value) {
      return value.trim() === '' ? 'A value is required.' : undefined;
    },
  });
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

export function deactivate(): void {}
