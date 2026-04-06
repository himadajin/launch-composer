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
import { useEffect, useState } from 'react';

import type { ComposerDataIssue, ConfigData, TemplateData } from '../types.js';
import {
  stringOrEmpty,
  updateOptionalArray,
  updateOptionalString,
  updateRequiredString,
  useDebouncedCommit,
} from './editorUtils.js';
import { EditInJsonHint } from './EditInJsonHint.js';

interface ConfigEditorProps {
  data: ConfigData;
  sourceFile: string;
  fileEnabled: boolean;
  templates: TemplateData[];
  autoSaveDelay: number;
  onBrowseFile: () => Promise<string | null>;
  onChange: (data: ConfigData) => void;
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
  onOpenJson,
  readOnlyIssue,
}: ConfigEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const [type, setType] = useState(stringOrEmpty(data.type));
  const [request, setRequest] = useState(stringOrEmpty(data.request));
  const [cwd, setCwd] = useState(stringOrEmpty(data.cwd));
  const [argsFile, setArgsFile] = useState(stringOrEmpty(data.argsFile));

  useEffect(() => {
    setType(stringOrEmpty(data.type));
  }, [data.type]);

  useEffect(() => {
    setRequest(stringOrEmpty(data.request));
  }, [data.request]);

  useEffect(() => {
    setCwd(stringOrEmpty(data.cwd));
  }, [data.cwd]);

  useEffect(() => {
    setArgsFile(stringOrEmpty(data.argsFile));
  }, [data.argsFile]);

  const currentTemplate = templates.find(
    (template) => template.name === data.extends,
  );
  const templateOptions = [
    '(none)',
    ...templates.map((template) => template.name),
  ];
  const selectValue =
    data.extends !== undefined && !templateOptions.includes(data.extends)
      ? data.extends
      : (data.extends ?? '(none)');
  const argsFileDisabled = currentTemplate?.args !== undefined;
  const launchFieldsInherited = data.extends !== undefined;
  const effectiveType = launchFieldsInherited
    ? stringOrEmpty(currentTemplate?.type)
    : type;
  const effectiveRequest = launchFieldsInherited
    ? stringOrEmpty(currentTemplate?.request)
    : request;

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateOptionalString(data, 'cwd', value));
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (readOnly || launchFieldsInherited) {
      return;
    }

    onChange(updateRequiredString(data, 'type', value));
  });

  useDebouncedCommit(request, autoSaveDelay, (value) => {
    if (readOnly || launchFieldsInherited) {
      return;
    }

    onChange(updateRequiredString(data, 'request', value));
  });

  useDebouncedCommit(argsFile, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateOptionalString(data, 'argsFile', value));
  });

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
          description="Configuration name. This value is fixed after creation."
        >
          <TextInput readOnly value={data.name} />
        </FormGroup>

        <FormGroup
          label="Config: Extends"
          description="Inherit launch fields from an existing template."
        >
          <Select
            disabled={readOnly}
            enum={templateOptions}
            value={selectValue}
            onChange={(value) => {
              if (readOnly) {
                return;
              }

              const next = { ...data };
              if (value === '(none)') {
                delete next.extends;
                next.type = stringOrEmpty(next.type);
                next.request = stringOrEmpty(next.request);
              } else {
                next.extends = value;
                delete next.type;
                delete next.request;
              }
              onChange(next);
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
            label={data.enabled === true ? 'Enabled' : 'Disabled'}
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
          <TextInput
            disabled={readOnly || launchFieldsInherited}
            value={effectiveRequest}
            onChange={setRequest}
          />
        </FormGroup>

        <FormGroup
          label="Config: Working Directory"
          description="Working directory passed to the debug adapter."
        >
          <TextInput disabled={readOnly} value={cwd} onChange={setCwd} />
        </FormGroup>

        <FormGroup
          label="Config: Stop At Entry"
          description="Pause execution immediately after the program starts."
          modified={data.stopAtEntry === true}
        >
          <Checkbox
            toggle
            checked={data.stopAtEntry === true}
            disabled={readOnly}
            label={data.stopAtEntry === true ? 'Enabled' : 'Disabled'}
            onChange={(checked) => {
              if (readOnly) {
                return;
              }

              onChange({
                ...data,
                stopAtEntry: checked,
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
                onChange(updateOptionalString(data, 'argsFile', selected));
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
                onChange(updateOptionalArray(data, 'args', args));
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
