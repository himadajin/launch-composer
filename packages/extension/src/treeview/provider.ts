import type {
  ConfigData,
  ConfigFileData,
  TemplateData,
  TemplateFileData,
} from '@launch-composer/core';
import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import type { WorkspaceStore } from '../io/workspaceStore.js';

type FileNode = {
  type: 'file';
  kind: 'template' | 'config';
  file: string;
  templates?: TemplateData[];
  configs?: ConfigData[];
};

type EntryNode = {
  type: 'entry';
  target: EditorTarget;
  label: string;
  enabled?: boolean;
};

export type TreeNode = FileNode | EntryNode;

export class LaunchComposerTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<
    TreeNode | undefined
  >();
  readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  private fileNodes = new Map<string, FileNode>();
  private entryNodes = new Map<string, EntryNode>();

  constructor(
    private readonly kind: 'template' | 'config',
    private readonly store: WorkspaceStore,
  ) {}

  refresh(): void {
    this.fileNodes.clear();
    this.entryNodes.clear();
    this.didChangeTreeDataEmitter.fire(undefined);
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element === undefined) {
      return this.loadRootNodes();
    }

    if (element.type === 'entry') {
      return [];
    }

    const entries =
      element.kind === 'template'
        ? (element.templates ?? [])
        : (element.configs ?? []);

    return entries.map((entry, index) => {
      const node: EntryNode =
        element.kind === 'template'
          ? {
              type: 'entry',
              target: {
                kind: 'template',
                file: element.file,
                index,
              },
              label: (entry as TemplateData).name,
            }
          : {
              type: 'entry',
              target: {
                kind: 'config',
                file: element.file,
                index,
              },
              label: (entry as ConfigData).name,
              enabled: (entry as ConfigData).enabled === true,
            };

      this.entryNodes.set(getEntryKey(node.target), node);
      return node;
    });
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'file') {
      const item = new vscode.TreeItem(
        element.file,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue =
        element.kind === 'template' ? 'templateFile' : 'configFile';
      item.iconPath = new vscode.ThemeIcon('file-code');
      return item;
    }

    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue =
      element.target.kind === 'template' ? 'templateEntry' : 'configEntry';
    item.command = {
      command: 'launch-composer.editItem',
      title: 'Edit',
      arguments: [element.target],
    };

    if (element.target.kind === 'config') {
      item.iconPath = element.enabled
        ? new vscode.ThemeIcon(
            'pass-filled',
            new vscode.ThemeColor('testing.iconPassed'),
          )
        : new vscode.ThemeIcon(
            'circle-large-outline',
            new vscode.ThemeColor('descriptionForeground'),
          );
      if (!element.enabled) {
        item.description = 'disabled';
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
    const data = await this.store.readAll();
    const files = this.kind === 'template' ? data.templates : data.configs;

    this.fileNodes.clear();
    this.entryNodes.clear();

    return files.map((fileData) => {
      const node: FileNode =
        this.kind === 'template'
          ? {
              type: 'file',
              kind: 'template',
              file: fileData.file,
              templates: (fileData as TemplateFileData).templates,
            }
          : {
              type: 'file',
              kind: 'config',
              file: fileData.file,
              configs: (fileData as ConfigFileData).configs,
            };

      this.fileNodes.set(fileData.file, node);
      return node;
    });
  }
}

function getEntryKey(target: EditorTarget): string {
  return `${target.kind}:${target.file}:${target.index}`;
}
