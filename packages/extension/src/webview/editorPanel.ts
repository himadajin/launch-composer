import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ValidationError } from '@launch-composer/core';
import * as vscode from 'vscode';

import type {
  EntryPatchOperation,
  EditorTarget,
  HostMessage,
  InitialDataPayload,
  WorkspaceUpdatePayload,
  WebviewMessage,
} from '../messages.js';
import type {
  WorkspaceDataSnapshot,
  WorkspaceStore,
} from '../io/workspaceStore.js';

interface EditorPanelOptions {
  context: vscode.ExtensionContext;
  store: WorkspaceStore;
  onDidMutate: (mutation: {
    kind: 'profile' | 'config' | 'both';
    expectedWatchers?: ReadonlyArray<{
      kind: 'profile' | 'config';
      file: string;
    }>;
    syncEditor?: boolean;
  }) => void;
  onDidReveal: (target: EditorTarget) => Promise<void>;
  onDidGenerate: () => Promise<{
    success: boolean;
    errors?: ValidationError[];
  }>;
}

export class EditorPanelController {
  private panel: vscode.WebviewPanel | undefined;
  private currentTarget: EditorTarget | undefined;

  constructor(private readonly options: EditorPanelOptions) {}

  async open(target: EditorTarget): Promise<void> {
    this.currentTarget = target;
    const snapshot = await this.options.store.readAll();
    const webviewRoot = vscode.Uri.joinPath(
      this.options.context.extensionUri,
      'dist',
      'webview',
    );

    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel(
        'launchComposer.editor',
        getTitle(target, snapshot),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [webviewRoot],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentTarget = undefined;
      });

