import type {
  ConfigData,
  ConfigFileData,
  ProfileData,
  ProfileFileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget, GenerateDiagnostic } from '../messages.js';
import type {
  ComposerDataIssue,
  WorkspaceDataSnapshot,
  WorkspaceStore,
} from '../io/workspaceStore.js';

type FileNode = {
  type: 'file';
  kind: 'profile' | 'config';
  file: string;
  issue?: ComposerDataIssue;
  diagnostics?: GenerateDiagnostic[];
  profiles?: ProfileData[];
  configurations?: ConfigData[];
};

type EntryNode = {
  type: 'entry';
  target: EditorTarget;
  label: string;
  included?: boolean;
  diagnostics?: GenerateDiagnostic[];
};

export type TreeNode = FileNode | EntryNode;

function toCheckboxState(
  checked: boolean,
):
  | vscode.TreeItemCheckboxState.Checked
  | vscode.TreeItemCheckboxState.Unchecked {
  return checked
    ? vscode.TreeItemCheckboxState.Checked
    : vscode.TreeItemCheckboxState.Unchecked;
}

export class LaunchComposerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<
    TreeNode | undefined
  >();
  readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  private fileNodes = new Map<string, FileNode>();
  private entryNodes = new Map<string, EntryNode>();
  private snapshot: WorkspaceDataSnapshot | undefined;

  constructor(
    private readonly kind: 'profile' | 'config',
    private readonly store: WorkspaceStore,
  ) {}

  refresh(snapshot?: WorkspaceDataSnapshot): void {
    this.snapshot = snapshot;
    this.fileNodes.clear();
    this.entryNodes.clear();
    this.didChangeTreeDataEmitter.fire(undefined);
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element === undefined) {
      return this.loadRootNodes();
    }

    if (element.type === 'entry' || element.issue !== undefined) {
      return [];
    }

    const entries =
      element.kind === 'profile'
        ? (element.profiles ?? [])
        : (element.configurations ?? []);

    return entries.map((entry, index) => {
      const node: EntryNode =
        element.kind === 'profile'
          ? {
              type: 'entry',
              target: {
                kind: 'profile',
                file: element.file,
                index,
              },
              label: (entry as ProfileData).name,
              diagnostics: getEntryDiagnostics(element.diagnostics, {
                kind: 'profile',
                file: element.file,
                index,
              }),
            }
          : {
              type: 'entry',
              target: {
                kind: 'config',
                file: element.file,
                index,
              },
              label: (entry as ConfigData).name,
              included: (entry as ConfigData).excluded !== true,
              diagnostics: getEntryDiagnostics(element.diagnostics, {
                kind: 'config',
                file: element.file,
                index,
              }),
            };

      this.entryNodes.set(getEntryKey(node.target), node);
      return node;
    });
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'file') {
      const item = new vscode.TreeItem(
        element.file,
        element.issue === undefined
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
      );
      item.id = `file:${element.kind}:${element.file}`;
      item.contextValue =
        element.issue === undefined
          ? element.kind === 'profile'
            ? 'profileFile'
            : 'configFile'
          : element.kind === 'profile'
            ? 'profileFileInvalid'
            : 'configFileInvalid';
      item.resourceUri = this.store.getDataFileUriForTreeItem(
        element.kind,
        element.file,
      );
      if (element.issue !== undefined) {
        item.command = {
          command:
            element.kind === 'profile'
              ? 'launch-composer.openProfileFileJson'
              : 'launch-composer.openConfigFileJson',
          title: 'Open JSON',
          arguments: [element],
        };
        item.iconPath = new vscode.ThemeIcon(
          'warning',
          new vscode.ThemeColor('list.warningForeground'),
        );
        item.description = getIssueDescription(element.issue);
      } else {
        applyDiagnosticDecoration(
          item,
          getFileDiagnostics(element.diagnostics),
        );
      }

      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = getEntryKey(element.target);
    item.contextValue =
      element.target.kind === 'profile'
        ? 'profileEntry'
        : element.included
          ? 'configEntryEnabled'
          : 'configEntryDisabled';
    item.command = {
      command: 'launch-composer.editItem',
      title: 'Edit',
      arguments: [element],
    };

    if (element.target.kind === 'config') {
      item.checkboxState = {
        state: toCheckboxState(element.included === true),
        tooltip: 'Include this config when generating launch.json.',
      };
      if (!element.included) {
        item.description = 'excluded';
      }
    }

    applyDiagnosticDecoration(item, element.diagnostics);

    return item;
  }

  async reveal(
    view: vscode.TreeView<TreeNode>,
    target: EditorTarget,
  ): Promise<void> {
    if (target.kind !== this.kind) {
      return;
    }

    await this.loadRootNodes();
    const node = this.entryNodes.get(getEntryKey(target));
    if (node === undefined) {
      return;
    }

    await view.reveal(node, {
      select: true,
      focus: false,
      expand: true,
    });
  }

  private async loadRootNodes(): Promise<TreeNode[]> {
    const data = this.snapshot ?? (await this.store.readAll());
    const files = this.kind === 'profile' ? data.profiles : data.configs;
    const fileNames = [
      ...files.map((f) => f.file),
      ...data.issues.filter((i) => i.kind === this.kind).map((i) => i.file),
    ].sort((a, b) => a.localeCompare(b));

    this.fileNodes.clear();
    this.entryNodes.clear();

    return fileNames.map((file) => {
      const issue = data.issues.find(
        (candidate) => candidate.kind === this.kind && candidate.file === file,
      );
      const fileData = files.find((candidate) => candidate.file === file);
      const diagnostics = getTreeFileDiagnostics(
        data.generateReadiness.diagnostics,
        this.kind,
        file,
      );
      const node: FileNode = issue
        ? {
            type: 'file',
            kind: this.kind,
            file,
            issue,
            diagnostics,
          }
        : this.kind === 'profile'
          ? {
              type: 'file',
              kind: 'profile',
              file,
              diagnostics,
              profiles:
                (fileData as ProfileFileData | undefined)?.profiles ?? [],
            }
          : {
              type: 'file',
              kind: 'config',
              file,
              diagnostics,
              configurations:
                (fileData as ConfigFileData | undefined)?.configurations ?? [],
            };

      this.fileNodes.set(file, node);
      return node;
    });
  }
}

