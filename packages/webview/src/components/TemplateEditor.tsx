import {
  Button,
  Checkbox,
  FormContainer,
  FormGroup,
  FormHelper,
  ListEditor,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useState } from 'react';

import type { ComposerDataIssue, TemplateData } from '../types.js';
import {
  stringOrEmpty,
  updateOptionalArray,
  updateOptionalString,
  updateRequiredString,
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
    <div className="composer-editor">
      <header className="composer-editor-header">
        <div className="composer-editor-title">
          <p className="composer-editor-eyebrow">Template</p>
          <h1 className="settings-group-title-label composer-editor-heading">
            {data.name}
          </h1>
          <p className="composer-editor-meta">{sourceFile}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          icon="json"
          onClick={onOpenJson}
        >
          Open JSON
        </Button>
      </header>

      <FormContainer className="composer-form">
        {readOnlyIssue !== undefined ? (
          <FormGroup
            label="JSON Status"
            description={readOnlyIssue.message}
            helper={
              <FormHelper tone="warning">
                {readOnlyIssue.details ??
                  'Fix the JSON file to resume form editing.'}
              </FormHelper>
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
          label="Template: Name"
          description="Template identifier. This value is fixed after creation."
        >
          <TextInput readOnly value={data.name} />
        </FormGroup>

        <FormGroup
          label="Template: Type"
          description="Debugger type written to the generated launch.json entry."
        >
          <TextInput disabled={readOnly} value={type} onChange={setType} />
        </FormGroup>

        <FormGroup
          label="Template: Request"
          description="Debugger request written to the generated launch.json entry."
        >
          <TextInput
            disabled={readOnly}
            value={request}
            onChange={setRequest}
          />
        </FormGroup>

        <FormGroup
          label="Template: Program"
          description="Program path or expression used by the debugger."
        >
          <TextInput
            disabled={readOnly}
            value={program}
            onChange={setProgram}
          />
        </FormGroup>

        <FormGroup
          label="Template: Working Directory"
          description="Working directory passed to the debug adapter."
        >
          <TextInput disabled={readOnly} value={cwd} onChange={setCwd} />
        </FormGroup>

        <FormGroup
          label="Template: Stop At Entry"
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
          label="Template: Args"
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
      </FormContainer>
    </div>
  );
}
