import {
  Button,
  Checkbox,
  FormContainer,
  FormGroup,
  FormHelper,
  Select,
  TextInput,
} from '@himadajin/vscode-components';

import type {
  ComposerDataIssue,
  ConfigData,
  GenerateDiagnostic,
  ProfileData,
} from '../types.js';
import { ArgsField } from './ArgsField.js';
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
import { stringOrEmpty } from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';
import {
  getEntryIssueDiagnostics,
  getFieldDiagnosticMessages,
  mergeHelperMessages,
} from './generateReadiness.js';
import { useEditableField } from './hooks.js';
import { JsonStatusRow } from './JsonStatusRow.js';
import { NameField } from './NameField.js';
import {
  isInternalProfileSelectValue,
  resolveConfigProfileSelectState,
} from './profileSelect.js';
import { StopAtEntryField } from './StopAtEntryField.js';

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
  readOnlyIssue?: ComposerDataIssue | undefined;
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
  const currentProfile = profiles.find(
    (profile) => profile.name === data.profile,
  );
  const argsFileDisabled = currentProfile?.args !== undefined;

  const cwdField = useEditableField(
    stringOrEmpty(data.configuration?.cwd),
    autoSaveDelay,
    (value) => onChange(updateConfigCwd(data, value)),
    { disabled: readOnly },
  );
  const argsFileField = useEditableField(
    stringOrEmpty(data.argsFile),
    autoSaveDelay,
    (value) => onChange(updateConfigArgsFile(data, value)),
    { disabled: readOnly || argsFileDisabled },
  );

  const profileSelect = resolveConfigProfileSelectState(profiles, data.profile);
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

  return (
    <div className="composer-editor">
      <FormContainer className="composer-form">
        <JsonStatusRow
          issue={readOnlyIssue}
          sourceFile={sourceFile}
          onOpenJson={onOpenJson}
        />

        <EntryIssuesRow
          diagnostics={entryIssueDiagnostics}
          sourceFile={sourceFile}
          onOpenJson={onOpenJson}
        />

        <NameField
          label="Config: Name"
          description="Configuration name written to the generated launch.json entry."
          externalName={data.name}
          readOnly={readOnly}
          helper={renderHelperMessages(nameHelperMessages)}
          onRename={onRename}
        />

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
            value={cwdField.value}
            onChange={cwdField.onChange}
          />
        </FormGroup>

        <StopAtEntryField
          label="Config: Stop At Entry"
          checked={data.configuration?.stopAtEntry === true}
          readOnly={readOnly}
          helper={renderHelperMessages(stopAtEntryHelperMessages)}
          onChange={(checked) => {
            onChange(updateConfigStopAtEntry(data, checked));
          }}
        />

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
              value={argsFileField.value}
              onChange={argsFileField.onChange}
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

                argsFileField.onChange(selected);
                onChange(updateConfigArgsFile(data, selected));
              }}
            >
              Browse
            </Button>
          </div>
        </FormGroup>

        <ArgsField
          label="Config: Args"
          args={data.args}
          readOnly={readOnly}
          helper={renderHelperMessages(argsHelperMessages)}
          onChange={(args) => {
            onChange(updateConfigArgs(data, args));
          }}
        />

        <EditInJsonHint
          fileLabel={sourceFile}
          description='Edit the source file to change JSON-only fields such as "type", "request", and "program", or to add unsupported properties.'
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
