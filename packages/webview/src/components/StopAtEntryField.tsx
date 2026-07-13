import { Checkbox, FormGroup } from '@himadajin/vscode-components';
import type { ReactNode } from 'react';

export function StopAtEntryField({
  label,
  checked,
  readOnly,
  helper,
  onChange,
}: {
  label: string;
  checked: boolean;
  readOnly: boolean;
  helper: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FormGroup
      label={label}
      description="Pause execution immediately after the program starts."
      modified={checked}
      helper={helper}
    >
      <Checkbox
        toggle
        checked={checked}
        disabled={readOnly}
        label={checked ? 'Enabled' : 'Disabled'}
        onChange={(next) => {
          if (readOnly) {
            return;
          }

          onChange(next);
        }}
      />
    </FormGroup>
  );
}
