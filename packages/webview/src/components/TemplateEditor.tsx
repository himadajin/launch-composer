import {
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
import { EditInJsonHint } from './EditInJsonHint.js';

interface TemplateEditorProps {
  data: TemplateData;
  sourceFile: string;
  autoSaveDelay: number;
  onChange: (data: TemplateData) => void;
  onRename: (name: string) => Promise<void>;
  onOpenJson: () => void;
  readOnlyIssue?: ComposerDataIssue;
}

export function TemplateEditor({
  data,
  sourceFile,
  autoSaveDelay,
  onChange,
  onRename,
  onOpenJson,
  readOnlyIssue,
}: TemplateEditorProps) {
  const readOnly = readOnlyIssue !== undefined;
  const [name, setName] = useState(data.name);
  const [type, setType] = useState(stringOrEmpty(data.type));
  const [request, setRequest] = useState(stringOrEmpty(data.request));
  const [program, setProgram] = useState(stringOrEmpty(data.program));
  const [cwd, setCwd] = useState(stringOrEmpty(data.cwd));

  useEffect(() => {
    setName(data.name);
  }, [data.name]);

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
          label="Template: Name"
          description="Template identifier. Config extends references this value."
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

        <EditInJsonHint
          fileLabel={sourceFile}
          description="Some launch.json properties are only available in JSON. Edit the source file to add or adjust unsupported fields."
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
