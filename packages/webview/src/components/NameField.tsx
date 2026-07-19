import { FormGroup, TextInput } from '@himadajin/vscode-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Entry name field. Unlike the other text fields, the name commits on
 * blur / Enter (not debounced) because renaming flows through the
 * dedicated rename request rather than an entry patch.
 */
export function NameField({
  label,
  description,
  externalName,
  readOnly,
  helper,
  onRename,
}: {
  label: string;
  description: string;
  externalName: string;
  readOnly: boolean;
  helper: ReactNode;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(externalName);
  const externalNameRef = useRef(externalName);
  externalNameRef.current = externalName;

  useEffect(() => {
    setName(externalName);
  }, [externalName]);

  const commitName = async () => {
    if (readOnly || name === externalName) {
      return;
    }

    try {
      await onRename(name);
    } finally {
      setName(externalNameRef.current);
    }
  };

  return (
    <FormGroup
      category="Launch Composer"
      label={label}
      description={description}
      helper={helper}
    >
      <TextInput
        disabled={readOnly}
        value={name}
        onChange={setName}
        onBlur={() => {
          void commitName();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') {
            return;
          }

          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
    </FormGroup>
  );
}
