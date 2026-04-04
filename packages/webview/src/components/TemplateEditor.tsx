import {
  Button,
  Divider,
  FormContainer,
  FormGroup,
  ListEditor,
  TextInput,
  Checkbox,
} from '@himadajin/vscode-components';
import { useEffect, useState } from 'react';

import type { TemplateData } from '../types.js';
import {
  stringOrEmpty,
  updateOptionalArray,
  updateRequiredString,
  updateOptionalString,
  useDebouncedCommit,
} from './editorUtils.js';

interface TemplateEditorProps {
  data: TemplateData;
  autoSaveDelay: number;
  onChange: (data: TemplateData) => void;
  onOpenJson: () => void;
}

export function TemplateEditor({
  data,
  autoSaveDelay,
  onChange,
  onOpenJson,
}: TemplateEditorProps) {
  const [type, setType] = useState(stringOrEmpty(data.type));
  const [request, setRequest] = useState(stringOrEmpty(data.request));
  const [program, setProgram] = useState(stringOrEmpty(data.program));
  const [cwd, setCwd] = useState(stringOrEmpty(data.cwd));

  useEffect(() => {
    setType(stringOrEmpty(data.type));
  }, [data.type]);

  useEffect(() => {
    setRequest(stringOrEmpty(data.request));
  }, [data.request]);

  useEffect(() => {
    setProgram(stringOrEmpty(data.program));
  }, [data.program]);

  useEffect(() => {
    setCwd(stringOrEmpty(data.cwd));
  }, [data.cwd]);

  useDebouncedCommit(program, autoSaveDelay, (value) => {
    onChange(updateOptionalString(data, 'program', value));
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    onChange(updateRequiredString(data, 'type', value));
  });

  useDebouncedCommit(request, autoSaveDelay, (value) => {
    onChange(updateRequiredString(data, 'request', value));
  });

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    onChange(updateOptionalString(data, 'cwd', value));
  });

  return (
    <div className="editor-root">
      <header className="editor-header">
        <div>
          <p className="editor-kind">Template</p>
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
          description="Template identifier. This value is fixed after creation."
        >
          <TextInput readOnly value={data.name} />
        </FormGroup>

        <FormGroup
          label="Type"
          description="Required in generated launch.json."
        >
          <TextInput value={type} onChange={setType} />
        </FormGroup>

        <FormGroup
          label="Request"
          description="Required in generated launch.json."
        >
          <TextInput value={request} onChange={setRequest} />
        </FormGroup>

        <FormGroup label="Program">
          <TextInput value={program} onChange={setProgram} />
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
