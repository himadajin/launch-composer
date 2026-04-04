import * as path from 'node:path';

type CommandCallback = (...args: unknown[]) => unknown;

export class Uri {
  constructor(readonly fsPath: string) {}

  static file(fsPath: string): Uri {
    return new Uri(path.resolve(fsPath));
  }

  static joinPath(base: Uri, ...paths: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...paths));
  }

  toString(): string {
    return this.fsPath;
  }
}

export class RelativePattern {
  constructor(
    readonly base: Uri,
    readonly pattern: string,
  ) {}
}

export enum FileType {
  File = 1,
  Directory = 2,
}

export class FileSystemError extends Error {}

type DeleteFileOperation = {
  type: 'deleteFile';
  uri: Uri;
  options?: {
    ignoreIfNotExists?: boolean;
    recursive?: boolean;
    useTrash?: boolean;
  };
};

export class WorkspaceEdit {
  readonly entries: DeleteFileOperation[] = [];

  deleteFile(
    uri: Uri,
    options?: {
      ignoreIfNotExists?: boolean;
      recursive?: boolean;
      useTrash?: boolean;
    },
  ): void {
    const entry: DeleteFileOperation = {
      type: 'deleteFile',
      uri,
    };
    if (options !== undefined) {
      entry.options = options;
    }

    this.entries.push(entry);
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class Selection extends Range {}

export const TextEditorRevealType = {
  InCenter: 0,
} as const;

export const ViewColumn = {
  Active: 1,
} as const;

export const TreeItemCollapsibleState = {
  None: 0,
  Expanded: 2,
} as const;

export class TreeItem {
  contextValue?: string;
  iconPath?: unknown;
  resourceUri?: Uri;
  command?: unknown;
  description?: string;

  constructor(
    readonly label: string,
    readonly collapsibleState: number,
  ) {}
}

export const ConfigurationTarget = {
  Workspace: 1,
} as const;

const registeredCommands = new Map<string, CommandCallback>();
const createdDirectories = new Set<string>();
const files = new Map<string, Uint8Array>();
const ghostFiles = new Set<string>();
const errorMessages: string[] = [];
const infoMessages: string[] = [];
const warningMessages: string[] = [];
let clipboardText = '';
const configuration = new Map<string, unknown>();
const quickPickResponses: unknown[] = [];
const inputBoxResponses: unknown[] = [];
const didDeleteFilesEmitter = new EventEmitter<{ files: Uri[] }>();
let missingPathErrorStyle: 'vscode' | 'enoent' | 'vscode-enoent' = 'vscode';
let lastCreatedWebviewPanel:
  | {
      disposed: boolean;
      title: string;
      webview: {
        html: string;
        onDidReceiveMessage(listener: (message: unknown) => void): {
          dispose(): void;
        };
        postMessage(message: unknown): Promise<boolean>;
        asWebviewUri(uri: Uri): Uri;
      };
      onDidDispose(listener: () => void): { dispose(): void };
      reveal(): void;
      dispose(): void;
    }
  | undefined;

type WorkspaceFolder = {
  index: number;
  name: string;
  uri: Uri;
};

let workspaceFolders: WorkspaceFolder[] | undefined;

function normalize(filePath: string): string {
  return path.normalize(filePath);
}

function ensureDirectory(filePath: string): void {
  const segments = normalize(filePath).split(path.sep);
  let current = segments[0] === '' ? path.sep : segments[0]!;
  if (current !== path.sep) {
    createdDirectories.add(current);
  }

  for (let index = 1; index < segments.length; index += 1) {
    current =
      current === path.sep
        ? path.join(current, segments[index]!)
        : path.join(current, segments[index]!);
    createdDirectories.add(current);
  }
}

function directChildren(targetPath: string): [string, FileType][] {
  const normalizedTarget = normalize(targetPath);
  const entries = new Map<string, FileType>();

  for (const directory of createdDirectories) {
    const parent = path.dirname(directory);
    if (parent !== normalizedTarget) {
      continue;
    }

    entries.set(path.basename(directory), FileType.Directory);
  }

  for (const filePath of files.keys()) {
    const parent = path.dirname(filePath);
    if (parent !== normalizedTarget) {
      continue;
    }

    entries.set(path.basename(filePath), FileType.File);
  }

  for (const filePath of ghostFiles) {
    const parent = path.dirname(filePath);
    if (parent !== normalizedTarget) {
      continue;
    }

    entries.set(path.basename(filePath), FileType.File);
  }

  return [...entries.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
}

function createMissingPathError(targetPath: string, action: string): Error {
  if (missingPathErrorStyle === 'enoent') {
    return Object.assign(
      new Error(`ENOENT: no such file or directory, ${action} '${targetPath}'`),
      {
        code: 'ENOENT',
      },
    );
  }

  if (missingPathErrorStyle === 'vscode-enoent') {
    return new FileSystemError(
      `ENOENT: no such file or directory, ${action} '${targetPath}'`,
    );
  }

  return new FileSystemError(`FileNotFound: ${targetPath}`);
}

export const commands = {
  registerCommand(command: string, callback: CommandCallback) {
    registeredCommands.set(command, callback);
    return {
      dispose() {
        registeredCommands.delete(command);
      },
    };
  },

  async executeCommand<T>(command: string, ...args: unknown[]): Promise<T> {
    const callback = registeredCommands.get(command);
    if (callback === undefined) {
      throw new Error(`Command not found: ${command}`);
    }

    return (await callback(...args)) as T;
  },
};

export const workspace = {
  get workspaceFolders(): WorkspaceFolder[] | undefined {
    return workspaceFolders;
  },

  set workspaceFolders(value: WorkspaceFolder[] | undefined) {
    workspaceFolders = value;
  },

  onDidDeleteFiles(listener: (event: { files: Uri[] }) => void) {
    return didDeleteFilesEmitter.event(listener);
  },

  asRelativePath(uri: Uri, includeWorkspaceFolder = true): string {
    const folder = workspaceFolders?.find((entry) =>
      normalize(uri.fsPath).startsWith(
        `${normalize(entry.uri.fsPath)}${path.sep}`,
      ),
    );

    if (folder === undefined) {
      return normalize(uri.fsPath);
    }

    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    return includeWorkspaceFolder ? path.join(folder.name, relative) : relative;
  },

  fs: {
    async stat(uri: Uri): Promise<{ type: FileType }> {
      const filePath = normalize(uri.fsPath);
      if (files.has(filePath) || ghostFiles.has(filePath)) {
        return { type: FileType.File };
      }

      if (createdDirectories.has(filePath)) {
        return { type: FileType.Directory };
      }

      throw createMissingPathError(filePath, 'stat');
    },

    async createDirectory(uri: Uri): Promise<void> {
      ensureDirectory(uri.fsPath);
    },

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      ensureDirectory(path.dirname(uri.fsPath));
      const filePath = normalize(uri.fsPath);
      ghostFiles.delete(filePath);
      files.set(filePath, content);
    },

    async readFile(uri: Uri): Promise<Uint8Array> {
      const content = files.get(normalize(uri.fsPath));
      if (content === undefined) {
        throw createMissingPathError(uri.fsPath, 'open');
      }

      return content;
    },

    async readDirectory(uri: Uri): Promise<[string, FileType][]> {
      const targetPath = normalize(uri.fsPath);
      if (!createdDirectories.has(targetPath)) {
        throw createMissingPathError(targetPath, 'scandir');
      }

      return directChildren(targetPath);
    },

    async delete(uri: Uri): Promise<void> {
      const targetPath = normalize(uri.fsPath);
      files.delete(targetPath);
      ghostFiles.delete(targetPath);
      createdDirectories.delete(targetPath);
    },
  },

  createFileSystemWatcher() {
    return {
      onDidCreate() {
        return { dispose() {} };
      },
      onDidChange() {
        return { dispose() {} };
      },
      onDidDelete() {
        return { dispose() {} };
      },
      dispose() {},
    };
  },

  getConfiguration(section: string) {
    return {
      get<T>(key: string, defaultValue: T): T {
        const value = configuration.get(`${section}.${key}`);
        return value === undefined ? defaultValue : (value as T);
      },
      async update(key: string, value: unknown): Promise<void> {
        configuration.set(`${section}.${key}`, value);
      },
    };
  },

  async openTextDocument(uri: Uri) {
    const content = await workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);

    return {
      getText() {
        return text;
      },
      positionAt() {
        return new Position(0, 0);
      },
    };
  },

  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    for (const entry of edit.entries) {
      if (entry.type !== 'deleteFile') {
        continue;
      }

      const targetPath = normalize(entry.uri.fsPath);
      if (
        !files.has(targetPath) &&
        !ghostFiles.has(targetPath) &&
        !createdDirectories.has(targetPath)
      ) {
        if (entry.options?.ignoreIfNotExists === true) {
          continue;
        }

        throw createMissingPathError(targetPath, 'unlink');
      }

      await workspace.fs.delete(entry.uri);
      didDeleteFilesEmitter.fire({ files: [entry.uri] });
    }

    return true;
  },
};

