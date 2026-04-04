import {
  startTransition,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { ConfigEditor } from './components/ConfigEditor.js';
import { TemplateEditor } from './components/TemplateEditor.js';
import type {
  ConfigData,
  HostMessage,
  InitialDataPayload,
  TemplateData,
} from './types.js';
import { RpcClient } from './utils/rpc.js';
import { vscode } from './utils/vscode.js';

const rpc = new RpcClient();

export function App() {
  const [payload, setPayload] = useState<InitialDataPayload | null>(
    () => vscode.getState<InitialDataPayload>() ?? null,
  );

  useEffect(() => {
    function onMessage(event: MessageEvent<HostMessage>) {
      if (rpc.handle(event.data)) {
        return;
      }

      const message = event.data;
      if (message.type !== 'initial-data') {
        return;
      }

      startTransition(() => {
        setPayload(message.payload);
        vscode.setState(message.payload);
      });
    }

    window.addEventListener('message', onMessage as EventListener);
    void rpc.sendRequest({ type: 'request-initial-data' }).then((result) => {
      if (isInitialDataPayload(result)) {
        startTransition(() => {
          setPayload(result);
          vscode.setState(result);
        });
      }
    });

    return () => {
      window.removeEventListener('message', onMessage as EventListener);
    };
  }, []);

  if (payload === null) {
    return <main className="empty-state">Loading editor…</main>;
  }

  const current =
    payload.editor.kind === 'template'
      ? payload.templates.find(
          (fileData) => fileData.file === payload.editor.file,
        )?.templates[payload.editor.index]
      : payload.configs.find(
          (fileData) => fileData.file === payload.editor.file,
        )?.configs[payload.editor.index];
  const currentIssue = payload.issues.find(
    (issue) =>
      issue.kind === payload.editor.kind && issue.file === payload.editor.file,
  );
  if (current === undefined && currentIssue === undefined) {
    return (
      <main className="empty-state">
        The selected item no longer exists. Reopen it from the sidebar.
      </main>
    );
  }

  const templateCatalog = payload.templates.flatMap(
    (fileData) => fileData.templates,
  );

  return (
    <main className="app-shell">
      {payload.editor.kind === 'template' ? (
        <TemplateEditor
          data={
            (current as TemplateData | undefined) ??
            createPlaceholderTemplate(payload.editor.file)
          }
          sourceFile={payload.editor.file}
          autoSaveDelay={payload.autoSaveDelay}
          {...(currentIssue === undefined
            ? {}
            : {
                readOnlyIssue: currentIssue,
              })}
          onChange={(nextData) => {
            updatePayload(payload, setPayload, payload.editor, nextData);
            rpc.post({
              type: 'update-template',
              payload: {
                file: payload.editor.file,
                index: payload.editor.index,
                data: nextData,
              },
            });
          }}
          onOpenJson={() => {
            rpc.post(
              currentIssue === undefined
                ? {
                    type: 'open-json',
                    payload: payload.editor,
                  }
                : {
                    type: 'open-file-json',
                    payload: {
                      kind: payload.editor.kind,
                      file: payload.editor.file,
                    },
                  },
            );
          }}
        />
      ) : (
        <ConfigEditor
          data={
            (current as ConfigData | undefined) ??
            createPlaceholderConfig(payload.editor.file)
          }
          sourceFile={payload.editor.file}
          templates={templateCatalog}
          autoSaveDelay={payload.autoSaveDelay}
          {...(currentIssue === undefined
            ? {}
            : {
                readOnlyIssue: currentIssue,
              })}
          onBrowseFile={async () => {
            const result = await rpc.sendRequest({ type: 'browse-file' });
            return isFileSelected(result) ? result.path : null;
          }}
          onChange={(nextData) => {
            updatePayload(payload, setPayload, payload.editor, nextData);
            rpc.post({
              type: 'update-config',
              payload: {
                file: payload.editor.file,
                index: payload.editor.index,
                data: nextData,
              },
            });
          }}
          onOpenJson={() => {
            rpc.post(
              currentIssue === undefined
                ? {
                    type: 'open-json',
                    payload: payload.editor,
                  }
                : {
                    type: 'open-file-json',
                    payload: {
                      kind: payload.editor.kind,
                      file: payload.editor.file,
                    },
                  },
            );
          }}
        />
      )}
    </main>
  );
}

function updatePayload(
  payload: InitialDataPayload,
  setPayload: Dispatch<SetStateAction<InitialDataPayload | null>>,
  editor: InitialDataPayload['editor'],
  nextData: TemplateData | ConfigData,
) {
  const nextPayload: InitialDataPayload =
    editor.kind === 'template'
      ? {
          ...payload,
          templates: payload.templates.map((fileData) =>
            fileData.file !== editor.file
              ? fileData
              : {
                  ...fileData,
                  templates: fileData.templates.map((template, index) =>
                    index === editor.index
                      ? (nextData as TemplateData)
                      : template,
                  ),
                },
          ),
        }
      : {
          ...payload,
          configs: payload.configs.map((fileData) =>
            fileData.file !== editor.file
              ? fileData
              : {
                  ...fileData,
                  configs: fileData.configs.map((config, index) =>
                    index === editor.index ? (nextData as ConfigData) : config,
                  ),
                },
          ),
        };

  setPayload(nextPayload);
  vscode.setState(nextPayload);
}

function isInitialDataPayload(value: unknown): value is InitialDataPayload {
  return typeof value === 'object' && value !== null && 'editor' in value;
}

function isFileSelected(value: unknown): value is { path: string | null } {
  return typeof value === 'object' && value !== null && 'path' in value;
}

function createPlaceholderTemplate(file: string): TemplateData {
  return {
    name: file,
    type: '',
    request: '',
  };
}

function createPlaceholderConfig(file: string): ConfigData {
  return {
    name: file,
    enabled: true,
    type: '',
    request: '',
  };
}
