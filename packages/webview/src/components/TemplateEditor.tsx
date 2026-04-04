import {
  Button,
  Checkbox,
  Divider,
  FormContainer,
  FormGroup,
  Icon,
  ListEditor,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useState } from 'react';

import type { ComposerDataIssue, TemplateData } from '../types.js';
import {
  stringOrEmpty,
  updateOptionalArray,
  updateRequiredString,
  updateOptionalString,
  useDebouncedCommit,
} from './editorUtils.js';

interface TemplateEditorProps {
  data: TemplateData;
  sourceFile: string;
  autoSaveDelay: number;
  onChange: (data: TemplateData) => void;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function TemplateEditor({
  data,
  sourceFile,
  autoSaveDelay,
  onChange,
  onOpenJson,
  readOnlyIssue,
}: TemplateEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
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
    if (readOnly) {
      return;
    }

    onChange(updateOptionalString(data, 'program', value));
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateRequiredString(data, 'type', value));
  });

  useDebouncedCommit(request, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateRequiredString(data, 'request', value));
  });

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange(updateOptionalString(data, 'cwd', value));
  });

  return (
    <div className="editor-root">
      <header className="editor-header">
        <div>
          <p className="editor-kind">Template</p>
          <h1>{data.name}</h1>
        </div>
        <Button type="button" variant="secondary" onClick={onOpenJson}>
          <span className="button-inline-content">
            <Icon name="settings-gear" size={16} />
            <span>Edit as JSON</span>
          </span>
        </Button>
      </header>

      <Divider />

      <FormContainer className="editor-form">
        {readOnlyIssue !== undefined ? (
          <FormGroup
            label="JSON Status"
            description={readOnlyIssue.message}
            helper={
              readOnlyIssue.details ??
              'Fix the JSON file to resume form editing.'
            }
          >
            <TextInput readOnly value={sourceFile} />
          </FormGroup>
        ) : null}

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
          <TextInput disabled={readOnly} value={type} onChange={setType} />
        </FormGroup>

        <FormGroup
          label="Request"
          description="Required in generated launch.json."
        >
          <TextInput
            disabled={readOnly}
            value={request}
            onChange={setRequest}
          />
        </FormGroup>

        <FormGroup label="Program">
          <TextInput
            disabled={readOnly}
            value={program}
            onChange={setProgram}
          />
        </FormGroup>

        <FormGroup label="Working Directory">
          <TextInput disabled={readOnly} value={cwd} onChange={setCwd} />
        </FormGroup>

        <div className="editor-checkbox-row">
          <Checkbox
            checked={data.stopAtEntry === true}
            disabled={readOnly}
            label="Stop At Entry"
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
        </div>

        <FormGroup label="Args">
          {readOnly ? (
            <TextInput readOnly value={(data.args ?? []).join(', ')} />
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
      </FormContainer>
    </div>
  );
}
