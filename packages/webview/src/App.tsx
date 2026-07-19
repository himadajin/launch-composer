import { useMemo } from 'react';

import { ConfigEditor } from './components/ConfigEditor.js';
import type { EntryChange } from './components/entryChanges.js';
import { GenerateStatus } from './components/GenerateStatus.js';
import { ProfileEditor } from './components/ProfileEditor.js';
import type { ConfigData, ProfileData } from './types.js';
import { getEditorDiagnostics } from './components/generateReadiness.js';
import { useComposerPayload } from './hooks/useComposerPayload.js';
import { useEntryUpdateQueue } from './hooks/useEntryUpdateQueue.js';
import {
  createPlaceholderConfig,
  createPlaceholderProfile,
  updatePayload,
} from './payloadUpdates.js';
import { RpcClient } from './utils/rpc.js';

const rpc = new RpcClient();

export function App() {
  const { payload, setPayload, requestLatestPayload } = useComposerPayload(rpc);
  const editorKey =
    payload === null
      ? ''
      : `${payload.editor.kind}:${payload.editor.file}:${payload.editor.index}`;

  const { enqueueUpdate, renameEntry } = useEntryUpdateQueue({
    rpc,
    editorRevision: payload?.editorRevision ?? null,
    editorKey,
    setPayload,
    requestLatestPayload,
  });

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

  const editor = payload.editor;
  const current =
    editor.kind === 'profile'
      ? payload.profiles.find((fileData) => fileData.file === editor.file)
          ?.profiles[editor.index]
      : payload.configs.find((fileData) => fileData.file === editor.file)
          ?.configurations[editor.index];
  const currentIssue = payload.issues.find(
    (issue) => issue.kind === editor.kind && issue.file === editor.file,
  );
  const currentDiagnostics =
    currentIssue === undefined
      ? getEditorDiagnostics(payload.generateReadiness, editor)
      : [];
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

  const sourceFile = editor.file;
  const editorEyebrow = editor.kind === 'profile' ? 'Profile' : 'Config';
  const editorHeading = current === undefined ? sourceFile : current.name;

  const handleChange = ({
    data: nextData,
    patches,
  }: EntryChange<ProfileData | ConfigData>) => {
    setPayload(updatePayload(payload, editor, nextData));
    enqueueUpdate(editor.kind, editor.file, editor.index, patches);
  };
  const handleRename = async (name: string) => {
    await renameEntry(editor.kind, editor.file, editor.index, name);
  };
  const openFileJson = () => {
    rpc.post({
      type: 'open-file-json',
      payload: {
        kind: editor.kind,
        file: editor.file,
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
        <GenerateStatus readiness={payload.generateReadiness} />
        {editor.kind === 'profile' ? (
          <ProfileEditor
            key={editorKey}
            data={
              (current as ProfileData | undefined) ??
              createPlaceholderProfile(editor.file)
            }
            sourceFile={editor.file}
            autoSaveDelay={payload.autoSaveDelay}
            diagnostics={currentDiagnostics}
            readOnlyIssue={currentIssue}
            onChange={handleChange}
            onRename={handleRename}
            onOpenJson={openFileJson}
          />
        ) : (
          <ConfigEditor
            key={editorKey}
            data={
              (current as ConfigData | undefined) ??
              createPlaceholderConfig(editor.file)
            }
            sourceFile={editor.file}
            profiles={profileCatalog}
            autoSaveDelay={payload.autoSaveDelay}
            diagnostics={currentDiagnostics}
            readOnlyIssue={currentIssue}
            onBrowseFile={async () => {
              const result = await rpc.sendRequest({ type: 'browse-file' });
              return result.path;
            }}
            onChange={handleChange}
            onRename={handleRename}
            onOpenJson={openFileJson}
          />
        )}
      </section>
    </main>
  );
}