export const window = {
  async showErrorMessage(message: string): Promise<undefined> {
    errorMessages.push(message);
    return undefined;
  },

  async showInformationMessage(message: string): Promise<undefined> {
    infoMessages.push(message);
    return undefined;
  },

  async showWarningMessage(message: string): Promise<undefined> {
    warningMessages.push(message);
    return undefined;
  },

  createTreeView() {
    return {
      async reveal() {},
      dispose() {},
    };
  },

  async showQuickPick(): Promise<unknown> {
    return quickPickResponses.shift();
  },

  async showInputBox(): Promise<unknown> {
    return inputBoxResponses.shift();
  },

  createWebviewPanel() {
    const didDisposeEmitter = new EventEmitter<void>();
    const panel = {
      disposed: false,
      title: '',
      webview: {
        html: '',
        onDidReceiveMessage() {
          return { dispose() {} };
        },
        async postMessage() {
          return true;
        },
        asWebviewUri(uri: Uri) {
          return uri;
        },
      },
      onDidDispose(listener: () => void) {
        return didDisposeEmitter.event(listener);
      },
      reveal() {},
      dispose() {
        panel.disposed = true;
        didDisposeEmitter.fire(undefined);
      },
    };

    lastCreatedWebviewPanel = panel;
    return panel;
  },

  async showOpenDialog(): Promise<undefined> {
    return undefined;
  },

  async showTextDocument() {
    return {
      revealRange() {},
      selection: undefined,
    };
  },
};

