import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { ConfigEditor } from './components/ConfigEditor.js';
import { TemplateEditor } from './components/TemplateEditor.js';
import type {
  ConfigData,
  EntryPatchOperation,
  HostMessage,
  InitialDataPayload,
  TemplateData,
} from './types.js';
import { RpcClient } from './utils/rpc.js';
import { vscode } from './utils/vscode.js';

const rpc = new RpcClient();

type EntryData = TemplateData | ConfigData;

export function App() {
  const [payload, setPayload] = useState<InitialDataPayload | null>(
    () => vscode.getState<InitialDataPayload>() ?? null,
  );
  const updateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef<string | null>(payload?.editorRevision ?? null);
  const editorKey =
    payload === null
      ? ''
      : `${payload.editor.kind}:${payload.editor.file}:${payload.editor.index}`;

  const requestLatestPayload = useCallback(async () => {
    const result = await rpc.sendRequest({ type: 'request-initial-data' });
    if (!isInitialDataPayload(result)) {
      return;
    }

    startTransition(() => {
      setPayload(result);
    });
  }, []);

  const renameEntry = useCallback(
    async (
      kind: 'template' | 'config',
      file: string,
      index: number,
      name: string,
    ) => {
      const result = await rpc.sendRequest({
        type: 'rename-entry',
        payload: {
          kind,
          file,
          index,
          name,
        },
      });

      if (!isRenameResult(result)) {
        await requestLatestPayload();
        return;
      }

      await requestLatestPayload();
    },
    [requestLatestPayload],
  );

  const enqueueUpdate = useCallback(
    (
      kind: 'template' | 'config',
      file: string,
      index: number,
      patches: EntryPatchOperation[],
    ) => {
      if (patches.length === 0) {
        return;
      }

      updateQueueRef.current = updateQueueRef.current
        .then(async () => {
          const baseRevision = revisionRef.current;
          const result = await rpc.sendRequest(
            kind === 'template'
              ? {
                  type: 'update-template',
                  payload: {
                    file,
                    index,
                    baseRevision,
                    patches,
                  },
                }
              : {
                  type: 'update-config',
                  payload: {
                    file,
                    index,
                    baseRevision,
                    patches,
                  },
                },
          );

          if (!isUpdateResult(result)) {
            return;
          }

          if (result.success !== true) {
            if (result.conflict === true) {
              await requestLatestPayload();
            }
            return;
          }

          revisionRef.current = result.revision ?? baseRevision;
          setPayload((currentPayload) => {
            if (currentPayload === null) {
              return currentPayload;
            }

            return {
              ...currentPayload,
              editorRevision: result.revision ?? currentPayload.editorRevision,
            };
          });
        })
        .catch(() => undefined);
    },
    [requestLatestPayload],
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
      });
    }

    window.addEventListener('message', onMessage as EventListener);
    void requestLatestPayload();

    return () => {
      window.removeEventListener('message', onMessage as EventListener);
    };
  }, [requestLatestPayload]);

  useEffect(() => {
    revisionRef.current = payload?.editorRevision ?? null;
  }, [payload?.editorRevision, editorKey]);

  useEffect(() => {
    updateQueueRef.current = Promise.resolve();
  }, [editorKey]);

  useEffect(() => {
    if (payload !== null) {
      vscode.setState(payload);
    }
  }, [payload]);

  if (payload === null) {
    return (
      <main className="settings-editor composer-shell">
        <section className="settings-body composer-body">
          <div className="empty-state">Loading editor…</div>
        </section>
      </main>
    );
  }

  const current =
    payload.editor.kind === 'template'
      ? payload.templates.find(
          (fileData) => fileData.file === payload.editor.file,
        )?.templates[payload.editor.index]
      : payload.configs.find(
          (fileData) => fileData.file === payload.editor.file,
        )?.configurations[payload.editor.index];
  const currentConfigFile =
    payload.editor.kind === 'config'
      ? payload.configs.find(
          (fileData) => fileData.file === payload.editor.file,
        )
      : undefined;
  const currentIssue = payload.issues.find(
    (issue) =>
      issue.kind === payload.editor.kind && issue.file === payload.editor.file,
  );
  if (current === undefined && currentIssue === undefined) {
    return (
      <main className="settings-editor composer-shell">
        <section className="settings-body composer-body">
          <div className="empty-state">
            The selected item no longer exists. Reopen it from the sidebar.
          </div>
        </section>
      </main>
    );
  }

  const templateCatalog = payload.templates.flatMap(
    (fileData) => fileData.templates,
  );
  const sourceFile = payload.editor.file;
  const editorEyebrow =
    payload.editor.kind === 'template' ? 'Template' : 'Config';
  const editorHeading = current === undefined ? sourceFile : current.name;
  const openFileJson = () => {
    rpc.post({
      type: 'open-file-json',
      payload: {
        kind: payload.editor.kind,
        file: payload.editor.file,
      },
    });
  };

  return (
    <main className="settings-editor composer-shell">
      <section className="settings-body composer-body">
        <header className="composer-editor-header">
          <div className="composer-editor-title">
            <p className="composer-editor-eyebrow">{editorEyebrow}</p>
            <h1 className="settings-group-title-label composer-editor-heading">
              {editorHeading}
            </h1>
            <p className="composer-editor-meta">{sourceFile}</p>
          </div>
        </header>
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
              const currentData =
                (current as TemplateData | undefined) ??
                createPlaceholderTemplate(payload.editor.file);
              const patches = createEntryPatches(currentData, nextData);
              updatePayload(payload, setPayload, payload.editor, nextData);
              enqueueUpdate(
                'template',
                payload.editor.file,
                payload.editor.index,
                patches,
              );
            }}
            onRename={async (name) => {
              await renameEntry(
                'template',
                payload.editor.file,
                payload.editor.index,
                name,
              );
            }}
            onOpenJson={openFileJson}
          />
        ) : (
          <ConfigEditor
            data={
              (current as ConfigData | undefined) ??
              createPlaceholderConfig(payload.editor.file)
            }
            sourceFile={payload.editor.file}
            fileEnabled={currentConfigFile?.enabled !== false}
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
              const currentData =
                (current as ConfigData | undefined) ??
                createPlaceholderConfig(payload.editor.file);
              const patches = createEntryPatches(currentData, nextData);
              updatePayload(payload, setPayload, payload.editor, nextData);
              enqueueUpdate(
                'config',
                payload.editor.file,
                payload.editor.index,
                patches,
              );
            }}
            onRename={async (name) => {
              await renameEntry(
                'config',
                payload.editor.file,
                payload.editor.index,
                name,
              );
            }}
            onOpenJson={openFileJson}
          />
        )}
      </section>
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
                  configurations: fileData.configurations.map(
                    (config, index) =>
                      index === editor.index
                        ? (nextData as ConfigData)
                        : config,
                  ),
                },
          ),
        };

  setPayload(nextPayload);
}