      this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleMessage(message);
      });

      this.panel.webview.html = await getWebviewHtml(
        this.panel.webview,
        webviewRoot,
      );
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.panel.title = getTitle(target, snapshot);
    }

    await this.options.onDidReveal(target);
    await this.postInitialData('local', snapshot);
  }

  async syncWithWorkspace(): Promise<void> {
    await this.syncWithWorkspaceData();
  }

  async openCurrentAsJson(): Promise<void> {
    if (this.currentTarget === undefined) {
      return;
    }

    const snapshot = await this.options.store.readAll();
    if (hasInvalidFile(snapshot, this.currentTarget)) {
      await this.options.store.openDataFileAsJson(
        this.currentTarget.kind,
        this.currentTarget.file,
      );
      return;
    }

    await this.options.store.openEntryAsJson(this.currentTarget);
  }

  async syncWithWorkspaceData(
    data?: WorkspaceDataSnapshot,
    options?: { kind?: 'profile' | 'config' | 'both' },
  ): Promise<void> {
    if (this.panel === undefined || this.currentTarget === undefined) {
      return;
    }

    const syncKind = options?.kind ?? 'both';
    const snapshot = data ?? (await this.options.store.readAll());
    this.panel.title = getTitle(this.currentTarget, snapshot);
    if (!this.shouldSyncCurrentEditor(syncKind)) {
      return;
    }

    if (hasInvalidFile(snapshot, this.currentTarget)) {
      await this.postInitialData('local', snapshot);
      return;
    }

    if (!(await this.options.store.hasEntry(this.currentTarget))) {
      this.currentTarget = undefined;
      this.panel.dispose();
      return;
    }

    if (syncKind !== 'both' && this.shouldPostWorkspaceUpdate(syncKind)) {
      await this.postWorkspaceUpdate('local', snapshot, syncKind);
      return;
    }

    await this.postInitialData('local', snapshot);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'request-initial-data':
          await this.postInitialData(message.requestId);
          return;
        case 'update-profile':
          await this.applyEntryPatch(message.requestId, 'profile', {
            file: message.payload.file,
            index: message.payload.index,
            baseRevision: message.payload.baseRevision,
            patches: message.payload.patches,
          });
          return;
        case 'update-config':
          await this.applyEntryPatch(message.requestId, 'config', {
            file: message.payload.file,
            index: message.payload.index,
            baseRevision: message.payload.baseRevision,
            patches: message.payload.patches,
          });
          return;
        case 'rename-entry':
          await this.renameEntry(
            message.requestId,
            {
              kind: message.payload.kind,
              file: message.payload.file,
              index: message.payload.index,
            },
            message.payload.name,
          );
          return;
        case 'browse-file':
          await this.respond(message.requestId, {
            type: 'file-selected',
            requestId: message.requestId,
            payload: {
              path: await browseFile(),
            },
          });
          return;
        case 'open-file-json':
          await this.options.store.openDataFileAsJson(
            message.payload.kind,
            message.payload.file,
          );
          return;
        case 'delete-profile':
          await this.deleteEntry(message.requestId, {
            kind: 'profile',
            file: message.payload.file,
            index: message.payload.index,
          });
          return;
        case 'delete-config':
          await this.deleteEntry(message.requestId, {
            kind: 'config',
            file: message.payload.file,
            index: message.payload.index,
          });
          return;
        case 'generate':
          await this.respond(message.requestId, {
            type: 'generate-result',
            requestId: message.requestId,
            payload: await this.options.onDidGenerate(),
          });
          return;
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'An unknown error occurred.';
      void vscode.window.showErrorMessage(messageText);
    }
  }

  private async deleteEntry(
    requestId: string,
    target: EditorTarget,
  ): Promise<void> {
    try {
      await this.options.store.deleteEntry(target);
      this.options.onDidMutate({
        kind: target.kind,
        expectedWatchers: [{ kind: target.kind, file: target.file }],
        syncEditor: false,
      });
      await this.syncWithWorkspace();
      await this.respond(requestId, {
        type: 'delete-result',
        requestId,
        payload: { success: true },
      });
    } catch (error) {
      await this.respond(requestId, {
        type: 'delete-result',
        requestId,
        payload: {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to delete entry.',
        },
      });
    }
  }

  private async renameEntry(
    requestId: string,
    target: EditorTarget,
    name: string,
  ): Promise<void> {
    try {
      await this.options.store.renameEntry(target, name);
      this.options.onDidMutate({
        kind: target.kind === 'profile' ? 'both' : 'config',
        expectedWatchers: [{ kind: target.kind, file: target.file }],
        syncEditor: false,
      });
      await this.syncWithWorkspace();
      await this.respond(requestId, {
        type: 'rename-result',
        requestId,
        payload: { success: true },
      });
    } catch (error) {
      await this.respond(requestId, {
        type: 'rename-result',
        requestId,
        payload: {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to rename entry.',
        },
      });
      throw error;
    }
  }

  private async applyEntryPatch(
    requestId: string,
    kind: 'profile' | 'config',
    payload: {
      file: string;
      index: number;
      baseRevision: string | null;
      patches: EntryPatchOperation[];
    },
  ): Promise<void> {
    try {
      const result =
        kind === 'profile'
          ? await this.options.store.patchProfileEntry(
              payload.file,
              payload.index,
              payload.baseRevision,
              payload.patches,
            )
          : await this.options.store.patchConfigEntry(
              payload.file,
              payload.index,
              payload.baseRevision,
              payload.patches,
            );

      if (result.status === 'conflict') {
        await this.respond(requestId, {
          type: 'update-result',
          requestId,
          payload: {
            success: false,
            conflict: true,
            revision: result.revision,
          },
        });
        await this.syncWithWorkspace();
        return;
      }

      this.options.onDidMutate({
        kind,
        expectedWatchers: [{ kind, file: payload.file }],
        syncEditor: false,
      });
      await this.respond(requestId, {
        type: 'update-result',
        requestId,
        payload: {
          success: true,
          revision: result.revision,
        },
      });
    } catch (error) {
      await this.respond(requestId, {
        type: 'update-result',
        requestId,
        payload: {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to update entry.',
        },
      });
      throw error;
    }
  }

  private async postInitialData(
    requestId: string,
    data?: WorkspaceDataSnapshot,
  ): Promise<void> {
    if (this.panel === undefined || this.currentTarget === undefined) {
      return;
    }

    const snapshot = data ?? (await this.options.store.readAll());
    const payload: InitialDataPayload = {
      ...snapshot,
      editor: this.currentTarget,
      editorRevision: await this.options.store.getDataFileRevision(
        this.currentTarget.kind,
        this.currentTarget.file,
      ),
      autoSaveDelay: getAutoSaveDelay(),
    };

    await this.respond(requestId, {
      type: 'initial-data',
      requestId,
      payload,
    });
  }

  private shouldPostWorkspaceUpdate(
    kind: 'profile' | 'config' | 'both',
  ): boolean {
    if (kind === 'both' || this.currentTarget === undefined) {
      return false;
    }

    return (
      this.currentTarget.kind === kind ||
      (kind === 'profile' && this.currentTarget.kind === 'config')
    );
  }

  private shouldSyncCurrentEditor(
    kind: 'profile' | 'config' | 'both',
  ): boolean {
    if (kind === 'both' || this.currentTarget === undefined) {
      return true;
    }

    return (
      this.currentTarget.kind === kind ||
      (kind === 'profile' && this.currentTarget.kind === 'config')
    );
  }

  private async postWorkspaceUpdate(
    requestId: string,
    data: WorkspaceDataSnapshot,
    kind: 'profile' | 'config',
  ): Promise<void> {
    if (this.currentTarget === undefined) {
      return;
    }

    const payload: WorkspaceUpdatePayload = {
      kind,
      ...(kind === 'profile'
        ? { profiles: data.profiles }
        : { configs: data.configs }),
      issues: data.issues.filter((issue) => issue.kind === kind),
      ...(this.currentTarget.kind === kind
        ? {
            editorRevision: await this.options.store.getDataFileRevision(
              this.currentTarget.kind,
              this.currentTarget.file,
            ),
          }
        : {}),
    };

    await this.respond(requestId, {
      type: 'workspace-update',
      requestId,
      payload,
    });
  }

  private async respond(
    requestId: string,
    message: HostMessage,
  ): Promise<void> {
    if (this.panel === undefined) {
      return;
    }

    await this.panel.webview.postMessage(message);
  }
}

