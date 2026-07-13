import {
  FormContainer,
  FormGroup,
  Select,
  TextInput,
} from '@himadajin/vscode-components';

import type {
  ComposerDataIssue,
  GenerateDiagnostic,
  ProfileData,
} from '../types.js';
import { ArgsField } from './ArgsField.js';
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
import { stringOrEmpty } from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';
import { useEditableField } from './hooks.js';
import { JsonStatusRow } from './JsonStatusRow.js';
import { NameField } from './NameField.js';
import { StopAtEntryField } from './StopAtEntryField.js';

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
  readOnlyIssue?: ComposerDataIssue | undefined;
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

  const typeField = useEditableField(
    stringOrEmpty(data.configuration?.type),
    autoSaveDelay,
    (value) => onChange(updateProfileType(data, value)),
    { readOnly },
  );
  const programField = useEditableField(
    stringOrEmpty(data.configuration?.program),
    autoSaveDelay,
    (value) => onChange(updateProfileProgram(data, value)),
    { readOnly },
  );
  const cwdField = useEditableField(
    stringOrEmpty(data.configuration?.cwd),
    autoSaveDelay,
    (value) => onChange(updateProfileCwd(data, value)),
    { readOnly },
  );

  const typeHelperMessage =
    typeField.value.trim() === ''
      ? 'Profile type is required for Generate.'
      : undefined;
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
          label="Profile: Name"
          description="Profile identifier. Config profile references this value."
          externalName={data.name}
          readOnly={readOnly}
          helper={renderHelperMessages(nameHelperMessages)}
          onRename={onRename}
        />

        <FormGroup
          label="Profile: Type"
          description="Debug adapter type used in generated launch.json."
          helper={renderHelperMessages(typeHelperMessages)}
        >
          <TextInput
            disabled={readOnly}
            value={typeField.value}
            onChange={typeField.onChange}
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
            value={programField.value}
            onChange={programField.onChange}
          />
        </FormGroup>

        <FormGroup
          label="Profile: Working Directory"
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
          label="Profile: Stop At Entry"
          checked={data.configuration?.stopAtEntry === true}
          readOnly={readOnly}
          helper={renderHelperMessages(stopAtEntryHelperMessages)}
          onChange={(checked) => {
            onChange(updateProfileStopAtEntry(data, checked));
          }}
        />

        <ArgsField
          label="Profile: Args"
          args={data.args}
          readOnly={readOnly}
          helper={renderHelperMessages(argsHelperMessages)}
          onChange={(args) => {
            onChange(updateProfileArgs(data, args));
          }}
        />

        <EditInJsonHint
          fileLabel={sourceFile}
          description="Edit the source file to add unsupported properties."
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
