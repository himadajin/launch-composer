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

import type { ComposerDataIssue, ConfigData, TemplateData } from '../types.js';
import {
  DEBUG_REQUEST_OPTIONS,
  normalizeDebugRequest,
  stringOrEmpty,
  updateOptionalString,
  updateRequiredString,
  useDebouncedCommit,
  withConfiguration,
} from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';

const NO_TEMPLATE_LABEL = 'No template';
const NO_TEMPLATE_VALUE = '';

interface ConfigEditorProps {
  data: ConfigData;
  sourceFile: string;
  fileEnabled: boolean;
  templates: TemplateData[];
  autoSaveDelay: number;
  onBrowseFile: () => Promise<string | null>;
  onChange: (data: ConfigData) => void;
  onRename: (name: string) => Promise<void>;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function ConfigEditor({
  data,
  sourceFile,
  fileEnabled,
  templates,
  autoSaveDelay,
  onBrowseFile,
  onChange,
  onRename,
  onOpenJson,
  readOnlyIssue,
}: ConfigEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const configEntry = data.configuration ?? {};
  const [name, setName] = useState(data.name);
  const [type, setType] = useState(stringOrEmpty(configEntry.type));
  const [request, setRequest] = useState(
    normalizeDebugRequest(configEntry.request),
  );
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
    setType(stringOrEmpty(data.configuration?.type));
  }, [data.configuration?.type]);

  useEffect(() => {
    setRequest(normalizeDebugRequest(data.configuration?.request));
  }, [data.configuration?.request]);

  useEffect(() => {
    cwdChangedByUserRef.current = false;
    setCwd(stringOrEmpty(data.configuration?.cwd));
  }, [data.configuration?.cwd]);

  useEffect(() => {
    setArgsFile(stringOrEmpty(data.argsFile));
  }, [data.argsFile]);

  const currentTemplate = templates.find(
    (template) => template.name === data.extends,
  );
  const templateNames = templates.map((template) => template.name);
  const extendsValue = data.extends;
  const hasMissingTemplate =
    extendsValue !== undefined && !templateNames.includes(extendsValue);
  const templateOptions = hasMissingTemplate
    ? [...templateNames, extendsValue, NO_TEMPLATE_VALUE]
    : [...templateNames, NO_TEMPLATE_VALUE];
  const templateOptionLabels = hasMissingTemplate
    ? [...templateNames, extendsValue, NO_TEMPLATE_LABEL]
    : [...templateNames, NO_TEMPLATE_LABEL];
  const selectValue = extendsValue ?? NO_TEMPLATE_VALUE;
  const argsFileDisabled = currentTemplate?.args !== undefined;
  const launchFieldsInherited = extendsValue !== undefined;
  const effectiveType = launchFieldsInherited
    ? stringOrEmpty(currentTemplate?.configuration?.type)
    : type;
  const effectiveRequest = launchFieldsInherited
    ? normalizeDebugRequest(currentTemplate?.configuration?.request)
    : request;

  const handleCwdChange = (value: string) => {
    cwdChangedByUserRef.current = true;
    setCwd(value);
  };

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly || !cwdChangedByUserRef.current) {
      return;
    }

    onChange(
      withConfiguration(
        data,
        updateOptionalString({ ...data.configuration }, 'cwd', value),
      ),
    );
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (readOnly || launchFieldsInherited) {
      return;
    }

    onChange({
      ...data,
      configuration: updateRequiredString(
        { ...data.configuration },
        'type',
        value,
      ),
    });
  });

  useDebouncedCommit(argsFile, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    const trimmed = value.trim();
    if (trimmed === '') {
      const next = { ...data };
      delete next.argsFile;
      onChange(next);
    } else {
      onChange({ ...data, argsFile: trimmed });
    }
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
          label="Config: Name"
          description="Configuration name written to the generated launch.json entry."
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
          label="Config: Extends"
          description="Inherit launch fields from an existing template."
        >
          <Select
            disabled={readOnly}
            enum={templateOptions}
            enumItemLabels={templateOptionLabels}
            value={selectValue}
            onChange={(value) => {
              if (readOnly) {
                return;
              }

              if (value === NO_TEMPLATE_VALUE) {
                const nextConfig = { ...data.configuration };
                nextConfig.type = stringOrEmpty(nextConfig.type);
                nextConfig.request = 'launch';
                const next = { ...data, configuration: nextConfig };
                delete next.extends;
                onChange(next);
              } else {
                const nextConfig = { ...data.configuration };
                delete nextConfig.type;
                delete nextConfig.request;
                onChange({
                  ...data,
                  extends: value,
                  configuration: nextConfig,
                });
              }
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Enabled"
          description="Include this config when generating launch.json."
          modified={data.enabled === true}
          helper={
            !fileEnabled ? (
              <FormHelper tone="info">
                This config is currently disabled by the file-level setting.
              </FormHelper>
            ) : undefined
          }
        >
          <Checkbox
            toggle
            checked={data.enabled === true}
            disabled={readOnly}
            label="Enabled"
            onChange={(checked) => {
              if (readOnly) {
                return;
              }

              onChange({
                ...data,
                enabled: checked,
              });
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Type"
          description="Debugger type written to the generated launch.json entry."
          helper={
            launchFieldsInherited ? (
              <FormHelper tone="info">
                Inherited from the selected template.
              </FormHelper>
            ) : undefined
          }
        >
          <TextInput
            disabled={readOnly || launchFieldsInherited}
            value={effectiveType}
            onChange={setType}
          />
        </FormGroup>

        <FormGroup
          label="Config: Request"
          description="Debugger request written to the generated launch.json entry."
          helper={
            launchFieldsInherited ? (
              <FormHelper tone="info">
                Inherited from the selected template.
              </FormHelper>
            ) : undefined
          }
        >
          <Select
            disabled={readOnly || launchFieldsInherited}
            enum={[...DEBUG_REQUEST_OPTIONS]}
            value={effectiveRequest}
            onChange={(value) => {
              if (readOnly || launchFieldsInherited) {
                return;
              }

              setRequest(value as (typeof DEBUG_REQUEST_OPTIONS)[number]);
              onChange({
                ...data,
                configuration: updateRequiredString(
                  { ...data.configuration },
                  'request',
                  value,
                ),
              });
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Working Directory"
          description="Working directory passed to the debug adapter."
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

              onChange({
                ...data,
                configuration: { ...data.configuration, stopAtEntry: checked },
              });
            }}
          />
        </FormGroup>

        <FormGroup
          label="Config: Args File"
          description="Path to an argument file loaded before launch."
          helper={
            argsFileDisabled ? (
              <FormHelper tone="info">
                The selected template already defines args.
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
                onChange({ ...data, argsFile: selected });
              }}
            >
              Browse
            </Button>
          </div>
        </FormGroup>

        <FormGroup
          label="Config: Args"
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
                const next = { ...data };
                if (args.length === 0) {
                  delete next.args;
                } else {
                  next.args = args;
                }
                onChange(next);
              }}
            />
          )}
        </FormGroup>

        <EditInJsonHint
          fileLabel={sourceFile}
          description="Only common launch.json properties are available here. Edit the source file to add or adjust unsupported fields."
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
