import { Checkbox, FormGroup } from '@himadajin/vscode-components';
import type { ReactNode } from 'react';

export interface StopAtEntryOverride {
  /** Toggle label: `Override` on configs, `Set` on profiles. */
  label: string;
  overridden: boolean;
  onToggle: (next: boolean) => void;
}

export function StopAtEntryField({
  label,
  checked,
  readOnly,
  helper,
  override,
  onChange,
}: {
  label: string;
  checked: boolean;
  readOnly: boolean;
  helper: ReactNode;
  override: StopAtEntryOverride;
  onChange: (checked: boolean) => void;
}) {
  const valueDisabled = readOnly || !override.overridden;

  return (
    <FormGroup
      label={label}
      description="Pause execution immediately after the program starts."
      modified={override.overridden}
      helper={helper}
    >
      <div className="composer-override-field">
        <Checkbox
          checked={override.overridden}
          disabled={readOnly}
          label={override.label}
          onChange={(next) => {
            if (readOnly) {
              return;
            }

            override.onToggle(next);
          }}
        />
        <Checkbox
          toggle
          checked={checked}
          disabled={valueDisabled}
          label={checked ? 'Enabled' : 'Disabled'}
          onChange={(next) => {
            if (valueDisabled) {
              return;
            }

            onChange(next);
          }}
        />
      </div>
    </FormGroup>
  );
}
