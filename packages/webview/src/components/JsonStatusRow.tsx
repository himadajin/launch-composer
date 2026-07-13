import { FormGroup, FormHelper, TextInput } from '@himadajin/vscode-components';

import type { ComposerDataIssue } from '../types.js';

export function JsonStatusRow({
  issue,
  sourceFile,
  onOpenJson,
}: {
  issue: ComposerDataIssue | undefined;
  sourceFile: string;
  onOpenJson: () => void;
}) {
  if (issue === undefined) {
    return null;
  }

  return (
    <FormGroup
      label="JSON Status"
      description={issue.message}
      helper={
        <div className="composer-json-status">
          <FormHelper tone="warning">
            {issue.details ?? 'Fix the JSON file to resume form editing.'}
          </FormHelper>
          <button
            type="button"
            className="composer-json-link"
            onClick={onOpenJson}
          >
            Edit in {sourceFile}
          </button>
        </div>
      }
      fill
    >
      <TextInput
        readOnly
        value={sourceFile}
        style={{ width: '100%', maxWidth: 'none' }}
      />
    </FormGroup>
  );
}
