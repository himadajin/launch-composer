import {
  Checkbox,
  FormContainer,
  FormGroup,
  FormHelper,
  ListEditor,
  Select,
  TextInput,
} from '@himadajin/vscode-components';
import { useEffect, useState } from 'react';

import type { ComposerDataIssue, TemplateData } from '../types.js';
import {
  DEBUG_REQUEST_OPTIONS,
  normalizeDebugRequest,
  stringOrEmpty,
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
  const [type, setType] = useState(stringOrEmpty(data.configuration?.type));
  const [request, setRequest] = useState(
    normalizeDebugRequest(data.configuration?.request),
  );
  const [program, setProgram] = useState(
    stringOrEmpty(data.configuration?.program),
  );
  const [cwd, setCwd] = useState(stringOrEmpty(data.configuration?.cwd));

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
    setProgram(stringOrEmpty(data.configuration?.program));
  }, [data.configuration?.program]);

  useEffect(() => {
    setCwd(stringOrEmpty(data.configuration?.cwd));
  }, [data.configuration?.cwd]);

  useDebouncedCommit(program, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange({
      ...data,
      configuration: updateOptionalString(
        { ...data.configuration },
        'program',
        value,
      ),
    });
  });

  useDebouncedCommit(type, autoSaveDelay, (value) => {
    if (readOnly) {
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

  useDebouncedCommit(cwd, autoSaveDelay, (value) => {
    if (readOnly) {
      return;
    }

    onChange({
      ...data,
      configuration: updateOptionalString(
        { ...data.configuration },
        'cwd',
        value,
      ),
    });
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
          <Select
            disabled={readOnly}
            enum={[...DEBUG_REQUEST_OPTIONS]}
            value={request}
            onChange={(value) => {
              if (readOnly) {
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
          description="Some launch.json properties are only available in JSON. Edit the source file to add or adjust unsupported fields."
          onOpenFileJson={onOpenJson}
        />
      </FormContainer>
    </div>
  );
}
