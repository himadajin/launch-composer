import { FormGroup, ListEditor, TextInput } from '@himadajin/vscode-components';
import type { ReactNode } from 'react';

export function ArgsField({
  label,
  args,
  readOnly,
  helper,
  onChange,
}: {
  label: string;
  args: string[] | undefined;
  readOnly: boolean;
  helper: ReactNode;
  onChange: (args: string[]) => void;
}) {
  return (
    <FormGroup
      label={label}
      description="Arguments appended to the debug configuration."
      helper={helper}
      fill
    >
      {readOnly ? (
        <TextInput
          readOnly
          value={(args ?? []).join(', ')}
          style={{ width: '100%', maxWidth: 'none' }}
        />
      ) : (
        <ListEditor
          reorderable
          addPlaceholder="Add argument"
          value={args ?? []}
          onChange={onChange}
        />
      )}
    </FormGroup>
  );
}
