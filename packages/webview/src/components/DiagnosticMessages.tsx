import { FormGroup, FormHelper, TextInput } from '@himadajin/vscode-components';
import type { ReactNode } from 'react';

import type { GenerateDiagnostic } from '../types.js';
import { formatDiagnostic } from './generateReadiness.js';

export function renderHelperMessages(
  messages: readonly string[],
): ReactNode | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  return (
    <div className="composer-diagnostic-list">
      {messages.map((message, index) => (
        <FormHelper key={`${message}:${index}`} tone="warning">
          {message}
        </FormHelper>
      ))}
    </div>
  );
}

export function EntryIssuesRow({
  diagnostics,
  sourceFile,
  onOpenJson,
}: {
  diagnostics: readonly GenerateDiagnostic[];
  sourceFile: string;
  onOpenJson: () => void;
}) {
  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <FormGroup
      label="Entry Issues"
      description="Generate diagnostics that are not tied to a visible field."
      helper={
        <div className="composer-json-status">
          <div className="composer-diagnostic-list">
            {diagnostics.map((diagnostic, index) => (
              <FormHelper
                key={`${diagnostic.file}:${diagnostic.field ?? ''}:${index}`}
                tone="warning"
              >
                {formatDiagnostic(diagnostic)}
              </FormHelper>
            ))}
          </div>
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
        value={`${diagnostics.length} issue${
          diagnostics.length === 1 ? '' : 's'
        }`}
        style={{ width: '100%', maxWidth: 'none' }}
      />
    </FormGroup>
  );
}
