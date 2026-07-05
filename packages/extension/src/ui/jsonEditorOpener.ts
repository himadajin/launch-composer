import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import { findArrayEntryOffset } from '../io/json.js';
import type { DataFileKind, WorkspaceLayout } from '../io/workspaceLayout.js';

export class JsonEditorOpener {
  constructor(private readonly layout: WorkspaceLayout) {}

  async openDataFileAsJson(kind: DataFileKind, file: string): Promise<void> {
    const uri = this.layout.getDataFileUri(kind, file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: false,
    });
  }

  async openEntryAsJson(target: EditorTarget): Promise<void> {
    const uri = this.layout.getDataFileUri(target.kind, target.file);
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const offset =
      findArrayEntryOffset(
        text,
        target.kind === 'profile'
          ? [target.index]
          : ['configurations', target.index],
      ) ?? 0;
    const position = document.positionAt(offset);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
    editor.selection = new vscode.Selection(position, position);
  }
}
