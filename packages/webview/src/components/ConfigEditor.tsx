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
import { useState } from 'react';

import type { EntryChange } from './entryChanges.js';
import {
  clearConfigCwd,
  clearConfigStopAtEntry,
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
  onOpenProfile: (profileName: string) => void;
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
  onOpenProfile,
  readOnlyIssue,
}: ConfigEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const currentProfile = profiles.find(
    (profile) => profile.name === data.profile,
  );
  const argsFileDisabled = currentProfile?.args !== undefined;

  const hasCwdKey =
    data.configuration !== undefined &&
    Object.hasOwn(data.configuration, 'cwd');
  const stopAtEntryOverridden =
    data.configuration !== undefined &&
    Object.hasOwn(data.configuration, 'stopAtEntry');
  const inheritedCwd = stringOrEmpty(currentProfile?.configuration?.cwd);
  const inheritedStopAtEntry =
    currentProfile?.configuration?.stopAtEntry === true;
  const inheritedHelperMessage =
    currentProfile === undefined
      ? 'No profile to inherit from.'
      : `Inherited from profile "${currentProfile.name}".`;

  // Editing-started state for Working Directory: Override is on but the
  // key is not written until the user commits a non-blank value.
  const [cwdOverridePending, setCwdOverridePending] = useState(false);
  const cwdOverridden = hasCwdKey || cwdOverridePending;

  const cwdField = useEditableField(
    hasCwdKey
      ? stringOrEmpty(data.configuration?.cwd)
      : cwdOverridden
        ? inheritedCwd
        : '',
    autoSaveDelay,
    (value) => {
      if (value.trim() === '') {
        setCwdOverridePending(false);
      }

      onChange(updateConfigCwd(data, value));
    },
    { disabled: readOnly || !cwdOverridden },
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
          <div className="composer-input-action-row">
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
            <Button
              icon="go-to-file"
              type="button"
              variant="secondary"
              disabled={readOnly || currentProfile === undefined}
              onClick={() => {
                if (readOnly || currentProfile === undefined) {
                  return;
                }

                onOpenProfile(currentProfile.name);
              }}
            >
              Go to Profile
            </Button>
          </div>
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
          modified={cwdOverridden}
          helper={
            cwdHelperMessages.length > 0 ? (
              renderHelperMessages(cwdHelperMessages)
            ) : cwdOverridden ? undefined : (
              <FormHelper tone="info">{inheritedHelperMessage}</FormHelper>
            )
          }
        >
          <div className="composer-override-field">
            <Checkbox
              checked={cwdOverridden}
              disabled={readOnly}
              label="Override"
              onChange={(next) => {
                if (readOnly) {
                  return;
                }

                if (next) {
                  setCwdOverridePending(true);
                  return;
                }

                setCwdOverridePending(false);
                onChange(clearConfigCwd(data));
              }}
            />
            <TextInput
              disabled={readOnly || !cwdOverridden}
              {...(!cwdOverridden && inheritedCwd !== ''
                ? { placeholder: inheritedCwd }
                : {})}
              value={cwdField.value}
              onChange={cwdField.onChange}
            />
          </div>
        </FormGroup>

        <StopAtEntryField
          label="Config: Stop At Entry"
          checked={
            stopAtEntryOverridden
              ? data.configuration?.stopAtEntry === true
              : inheritedStopAtEntry
          }
          readOnly={readOnly}
          helper={
            stopAtEntryHelperMessages.length > 0 ? (
              renderHelperMessages(stopAtEntryHelperMessages)
            ) : stopAtEntryOverridden ? undefined : (
              <FormHelper tone="info">{inheritedHelperMessage}</FormHelper>
            )
          }
          override={{
            label: 'Override',
            overridden: stopAtEntryOverridden,
            onToggle: (next) => {
              onChange(
                next
                  ? updateConfigStopAtEntry(data, inheritedStopAtEntry)
                  : clearConfigStopAtEntry(data),
              );
            },
          }}
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
          description='Edit the source file to add unsupported properties. "type", "request", and "program" are managed by the referenced profile and cannot be set on a config.'
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
