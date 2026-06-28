import * as vscode from 'vscode';

export const DEFAULT_TEMPLATE_TEXT =
  '// Add profile entries to this array.\n' +
  '// Each profile should have a unique "name".\n' +
  '[]\n';

export const DEFAULT_CONFIG_TEXT =
  '// Configure this file and add entries to "configurations".\n' +
  '// Set "profile" to reference a profile.\n' +
  '{\n' +
  '  "configurations": []\n' +
  '}\n';

export const testVscode = vscode as typeof vscode & {
  __testing: {
    reset(): void;
    createExtensionContext(): unknown;
    setWorkspaceFolders(paths: string[]): void;
    setMissingPathErrorStyle(
      style: 'vscode' | 'enoent' | 'vscode-enoent',
    ): void;
    createGhostFile(filePath: string): void;
    setQuickPickResponses(responses: unknown[]): void;
    setInputBoxResponses(responses: unknown[]): void;
    setInfoMessageResponses(responses: unknown[]): void;
    getRegisteredCommands(): string[];
    getErrorMessages(): string[];
    getInfoMessages(): string[];
    getWarningMessages(): string[];
    getCreatedDirectories(): string[];
    getClipboardText(): string;
    getLastQuickPickCall():
      | {
          items: unknown[];
          options: unknown;
        }
      | undefined;
    getCreatedTreeView(id: string):
      | {
          fireCheckboxChange(event: {
            items: Array<[unknown, vscode.TreeItemCheckboxState]>;
          }): Promise<void>;
        }
      | undefined;
  };
};

export function workspaceUri(name: string): vscode.Uri {
  return vscode.Uri.file(`/workspace/${name}`);
}

export function profileDirUri(workspace: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(
    workspace,
    '.vscode',
    'launch-composer',
    'profiles',
  );
}

export function configDirUri(workspace: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(
    workspace,
    '.vscode',
    'launch-composer',
    'configs',
  );
}

export function profileFileUri(
  workspace: vscode.Uri,
  file = 'profile.json',
): vscode.Uri {
  return vscode.Uri.joinPath(profileDirUri(workspace), file);
}

export function configFileUri(
  workspace: vscode.Uri,
  file = 'config.json',
): vscode.Uri {
  return vscode.Uri.joinPath(configDirUri(workspace), file);
}

export async function writeProfileFile(
  workspace: vscode.Uri,
  file: string,
  text: string,
): Promise<vscode.Uri> {
  await vscode.workspace.fs.createDirectory(profileDirUri(workspace));
  const uri = profileFileUri(workspace, file);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  return uri;
}

export async function writeConfigFile(
  workspace: vscode.Uri,
  file: string,
  text: string,
): Promise<vscode.Uri> {
  await vscode.workspace.fs.createDirectory(configDirUri(workspace));
  const uri = configFileUri(workspace, file);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  return uri;
}

export async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export function configFileNode(file: string): {
  type: 'file';
  kind: 'config';
  file: string;
  configurations: [];
} {
  return {
    type: 'file',
    kind: 'config',
    file,
    configurations: [],
  };
}
