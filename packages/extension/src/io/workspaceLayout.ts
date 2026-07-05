import * as vscode from 'vscode';

export const COMPOSER_DIR = '.vscode/launch-composer';
export const PROFILES_DIR = `${COMPOSER_DIR}/profiles`;
export const CONFIGS_DIR = `${COMPOSER_DIR}/configs`;
export const LAUNCH_FILE = '.vscode/launch.json';

export type DataFileKind = 'profile' | 'config';

export function normalizeFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('File name is required.');
  }

  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}

export class WorkspaceLayout {
  constructor(readonly workspaceRoot: vscode.Uri) {}

  getWorkspaceRootPath(): string {
    return this.workspaceRoot.fsPath;
  }

  getRelativeProfilePattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${PROFILES_DIR}/**/*.json`,
    );
  }

  getRelativeConfigPattern(): vscode.RelativePattern {
    return new vscode.RelativePattern(
      this.workspaceRoot,
      `${CONFIGS_DIR}/**/*.json`,
    );
  }

  getComposerDirUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, COMPOSER_DIR);
  }

  getDataDirUri(kind: DataFileKind): vscode.Uri {
    return vscode.Uri.joinPath(
      this.workspaceRoot,
      kind === 'profile' ? PROFILES_DIR : CONFIGS_DIR,
    );
  }

  getLaunchJsonUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceRoot, LAUNCH_FILE);
  }

  getDataFileUri(kind: DataFileKind, file: string): vscode.Uri {
    return vscode.Uri.joinPath(
      this.getDataDirUri(kind),
      normalizeFileName(file),
    );
  }

  getDataFilePath(kind: DataFileKind, file: string): string {
    return this.getDataFileUri(kind, file).fsPath;
  }

  getDataFileRelativePath(kind: DataFileKind, file: string): string {
    return vscode.workspace.asRelativePath(
      this.getDataFileUri(kind, file),
      false,
    );
  }
}