async function getWebviewHtml(
  webview: vscode.Webview,
  webviewRoot: vscode.Uri,
): Promise<string> {
  const indexPath = path.join(webviewRoot.fsPath, 'index.html');
  let html: string;

  try {
    html = await fs.readFile(indexPath, 'utf8');
  } catch {
    return [
      '<!doctype html>',
      '<html lang="en"><body>',
      '<p>Webview assets are missing. Run the webview build first.</p>',
      '</body></html>',
    ].join('');
  }

  const replacedScripts = html.replace(
    /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
    (_match, src: string) => {
      const assetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewRoot, src),
      );
      return `<script type="module" src="${assetUri.toString()}"></script>`;
    },
  );

  return replacedScripts.replace(
    /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
    (_match, href: string) => {
      const assetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewRoot, href),
      );
      return `<link rel="stylesheet" href="${assetUri.toString()}">`;
    },
  );
}

async function browseFile(): Promise<string | null> {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
  });

  return result?.[0]?.fsPath ?? null;
}

function getAutoSaveDelay(): number {
  return vscode.workspace
    .getConfiguration('launch-composer')
    .get<number>('autoSaveDelay', 1000);
}

function getTitle(target: EditorTarget, data: WorkspaceDataSnapshot): string {
  const entryName = resolveEntryName(target, data);
  return entryName !== undefined ? entryName : path.basename(target.file);
}

function resolveEntryName(
  target: EditorTarget,
  data: WorkspaceDataSnapshot,
): string | undefined {
  const name =
    target.kind === 'profile'
      ? data.profiles.find((fileData) => fileData.file === target.file)
          ?.profiles[target.index]?.name
      : data.configs.find((fileData) => fileData.file === target.file)
          ?.configurations[target.index]?.name;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return undefined;
  }

  return name;
}

function hasInvalidFile(
  data: WorkspaceDataSnapshot,
  target: EditorTarget,
): boolean {
  return data.issues.some(
    (issue) => issue.kind === target.kind && issue.file === target.file,
  );
}
