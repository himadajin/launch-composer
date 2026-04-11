import {
  Checkbox,
  FormContainer,
  FormGroup,
  FormHelper,
  ListEditor,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useRef, useState } from 'react';

import type { ComposerDataIssue, ProfileData } from '../types.js';
import type { EntryChange } from './entryChanges.js';
import {
  updateProfileArgs,
  updateProfileCwd,
  updateProfileProgram,
  updateProfileStopAtEntry,
} from './entryChanges.js';
import { stringOrEmpty, useDebouncedCommit } from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';

interface ProfileEditorProps {
  data: ProfileData;
  sourceFile: string;
  autoSaveDelay: number;
  onChange: (change: EntryChange<ProfileData>) => void;
  onRename: (name: string) => Promise<void>;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function ProfileEditor({
  data,
  sourceFile,
  autoSaveDelay,
  onChange,
  onRename,
  onOpenJson,
  readOnlyIssue,
}: ProfileEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const [name, setName] = useState(data.name);
  const [program, setProgram] = useState(
    stringOrEmpty(data.configuration?.program),
  );
  const [cwd, setCwd] = useState(stringOrEmpty(data.configuration?.cwd));
  // Tracks whether each text field was changed by the user (vs. synced from
  // data prop). Reset to false on external data sync; set to true on user
  // input. Mirrors VS Code's "clear handler → set value → re-register handler"
  // pattern so that opening the editor never causes spurious file writes.
  const programChangedByUserRef = useRef(false);
  const cwdChangedByUserRef = useRef(false);

  useEffect(() => {
    setName(data.name);
  }, [data.name]);

  useEffect(() => {
    programChangedByUserRef.current = false;
    setProgram(stringOrEmpty(data.configuration?.program));
  }, [data.configuration?.program]);

  useEffect(() => {
    cwdChangedByUserRef.current = false;
    setCwd(stringOrEmpty(data.configuration?.cwd));
  }, [data.configuration?.cwd]);

  const handleProgramChange = (value: string) => {
    programChangedByUserRef.current = true;
    setProgram(value);
  };

  const handleCwdChange = (value: string) => {
    cwdChangedByUserRef.current = true;
    setCwd(value);
  };

  useDebouncedCommit(program, autoSaveDelay, (value) => {
    if (readOnly || !programChangedByUserRef.current) {
      return;
    }

    onChange(updateProfileProgram(data, value));
  });

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly || !cwdChangedByUserRef.current) {
      return;
    }

    onChange(updateProfileCwd(data, value));
  });

  const commitName = async () => {
    if (readOnly || name === data.name) {
      return;
    }

    await onRename(name);
  };

  return (
    <div className="composer-editor">
      <FormContainer className="composer-form">
        {readOnlyIssue !== undefined ? (
          <FormGroup
            label="JSON Status"
            description={readOnlyIssue.message}
            helper={
              <div className="composer-json-status">
                <FormHelper tone="warning">
                  {readOnlyIssue.details ??
                    'Fix the JSON file to resume form editing.'}
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
        ) : null}

        <FormGroup
          category="Launch Composer"
          label="Profile: Name"
          description="Profile identifier. Config profile references this value."
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

        <FormGroup
          label="Profile: Program"
          description="Program path or expression used by the debugger."
        >
          <TextInput
            disabled={readOnly}
            value={program}
            onChange={handleProgramChange}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Working Directory"
          description="Working directory passed to the debug adapter."
        >
          <TextInput
            disabled={readOnly}
            value={cwd}
            onChange={handleCwdChange}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Stop At Entry"
          description="Pause execution immediately after the program starts."
          modified={data.configuration?.stopAtEntry === true}
        >
          <Checkbox
            toggle
            checked={data.configuration?.stopAtEntry === true}
            disabled={readOnly}
            label={
              data.configuration?.stopAtEntry === true ? 'Enabled' : 'Disabled'
            }
            onChange={(checked) => {
              if (readOnly) {
                return;
              }

              onChange(updateProfileStopAtEntry(data, checked));
            }}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Args"
          description="Arguments appended to the debug configuration."
          fill
        >
          {readOnly ? (
            <TextInput
              readOnly
              value={(data.args ?? []).join(', ')}
              style={{ width: '100%', maxWidth: 'none' }}
            />
          ) : (
            <ListEditor
              reorderable
              addPlaceholder="Add argument"
              value={data.args ?? []}
              onChange={(args) => {
                onChange(updateProfileArgs(data, args));
              }}
            />
          )}
        </FormGroup>

        <EditInJsonHint
          fileLabel={sourceFile}
          description='Edit the source file to change JSON-only fields such as "type" and "request", or to add unsupported properties.'
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