export const env = {
  clipboard: {
    async writeText(value: string): Promise<void> {
      clipboardText = value;
    },
  },
};

export const __testing = {
  reset(): void {
    registeredCommands.clear();
    createdDirectories.clear();
    files.clear();
    ghostFiles.clear();
    errorMessages.length = 0;
    infoMessages.length = 0;
    warningMessages.length = 0;
    clipboardText = '';
    configuration.clear();
    quickPickResponses.length = 0;
    inputBoxResponses.length = 0;
    workspaceFolders = undefined;
    missingPathErrorStyle = 'vscode';
    didDeleteFilesEmitter.dispose();
    lastCreatedWebviewPanel = undefined;
  },

  createExtensionContext() {
    return {
      extensionUri: Uri.file('/extension'),
      subscriptions: [] as { dispose(): void }[],
    };
  },

  setWorkspaceFolders(paths: string[]): void {
    workspaceFolders = paths.map((fsPath, index) => ({
      index,
      name: path.basename(fsPath),
      uri: Uri.file(fsPath),
    }));
  },

  setMissingPathErrorStyle(style: 'vscode' | 'enoent' | 'vscode-enoent'): void {
    missingPathErrorStyle = style;
  },

  createGhostFile(filePath: string): void {
    ensureDirectory(path.dirname(filePath));
    ghostFiles.add(normalize(filePath));
  },

  setQuickPickResponses(responses: unknown[]): void {
    quickPickResponses.length = 0;
    quickPickResponses.push(...responses);
  },

  setInputBoxResponses(responses: unknown[]): void {
    inputBoxResponses.length = 0;
    inputBoxResponses.push(...responses);
  },

  getRegisteredCommands(): string[] {
    return [...registeredCommands.keys()].sort();
  },

  getErrorMessages(): string[] {
    return [...errorMessages];
  },

  getInfoMessages(): string[] {
    return [...infoMessages];
  },

  getCreatedDirectories(): string[] {
    return [...createdDirectories].sort();
  },

  getClipboardText(): string {
    return clipboardText;
  },

  getLastCreatedWebviewPanel() {
    return lastCreatedWebviewPanel;
  },
};
