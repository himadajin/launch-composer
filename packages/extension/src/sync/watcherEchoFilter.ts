import * as path from 'node:path';

import * as vscode from 'vscode';

import type { DataFileKind } from '../io/workspaceLayout.js';

/**
 * Suppresses file-watcher echoes for changes the extension itself wrote.
 * Callers register confirmed writes; the next watcher event for each
 * written file is swallowed.
 */
export class WatcherEchoFilter {
  private readonly pendingEvents = new Map<string, number>();

  expect(kind: DataFileKind, file: string): void {
    const key = `${kind}:${file}`;
    this.pendingEvents.set(key, (this.pendingEvents.get(key) ?? 0) + 1);
  }

  shouldIgnore(kind: DataFileKind, uri: vscode.Uri): boolean {
    const key = `${kind}:${path.basename(uri.fsPath)}`;
    const remaining = this.pendingEvents.get(key);
    if (remaining === undefined) {
      return false;
    }

    if (remaining <= 1) {
      this.pendingEvents.delete(key);
    } else {
      this.pendingEvents.set(key, remaining - 1);
    }

    return true;
  }
}

/** Registers at most one expected watcher event for each written data file. */
export function expectDataFileWrites(
  echoFilter: WatcherEchoFilter,
  writes: ReadonlyArray<{ kind: DataFileKind; file: string }>,
): void {
  const expected = new Set<string>();

  for (const { kind, file } of writes) {
    const key = `${kind}:${file}`;
    if (expected.has(key)) {
      continue;
    }

    expected.add(key);
    echoFilter.expect(kind, file);
  }
}

export function registerDataWatcher(
  pattern: vscode.RelativePattern,
  kind: DataFileKind,
  echoFilter: WatcherEchoFilter,
  sync: (options: {
    notifyIssues?: boolean;
    kind: DataFileKind;
  }) => Promise<void>,
  onError: (error: unknown) => void,
): vscode.FileSystemWatcher {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  watcher.onDidCreate((uri) => {
    if (echoFilter.shouldIgnore(kind, uri)) {
      return;
    }
    void sync({ notifyIssues: false, kind }).catch(onError);
  });
  watcher.onDidChange((uri) => {
    if (echoFilter.shouldIgnore(kind, uri)) {
      return;
    }
    void sync({ notifyIssues: true, kind }).catch(onError);
  });
  watcher.onDidDelete((uri) => {
    if (echoFilter.shouldIgnore(kind, uri)) {
      return;
    }
    void sync({ kind }).catch(onError);
  });

  return watcher;
}
