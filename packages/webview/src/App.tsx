import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { ConfigEditor } from './components/ConfigEditor.js';
import type { EntryChange } from './components/entryChanges.js';
import { ProfileEditor } from './components/ProfileEditor.js';
import type {
  ConfigData,
  EntryPatchOperation,
  HostMessage,
  InitialDataPayload,
  ProfileData,
  WorkspaceUpdatePayload,
} from './types.js';
import { RpcClient } from './utils/rpc.js';
import { vscode } from './utils/vscode.js';

const rpc = new RpcClient();

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
      kind: 'profile' | 'config',
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
      kind: 'profile' | 'config',
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
            kind === 'profile'
              ? {
                  type: 'update-profile',
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
      if (message.type === 'initial-data') {
        startTransition(() => {
          setPayload(message.payload);
        });
        return;
      }

      if (message.type !== 'workspace-update') {
        return;
      }

      startTransition(() => {
        setPayload((currentPayload) =>
          mergeWorkspaceUpdate(currentPayload, message.payload),
        );
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

  const profileCatalog = useMemo(
    () => payload?.profiles.flatMap((fileData) => fileData.profiles) ?? [],
    [payload?.profiles],
  );

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
    payload.editor.kind === 'profile'
      ? payload.profiles.find(
          (fileData) => fileData.file === payload.editor.file,
        )?.profiles[payload.editor.index]
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

  const sourceFile = payload.editor.file;
  const editorEyebrow =
    payload.editor.kind === 'profile' ? 'Profile' : 'Config';
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
        {payload.editor.kind === 'profile' ? (
          <ProfileEditor
            data={
              (current as ProfileData | undefined) ??
              createPlaceholderProfile(payload.editor.file)
            }
            sourceFile={payload.editor.file}
            autoSaveDelay={payload.autoSaveDelay}
            {...(currentIssue === undefined
              ? {}
              : {
                  readOnlyIssue: currentIssue,
                })}
            onChange={({
              data: nextData,
              patches,
            }: EntryChange<ProfileData>) => {
              updatePayload(payload, setPayload, payload.editor, nextData);
              enqueueUpdate(
                'profile',
                payload.editor.file,
                payload.editor.index,
                patches,
              );
            }}
            onRename={async (name) => {
              await renameEntry(
                'profile',
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
            profiles={profileCatalog}
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
            onChange={({
              data: nextData,
              patches,
            }: EntryChange<ConfigData>) => {
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
  nextData: ProfileData | ConfigData,
) {
  const nextPayload: InitialDataPayload =
    editor.kind === 'profile'
      ? {
          ...payload,
          profiles: payload.profiles.map((fileData) =>
            fileData.file !== editor.file
              ? fileData
              : {
                  ...fileData,
                  profiles: fileData.profiles.map((profile, index) =>
                    index === editor.index
                      ? (nextData as ProfileData)
                      : profile,
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

function mergeWorkspaceUpdate(
  currentPayload: InitialDataPayload | null,
  update: WorkspaceUpdatePayload,
): InitialDataPayload | null {
  if (currentPayload === null) {
    return currentPayload;
  }

  const nextIssues = [
    ...currentPayload.issues.filter((issue) => issue.kind !== update.kind),
    ...update.issues,
  ];

  return {
    ...currentPayload,
    ...(update.profiles === undefined ? {} : { profiles: update.profiles }),
    ...(update.configs === undefined ? {} : { configs: update.configs }),
    issues: nextIssues,
    ...(update.editorRevision === undefined
      ? {}
      : { editorRevision: update.editorRevision }),
  };
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

function createPlaceholderProfile(file: string): ProfileData {
  return {
    name: file,
    configuration: { type: '', request: 'launch' },
  };
}

function createPlaceholderConfig(file: string): ConfigData {
  return {
    name: file,
    enabled: true,
    profile: '',
  };
}