function getEntryKey(target: EditorTarget): string {
  return `${target.kind}:${target.file}:${target.index}`;
}

function getTreeFileDiagnostics(
  diagnostics: readonly GenerateDiagnostic[],
  kind: 'profile' | 'config',
  file: string,
): GenerateDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.file !== file) {
      return false;
    }

    if (diagnostic.target.kind === kind) {
      return true;
    }

    return (
      diagnostic.target.kind === 'file' &&
      diagnostic.source === 'core-validation' &&
      kind === 'config'
    );
  });
}

function getEntryDiagnostics(
  diagnostics: readonly GenerateDiagnostic[] | undefined,
  target: EditorTarget,
): GenerateDiagnostic[] {
  return (diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.target.kind === target.kind &&
      diagnostic.file === target.file &&
      diagnostic.target.index === target.index,
  );
}

function getFileDiagnostics(
  diagnostics: readonly GenerateDiagnostic[] | undefined,
): GenerateDiagnostic[] {
  return (diagnostics ?? []).filter(
    (diagnostic) => diagnostic.target.kind === 'file',
  );
}

function applyDiagnosticDecoration(
  item: vscode.TreeItem,
  diagnostics: readonly GenerateDiagnostic[] | undefined,
): void {
  const count = diagnostics?.length ?? 0;
  if (count === 0) {
    return;
  }

  const firstDiagnostic = diagnostics?.[0];
  if (firstDiagnostic === undefined) {
    return;
  }

  item.iconPath = new vscode.ThemeIcon(
    'warning',
    new vscode.ThemeColor('list.warningForeground'),
  );
  item.description = appendDescription(
    item.description,
    formatIssueCount(count),
  );
  item.tooltip =
    count === 1
      ? firstDiagnostic.message
      : `${formatIssueCount(count)}. First: ${firstDiagnostic.message}`;
}

function appendDescription(
  current: string | boolean | undefined,
  next: string,
): string {
  return typeof current === 'string' && current !== ''
    ? `${current}, ${next}`
    : next;
}

function formatIssueCount(count: number): string {
  return `${count} issue${count === 1 ? '' : 's'}`;
}

function getIssueDescription(issue: ComposerDataIssue): string {
  switch (issue.code) {
    case 'empty':
      return 'empty file';
    case 'invalid-shape':
      return 'invalid shape';
    case 'invalid-json':
      return 'invalid JSON';
  }
}
