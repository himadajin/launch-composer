import {
  Button,
  Checkbox,
  Divider,
  FormContainer,
  FormGroup,
  ListEditor,
  Select,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useState } from 'react';

import type { ConfigData, TemplateData } from '../types.js';
import {
  stringOrEmpty,
  updateOptionalArray,
  updateRequiredString,
  updateOptionalString,
  useDebouncedCommit,
} from './editorUtils.js';

interface ConfigEditorProps {
  data: ConfigData;
  templates: TemplateData[];
  autoSaveDelay: number;
  onBrowseFile: () => Promise<string | null>;
  onChange: (data: ConfigData) => void;
  onOpenJson: () => void;
}

export function ConfigEditor({
  data,
  templates,
  autoSaveDelay,
  onBrowseFile,
  onChange,
  onOpenJson,
}: ConfigEditorProps) {
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
    onChange(updateOptionalString(data, 'cwd', value));
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (launchFieldsInherited) {
      return;
    }

    onChange(updateRequiredString(data, 'type', value));
  });

  useDebouncedCommit(request, autoSaveDelay, (value) => {
    if (launchFieldsInherited) {
      return;
    }

    onChange(updateRequiredString(data, 'request', value));
  });

  useDebouncedCommit(argsFile, autoSaveDelay, (value) => {
    onChange(updateOptionalString(data, 'argsFile', value));
  });

  return (
    <div className="editor-root">
      <header className="editor-header">
        <div>
          <p className="editor-kind">Config</p>
          <h1>{data.name}</h1>
        </div>
        <Button
          icon="settings-gear"
          type="button"
          variant="secondary"
          onClick={onOpenJson}
        >
          Edit as JSON
        </Button>
      </header>

      <Divider />

      <FormContainer className="editor-form">
        <FormGroup
          label="Name"
          description="Configuration name. This value is fixed after creation."
        >
          <TextInput readOnly value={data.name} />
        </FormGroup>

        <FormGroup label="Extends">
          <Select
            enum={templateOptions}
            value={selectValue}
            onChange={(value) => {
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

        <div className="editor-checkbox-row">
          <Checkbox
            checked={data.enabled === true}
            label="Enabled"
            onChange={(checked) => {
              onChange({
                ...data,
                enabled: checked,
              });
            }}
          />
        </div>

        <FormGroup
          label="Type"
          helper={
            launchFieldsInherited
              ? 'Inherited from the selected template.'
              : undefined
          }
        >
          <TextInput
            disabled={launchFieldsInherited}
            value={effectiveType}
            onChange={setType}
          />
        </FormGroup>

        <FormGroup
          label="Request"
          helper={
            launchFieldsInherited
              ? 'Inherited from the selected template.'
              : undefined
          }
        >
          <TextInput
            disabled={launchFieldsInherited}
            value={effectiveRequest}
            onChange={setRequest}
          />
        </FormGroup>

        <FormGroup label="Working Directory">
          <TextInput value={cwd} onChange={setCwd} />
        </FormGroup>

        <div className="editor-checkbox-row">
          <Checkbox
            checked={data.stopAtEntry === true}
            label="Stop At Entry"
            onChange={(checked) => {
              onChange({
                ...data,
                stopAtEntry: checked,
              });
            }}
          />
        </div>

        <FormGroup
          label="Args File"
          helper={argsFileDisabled ? 'Template has args defined.' : undefined}
        >
          <div className="input-action-row">
            <TextInput
              disabled={argsFileDisabled}
              value={argsFile}
              onChange={setArgsFile}
            />
            <Button
              icon="folder-opened"
              type="button"
              variant="secondary"
              disabled={argsFileDisabled}
              onClick={async () => {
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

        <FormGroup label="Args">
          <ListEditor
            reorderable
            addPlaceholder="Add argument"
            value={data.args ?? []}
            onChange={(args) => {
              onChange(updateOptionalArray(data, 'args', args));
            }}
          />
        </FormGroup>
      </FormContainer>
    </div>
  );
}
