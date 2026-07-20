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
import { COMMANDS } from '../commands.js';

type DataKind = 'profile' | 'config';

type SectionNode = {
  type: 'section';
  kind: DataKind;
};

type FileNode = {
  type: 'file';
  kind: DataKind;
  file: string;
  issue?: ComposerDataIssue;
  diagnostics?: GenerateDiagnostic[];
  profiles?: ProfileData[];
  configurations?: ConfigData[];
};

type EntryNode = {
  type: 'entry';
  parent: FileNode;
  target: EditorTarget;
  label: string;
  included?: boolean;
  diagnostics?: GenerateDiagnostic[];
};

export type TreeNode = SectionNode | FileNode | EntryNode;

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

  /**
   * Section nodes are singletons held for the provider's lifetime so that
   * `getParent` returns the same instances `getChildren` produced, which
   * `TreeView.reveal` requires to resolve the ancestor chain.
   */
  private readonly sectionNodes: Record<DataKind, SectionNode> = {
    config: { type: 'section', kind: 'config' },
    profile: { type: 'section', kind: 'profile' },
  };

  private entryNodes = new Map<string, EntryNode>();
  private snapshot: WorkspaceDataSnapshot | undefined;

  constructor(private readonly store: WorkspaceStore) {}

  refresh(snapshot?: WorkspaceDataSnapshot): void {
    this.snapshot = snapshot;
    this.entryNodes.clear();
    this.didChangeTreeDataEmitter.fire(undefined);
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element === undefined) {
      return this.loadSectionNodes();
    }

    if (element.type === 'section') {
      return this.loadFileNodes(element.kind);
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
              parent: element,
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
              parent: element,
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

  getParent(element: TreeNode): TreeNode | undefined {
    if (element.type === 'entry') {
      return element.parent;
    }
    if (element.type === 'file') {
      return this.sectionNodes[element.kind];
    }
    return undefined;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'section') {
      const item = new vscode.TreeItem(
        element.kind === 'config' ? 'Configs' : 'Profiles',
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `section:${element.kind}`;
      item.contextValue =
        element.kind === 'config' ? 'configSection' : 'profileSection';
      return item;
    }

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
              ? COMMANDS.openProfileFileJson
              : COMMANDS.openConfigFileJson,
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
      command: COMMANDS.editItem,
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
    const sectionNodes = await this.loadSectionNodes();
    const sectionNode = sectionNodes.find(
      (node): node is SectionNode =>
        node.type === 'section' && node.kind === target.kind,
    );
    if (sectionNode === undefined) {
      return;
    }

    const fileNodes = await this.loadFileNodes(sectionNode.kind);
    const fileNode = fileNodes.find(
      (node): node is FileNode =>
        node.type === 'file' && node.file === target.file,
    );
    if (fileNode === undefined) {
      return;
    }

    await this.getChildren(fileNode);
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

  private async loadSectionNodes(): Promise<TreeNode[]> {
    const data = await this.loadData();
    if (
      data.profiles.length === 0 &&
      data.configs.length === 0 &&
      data.issues.length === 0
    ) {
      return [];
    }

    return [this.sectionNodes.config, this.sectionNodes.profile];
  }

  private async loadFileNodes(kind: DataKind): Promise<TreeNode[]> {
    const data = await this.loadData();
    const files = kind === 'profile' ? data.profiles : data.configs;
    const fileNames = [
      ...files.map((f) => f.file),
      ...data.issues.filter((i) => i.kind === kind).map((i) => i.file),
    ].sort((a, b) => a.localeCompare(b));

    return fileNames.map((file) => {
      const issue = data.issues.find(
        (candidate) => candidate.kind === kind && candidate.file === file,
      );
      const fileData = files.find((candidate) => candidate.file === file);
      const diagnostics = getTreeFileDiagnostics(
        data.generateReadiness.diagnostics,
        kind,
        file,
      );
      const node: FileNode = issue
        ? {
            type: 'file',
            kind,
            file,
            issue,
            diagnostics,
          }
        : kind === 'profile'
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

      return node;
    });
  }

  /**
   * Reads the workspace once and keeps the result until the next refresh,
   * so expanding both sections does not trigger a second read when no
   * snapshot was pushed by the sync controller.
   */
  private async loadData(): Promise<WorkspaceDataSnapshot> {
    if (this.snapshot === undefined) {
      this.snapshot = await this.store.readAll();
    }

    return this.snapshot;
  }
}

function getEntryKey(target: EditorTarget): string {
  return `${target.kind}:${target.file}:${target.index}`;
}

function getTreeFileDiagnostics(
  diagnostics: readonly GenerateDiagnostic[],
  kind: DataKind,
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
