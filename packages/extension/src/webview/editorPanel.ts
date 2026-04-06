import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ValidationError } from '@launch-composer/core';
import * as vscode from 'vscode';

import type {
  EntryPatchOperation,
  EditorTarget,
  HostMessage,
  InitialDataPayload,
  WebviewMessage,
} from '../messages.js';
import type {
  WorkspaceDataSnapshot,
  WorkspaceStore,
} from '../io/workspaceStore.js';

interface EditorPanelOptions {
  context: vscode.ExtensionContext;
  store: WorkspaceStore;
  onDidMutate: () => void;
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
    const webviewRoot = vscode.Uri.joinPath(
      this.options.context.extensionUri,
      'dist',
      'webview',
    );

    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel(
        'launchComposer.editor',
        getTitle(target),
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
      this.panel.title = getTitle(target);
    }

    await this.options.onDidReveal(target);
    await this.postInitialData('local');
  }

  async syncWithWorkspace(): Promise<void> {
    await this.syncWithWorkspaceData();
  }

  async syncWithWorkspaceData(data?: WorkspaceDataSnapshot): Promise<void> {
    if (this.panel === undefined || this.currentTarget === undefined) {
      return;
    }

    const snapshot = data ?? (await this.options.store.readAll());
    if (hasInvalidFile(snapshot, this.currentTarget)) {
      await this.postInitialData('local', snapshot);
      return;
    }

    if (!(await this.options.store.hasEntry(this.currentTarget))) {
      this.currentTarget = undefined;
      this.panel.dispose();
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
        case 'update-template':
          await this.applyEntryPatch(message.requestId, 'template', {
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
        case 'browse-file':
          await this.respond(message.requestId, {
            type: 'file-selected',
            requestId: message.requestId,
            payload: {
              path: await browseFile(),
            },
          });
          return;
        case 'open-json':
          await this.options.store.openEntryAsJson(message.payload);
          return;
        case 'open-file-json':
          await this.options.store.openDataFileAsJson(
            message.payload.kind,
            message.payload.file,
          );
          return;
        case 'delete-template':
          await this.deleteEntry(message.requestId, {
            kind: 'template',
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
      this.options.onDidMutate();
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

  private async applyEntryPatch(
    requestId: string,
    kind: 'template' | 'config',
    payload: {
      file: string;
      index: number;
      baseRevision: string | null;
      patches: EntryPatchOperation[];
    },
  ): Promise<void> {
    try {
      const result =
        kind === 'template'
          ? await this.options.store.patchTemplateEntry(
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

      this.options.onDidMutate();
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

function getTitle(target: EditorTarget): string {
  return target.kind === 'template' ? 'Edit Template' : 'Edit Config';
}

function hasInvalidFile(
  data: WorkspaceDataSnapshot,
  target: EditorTarget,
): boolean {
  return data.issues.some(
    (issue) => issue.kind === target.kind && issue.file === target.file,
  );
}
