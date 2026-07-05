import * as vscode from 'vscode';

import { createTextRevision } from './json.js';
import {
  normalizeFileName,
  type DataFileKind,
  type WorkspaceLayout,
} from './workspaceLayout.js';

export type TextFileReadResult =
  { status: 'ok'; text: string } | { status: 'missing' };

export function isMissingFileSystemError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: unknown; name?: unknown };
  return (
    (error instanceof vscode.FileSystemError &&
      /ENOENT|FileNotFound/i.test(error.message)) ||
    errorWithCode.code === 'ENOENT' ||
    (typeof errorWithCode.name === 'string' &&
      /FileNotFound/i.test(errorWithCode.name)) ||
    /ENOENT|FileNotFound/i.test(error.message)
  );
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export class DataFileIo {
  constructor(private readonly layout: WorkspaceLayout) {}

  async readTextFile(uri: vscode.Uri): Promise<TextFileReadResult> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return { status: 'ok', text: decodeText(bytes) };
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return { status: 'missing' };
      }

      throw error;
    }
  }

  async writeTextFile(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, encodeText(text));
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return [];
      }

      throw error;
    }
  }

  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch (error) {
      if (isMissingFileSystemError(error)) {
        return false;
      }

      throw error;
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri);
  }

  async ensureDataDirectory(kind: DataFileKind): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.layout.getComposerDirUri());
    await vscode.workspace.fs.createDirectory(this.layout.getDataDirUri(kind));
  }

  async hasDataFile(kind: DataFileKind, file: string): Promise<boolean> {
    const fileName = normalizeFileName(file);
    const entries = await this.readDirectory(this.layout.getDataDirUri(kind));

    return entries.some(
      ([entryName, fileType]) =>
        entryName === fileName && fileType === vscode.FileType.File,
    );
  }

  async readRequiredDataFileText(
    kind: DataFileKind,
    file: string,
  ): Promise<string> {
    const result = await this.readTextFile(
      this.layout.getDataFileUri(kind, file),
    );
    if (result.status === 'missing') {
      throw new Error(`File not found: ${file}`);
    }

    return result.text;
  }

  async writeDataFileText(
    kind: DataFileKind,
    file: string,
    text: string,
  ): Promise<void> {
    await this.ensureDataDirectory(kind);
    await this.writeTextFile(this.layout.getDataFileUri(kind, file), text);
  }

  async getDataFileRevision(
    kind: DataFileKind,
    file: string,
  ): Promise<string | null> {
    const result = await this.readTextFile(
      this.layout.getDataFileUri(kind, file),
    );
    if (result.status === 'missing') {
      return null;
    }

    return createTextRevision(result.text);
  }
}
