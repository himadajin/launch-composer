import * as vscode from 'vscode';

import type { EditorTarget } from '../messages.js';
import type { WorkspaceStore } from '../io/workspaceStore.js';

/**
 * Shared resolution for the Go to Profile command and the webview
 * `open-profile` request: resolves a referenced profile name to its
 * editor target and opens it, or shows an information message when the
 * reference is unset or missing (see extension.md, "Go to Profile").
 */
export async function openReferencedProfile(
  store: Pick<WorkspaceStore, 'findProfileTarget'>,
  openEditor: (target: EditorTarget) => Promise<void>,
  profileName: unknown,
): Promise<{ opened: boolean }> {
  if (typeof profileName !== 'string' || profileName.trim() === '') {
    void vscode.window.showInformationMessage(
      'This config does not reference a profile.',
    );
    return { opened: false };
  }

  const target = await store.findProfileTarget(profileName);
  if (target === undefined) {
    void vscode.window.showInformationMessage(
      `Profile "${profileName}" was not found.`,
    );
    return { opened: false };
  }

  await openEditor(target);
  return { opened: true };
}
