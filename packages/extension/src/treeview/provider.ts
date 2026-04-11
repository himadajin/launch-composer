import type {
  ConfigData,
  ConfigFileData,
  ProfileData,
  ProfileFileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
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
  enabled?: boolean;
  profiles?: ProfileData[];
  configurations?: ConfigData[];
};

type EntryNode = {
  type: 'entry';
  target: EditorTarget;
  label: string;
  enabled?: boolean;
  inheritedDisabled?: boolean;
};

export type TreeNode = FileNode | EntryNode;

const DISABLED_BY_FILE_ICON = new vscode.ThemeIcon(
  'circle-slash',
  new vscode.ThemeColor('disabledForeground'),
);

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
            }
          : {
              type: 'entry',
              target: {
                kind: 'config',
                file: element.file,
                index,
              },
              label: (entry as ConfigData).name,
              enabled: (entry as ConfigData).enabled !== false,
              inheritedDisabled: element.enabled === false,
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
            : element.enabled === false
              ? 'configFileDisabled'
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
      } else if (element.kind === 'config') {
        item.checkboxState = toCheckboxState(element.enabled !== false);
        if (element.enabled === false) {
          item.description = 'disabled';
        }
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
        : element.inheritedDisabled
          ? 'configEntryDisabledByFile'
          : element.enabled
            ? 'configEntryEnabled'
            : 'configEntryDisabled';
    item.command = {
      command: 'launch-composer.editItem',
      title: 'Edit',
      arguments: [element],
    };

    if (element.target.kind === 'config') {
      if (element.inheritedDisabled) {
        item.iconPath = DISABLED_BY_FILE_ICON;
        item.description = 'disabled by file';
      } else {
        item.checkboxState = {
          state: toCheckboxState(element.enabled === true),
          tooltip: 'Include this config when generating launch.json.',
        };
        if (!element.enabled) {
          item.description = 'disabled';
        }
      }
    }

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
      const node: FileNode = issue
        ? {
            type: 'file',
            kind: this.kind,
            file,
            issue,
          }
        : this.kind === 'profile'
          ? {
              type: 'file',
              kind: 'profile',
              file,
              profiles:
                (fileData as ProfileFileData | undefined)?.profiles ?? [],
            }
          : {
              type: 'file',
              kind: 'config',
              file,
              ...((fileData as ConfigFileData | undefined)?.enabled ===
              undefined
                ? {}
                : {
                    enabled: (fileData as ConfigFileData).enabled,
                  }),
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
