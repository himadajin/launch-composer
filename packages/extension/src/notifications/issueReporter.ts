import * as vscode from 'vscode';

import type { ComposerDataIssue } from '../messages.js';

/**
 * Shows workspace data issues as warning toasts, de-duplicating repeats:
 * an issue is re-shown only when its message changes or after it has
 * been resolved once.
 */
export class IssueReporter {
  private readonly activeIssues = new Map<string, string>();

  report(issues: ComposerDataIssue[]): void {
    const nextIssues = new Map(
      issues.map((issue) => [getIssueKey(issue), getIssueFingerprint(issue)]),
    );

    for (const issue of issues) {
      const key = getIssueKey(issue);
      const fingerprint = getIssueFingerprint(issue);
      if (this.activeIssues.get(key) === fingerprint) {
        continue;
      }

      this.activeIssues.set(key, fingerprint);
      void vscode.window.showWarningMessage(issue.message);
    }

    for (const key of [...this.activeIssues.keys()]) {
      if (!nextIssues.has(key)) {
        this.activeIssues.delete(key);
      }
    }
  }
}

function getIssueKey(issue: ComposerDataIssue): string {
  return `${issue.kind}:${issue.file}`;
}

function getIssueFingerprint(issue: ComposerDataIssue): string {
  return `${issue.code}:${issue.message}`;
}
