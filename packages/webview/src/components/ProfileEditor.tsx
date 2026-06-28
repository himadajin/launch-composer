import {
  Checkbox,
  FormContainer,
  FormGroup,
  FormHelper,
  ListEditor,
  Select,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useRef, useState } from 'react';

import type {
  ComposerDataIssue,
  GenerateDiagnostic,
  ProfileData,
} from '../types.js';
import { EntryIssuesRow, renderHelperMessages } from './DiagnosticMessages.js';
import type { EntryChange } from './entryChanges.js';
import {
  updateProfileArgs,
  updateProfileCwd,
  updateProfileProgram,
  updateProfileRequest,
  updateProfileStopAtEntry,
  updateProfileType,
} from './entryChanges.js';
import {
  isDebugRequestOption,
  isInternalProfileRequestSelectValue,
  resolveProfileRequestSelectState,
} from './profileRequestSelect.js';
import {
  getEntryIssueDiagnostics,
  getFieldDiagnosticMessages,
  mergeHelperMessages,
} from './generateReadiness.js';
import { stringOrEmpty, useDebouncedCommit } from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';

const PROFILE_VISIBLE_DIAGNOSTIC_FIELDS = [
  'name',
  'configuration.type',
  'configuration.request',
  'configuration.program',
  'configuration.cwd',
  'configuration.stopAtEntry',
  'args',
] as const;

interface ProfileEditorProps {
  data: ProfileData;
  sourceFile: string;
  autoSaveDelay: number;
  diagnostics?: GenerateDiagnostic[];
  onChange: (change: EntryChange<ProfileData>) => void;
  onRename: (name: string) => Promise<void>;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function ProfileEditor({
  data,
  sourceFile,
  autoSaveDelay,
  diagnostics = [],
  onChange,
  onRename,
  onOpenJson,
  readOnlyIssue,
}: ProfileEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const [name, setName] = useState(data.name);
  const [type, setType] = useState(stringOrEmpty(data.configuration?.type));
  const [program, setProgram] = useState(
    stringOrEmpty(data.configuration?.program),
  );
  const [cwd, setCwd] = useState(stringOrEmpty(data.configuration?.cwd));
  // Tracks whether each text field was changed by the user (vs. synced from
  // data prop). Reset to false on external data sync; set to true on user
  // input. Mirrors VS Code's "clear handler → set value → re-register handler"
  // pattern so that opening the editor never causes spurious file writes.
  const typeChangedByUserRef = useRef(false);
  const programChangedByUserRef = useRef(false);
  const cwdChangedByUserRef = useRef(false);

  useEffect(() => {
    setName(data.name);
  }, [data.name]);

  useEffect(() => {
    typeChangedByUserRef.current = false;
    setType(stringOrEmpty(data.configuration?.type));
  }, [data.configuration?.type]);

  useEffect(() => {
    programChangedByUserRef.current = false;
    setProgram(stringOrEmpty(data.configuration?.program));
  }, [data.configuration?.program]);

  useEffect(() => {
    cwdChangedByUserRef.current = false;
    setCwd(stringOrEmpty(data.configuration?.cwd));
  }, [data.configuration?.cwd]);

  const handleTypeChange = (value: string) => {
    typeChangedByUserRef.current = true;
    setType(value);
  };

  const handleProgramChange = (value: string) => {
    programChangedByUserRef.current = true;
    setProgram(value);
  };

  const handleCwdChange = (value: string) => {
    cwdChangedByUserRef.current = true;
    setCwd(value);
  };

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (readOnly || !typeChangedByUserRef.current) {
      return;
    }

    onChange(updateProfileType(data, value));
  });

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
  const typeHelperMessage =
    type.trim() === '' ? 'Profile type is required for Generate.' : undefined;
  const requestSelect = resolveProfileRequestSelectState(
    data.configuration?.request,
  );
  const nameHelperMessages = getFieldDiagnosticMessages(diagnostics, 'name');
  const typeHelperMessages = mergeHelperMessages(
    getFieldDiagnosticMessages(diagnostics, 'configuration.type'),
    [typeHelperMessage],
  );
  const requestHelperMessages = mergeHelperMessages(
    getFieldDiagnosticMessages(diagnostics, 'configuration.request'),
    [requestSelect.helperMessage],
  );
  const programHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'configuration.program',
  );
  const cwdHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'configuration.cwd',
  );
  const stopAtEntryHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'configuration.stopAtEntry',
  );
  const argsHelperMessages = getFieldDiagnosticMessages(diagnostics, 'args');
  const entryIssueDiagnostics = getEntryIssueDiagnostics(
    diagnostics,
    PROFILE_VISIBLE_DIAGNOSTIC_FIELDS,
  );

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

        <EntryIssuesRow
          diagnostics={entryIssueDiagnostics}
          sourceFile={sourceFile}
          onOpenJson={onOpenJson}
        />

        <FormGroup
          category="Launch Composer"
          label="Profile: Name"
          description="Profile identifier. Config profile references this value."
          helper={renderHelperMessages(nameHelperMessages)}
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
          label="Profile: Type"
          description="Debug adapter type used in generated launch.json."
          helper={renderHelperMessages(typeHelperMessages)}
        >
          <TextInput
            disabled={readOnly}
            value={type}
            onChange={handleTypeChange}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Request"
          description="Debug request passed to the adapter."
          helper={renderHelperMessages(requestHelperMessages)}
        >
          <Select
            disabled={readOnly}
            enum={requestSelect.options}
            enumItemLabels={requestSelect.optionLabels}
            value={requestSelect.value}
            onChange={(value) => {
              if (
                readOnly ||
                isInternalProfileRequestSelectValue(value) ||
                !isDebugRequestOption(value)
              ) {
                return;
              }

              onChange(updateProfileRequest(data, value));
            }}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Program"
          description="Program path or expression used by the debugger."
          helper={renderHelperMessages(programHelperMessages)}
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
          helper={renderHelperMessages(cwdHelperMessages)}
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
          helper={renderHelperMessages(stopAtEntryHelperMessages)}
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
          helper={renderHelperMessages(argsHelperMessages)}
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
          description="Edit the source file to add unsupported properties."
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
