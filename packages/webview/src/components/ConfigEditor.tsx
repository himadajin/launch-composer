import {
  Button,
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
  ConfigData,
  GenerateDiagnostic,
  ProfileData,
} from '../types.js';
import { EntryIssuesRow, renderHelperMessages } from './DiagnosticMessages.js';
import type { EntryChange } from './entryChanges.js';
import {
  updateConfigArgs,
  updateConfigArgsFile,
  updateConfigCwd,
  updateConfigEnabled,
  updateConfigProfile,
  updateConfigStopAtEntry,
} from './entryChanges.js';
import { stringOrEmpty, useDebouncedCommit } from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';
import {
  getEntryIssueDiagnostics,
  getFieldDiagnosticMessages,
  mergeHelperMessages,
} from './generateReadiness.js';
import {
  isInternalProfileSelectValue,
  resolveConfigProfileSelectState,
} from './profileSelect.js';

const CONFIG_VISIBLE_DIAGNOSTIC_FIELDS = [
  'name',
  'profile',
  'excluded',
  'argsFile',
  'args',
  'configuration.cwd',
  'configuration.stopAtEntry',
] as const;

interface ConfigEditorProps {
  data: ConfigData;
  sourceFile: string;
  profiles: ProfileData[];
  autoSaveDelay: number;
  diagnostics?: GenerateDiagnostic[];
  onBrowseFile: () => Promise<string | null>;
  onChange: (change: EntryChange<ConfigData>) => void;
  onRename: (name: string) => Promise<void>;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function ConfigEditor({
  data,
  sourceFile,
  profiles,
  autoSaveDelay,
  diagnostics = [],
  onBrowseFile,
  onChange,
  onRename,
  onOpenJson,
  readOnlyIssue,
}: ConfigEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const configEntry = data.configuration ?? {};
  const [name, setName] = useState(data.name);
  const [cwd, setCwd] = useState(stringOrEmpty(configEntry.cwd));
  const [argsFile, setArgsFile] = useState(stringOrEmpty(data.argsFile));
  // Tracks whether cwd was changed by the user (vs. synced from data prop).
  // Reset to false on external data sync; set to true on user input.
  // This mirrors VS Code's "clear handler → set value → re-register handler"
  // pattern, so that opening the editor never causes spurious file writes.
  const cwdChangedByUserRef = useRef(false);

  useEffect(() => {
    setName(data.name);
  }, [data.name]);

  useEffect(() => {
    cwdChangedByUserRef.current = false;
    setCwd(stringOrEmpty(data.configuration?.cwd));
  }, [data.configuration?.cwd]);

  useEffect(() => {
    setArgsFile(stringOrEmpty(data.argsFile));
  }, [data.argsFile]);

  const currentProfile = profiles.find(
    (profile) => profile.name === data.profile,
  );
  const profileSelect = resolveConfigProfileSelectState(profiles, data.profile);
  const argsFileDisabled = currentProfile?.args !== undefined;
  const nameHelperMessages = getFieldDiagnosticMessages(diagnostics, 'name');
  const profileHelperMessages = mergeHelperMessages(
    getFieldDiagnosticMessages(diagnostics, 'profile'),
    [profileSelect.helperMessage],
  );
  const excludedHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'excluded',
  );
  const cwdHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'configuration.cwd',
  );
  const stopAtEntryHelperMessages = getFieldDiagnosticMessages(
    diagnostics,
    'configuration.stopAtEntry',
  );
  const argsFileDiagnosticMessages = getFieldDiagnosticMessages(
    diagnostics,
    'argsFile',
  );
  const argsHelperMessages = getFieldDiagnosticMessages(diagnostics, 'args');
  const entryIssueDiagnostics = getEntryIssueDiagnostics(
    diagnostics,
    CONFIG_VISIBLE_DIAGNOSTIC_FIELDS,
  );

  const handleCwdChange = (value: string) => {
    cwdChangedByUserRef.current = true;
    setCwd(value);
  };

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly || !cwdChangedByUserRef.current) {
      return;
    }

    onChange(updateConfigCwd(data, value));
  });

  useDebouncedCommit(argsFile, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateConfigArgsFile(data, value));
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

        <EntryIssuesRow
          diagnostics={entryIssueDiagnostics}
          sourceFile={sourceFile}
          onOpenJson={onOpenJson}
        />

        <FormGroup
          category="Launch Composer"
          label="Config: Name"
          description="Configuration name written to the generated launch.json entry."
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
          label="Config: Profile"
          description="Profile used as the base for this config."
          helper={renderHelperMessages(profileHelperMessages)}
        >
          <Select
            disabled={readOnly || profileSelect.disabled}
            enum={profileSelect.options}
            enumItemLabels={profileSelect.optionLabels}
            value={profileSelect.value}
            onChange={(value) => {
              if (readOnly || isInternalProfileSelectValue(value)) {
                return;
              }

              onChange(updateConfigProfile(data, value));
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Include"
          description="Include this config when generating launch.json."
          modified={data.excluded === true}
          helper={renderHelperMessages(excludedHelperMessages)}
        >
          <Checkbox
            toggle
            checked={data.excluded !== true}
            disabled={readOnly}
            label="Include"
            onChange={(checked) => {
              if (readOnly) {
                return;
              }

              onChange(updateConfigEnabled(data, checked));
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Working Directory"
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
          label="Config: Stop At Entry"
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

              onChange(updateConfigStopAtEntry(data, checked));
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Args File"
          description="Path to an argument file loaded before launch."
          helper={
            argsFileDiagnosticMessages.length > 0 ? (
              renderHelperMessages(argsFileDiagnosticMessages)
            ) : argsFileDisabled ? (
              <FormHelper tone="info">
                The selected profile already defines args.
              </FormHelper>
            ) : undefined
          }
          fill
        >
          <div className="composer-input-action-row">
            <TextInput
              disabled={readOnly || argsFileDisabled}
              value={argsFile}
              onChange={setArgsFile}
              style={{ width: '100%', maxWidth: 'none' }}
            />
            <Button
              icon="folder-opened"
              type="button"
              variant="secondary"
              disabled={readOnly || argsFileDisabled}
              onClick={async () => {
                if (readOnly) {
                  return;
                }

                const selected = await onBrowseFile();
                if (selected === null) {
                  return;
                }

                setArgsFile(selected);
                onChange(updateConfigArgsFile(data, selected));
              }}
            >
              Browse
            </Button>
          </div>
        </FormGroup>

        <FormGroup
          label="Config: Args"
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
                onChange(updateConfigArgs(data, args));
              }}
            />
          )}
        </FormGroup>

        <EditInJsonHint
          fileLabel={sourceFile}
          description='Edit the source file to change JSON-only fields such as "type", "request", and "program", or to add unsupported properties.'
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