function isInitialDataPayload(value: unknown): value is InitialDataPayload {
  return typeof value === 'object' && value !== null && 'editor' in value;
}

function isFileSelected(value: unknown): value is { path: string | null } {
  return typeof value === 'object' && value !== null && 'path' in value;
}

function isUpdateResult(value: unknown): value is {
  success: boolean;
  conflict?: boolean;
  revision?: string | null;
  error?: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success: unknown }).success === 'boolean'
  );
}

function isRenameResult(value: unknown): value is {
  success: boolean;
  error?: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success: unknown }).success === 'boolean'
  );
}

function createEntryPatches(
  current: EntryData,
  next: EntryData,
): EntryPatchOperation[] {
  const currentRecord = current as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(currentRecord),
    ...Object.keys(nextRecord),
  ]);

  const patches: EntryPatchOperation[] = [];
  for (const key of [...keys].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const hasCurrent = Object.hasOwn(currentRecord, key);
    const hasNext = Object.hasOwn(nextRecord, key);

    if (hasCurrent && !hasNext) {
      patches.push({
        type: 'delete',
        key,
      });
      continue;
    }

    if (!hasNext) {
      continue;
    }

    const nextValue = nextRecord[key];
    if (!hasCurrent || !isEqualPatchValue(currentRecord[key], nextValue)) {
      patches.push({
        type: 'set',
        key,
        value: nextValue,
      });
    }
  }

  return patches;
}

function isEqualPatchValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((entry, index) => entry === right[index]);
  }

  return left === right;
}

function createPlaceholderTemplate(file: string): TemplateData {
  return {
    name: file,
    type: '',
    request: 'launch',
  };
}

function createPlaceholderConfig(file: string): ConfigData {
  return {
    name: file,
    enabled: true,
    configuration: {
      type: '',
      request: 'launch',
    },
  };
}
