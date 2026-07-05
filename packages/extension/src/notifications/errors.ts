import * as vscode from 'vscode';

export function showError(error: unknown): void {
  const message =
    error instanceof Error ? error.message : 'An unknown error occurred.';
  void vscode.window.showErrorMessage(message);
}

export function showWorkspaceRequiredError(): void {
  void vscode.window.showErrorMessage(
    'Launch Composer requires exactly one workspace folder.',
  );
}

export function showGenerateBlockedWarning(issueCount: number): void {
  void vscode.window.showWarningMessage(
    `Generate is blocked by ${issueCount} issue${
      issueCount === 1 ? '' : 's'
    }. Open Launch Composer to review highlighted fields and JSON status.`,
  );
}
