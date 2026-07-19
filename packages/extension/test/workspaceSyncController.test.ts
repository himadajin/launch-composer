import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  WorkspaceDataSnapshot,
  WorkspaceDataWithoutReadiness,
  WorkspaceStore,
} from '../src/io/workspaceStore.js';
import { WatcherEchoFilter } from '../src/sync/watcherEchoFilter.js';
import {
  WorkspaceSyncController,
  type SnapshotKind,
} from '../src/sync/workspaceSyncController.js';

test('a profile sync refreshes both trees with config diagnostics recomputed from the full snapshot', async () => {
  const initialProfiles = [
    {
      file: 'profile.json',
      profiles: [{ name: 'node' }],
    },
  ];
  const refreshedProfiles = [
    {
      file: 'profile.json',
      profiles: [{ name: 'node-renamed' }],
    },
  ];
  const configs = [
    {
      file: 'config.json',
      configurations: [{ name: 'Launch', profile: 'node' }],
    },
  ];
  const applyCalls: Array<{
    snapshot: WorkspaceDataSnapshot;
    kind: SnapshotKind;
  }> = [];
  const editorCalls: Array<{
    snapshot: WorkspaceDataSnapshot;
    kind: SnapshotKind;
  }> = [];

  const withGenerateReadiness = (
    snapshot: WorkspaceDataWithoutReadiness,
  ): WorkspaceDataSnapshot => ({
    ...snapshot,
    generateReadiness: {
      diagnostics:
        snapshot.profiles[0]?.profiles[0]?.name === 'node'
          ? []
          : [
              {
                source: 'core-validation',
                file: 'config.json',
                message: 'Profile "node" was not found.',
                target: {
                  kind: 'config',
                  index: 0,
                  name: 'Launch',
                  field: 'profile',
                },
              },
            ],
    },
  });

  const store = {
    async readAll() {
      return withGenerateReadiness({
        profiles: initialProfiles,
        configs,
        issues: [],
      });
    },
    async readProfilesWithIssues() {
      return { profiles: refreshedProfiles, issues: [] };
    },
    async readConfigsWithIssues() {
      return { configs, issues: [] };
    },
    async withGenerateReadiness(snapshot: WorkspaceDataWithoutReadiness) {
      return withGenerateReadiness(snapshot);
    },
  } as Pick<
    WorkspaceStore,
    | 'readAll'
    | 'readProfilesWithIssues'
    | 'readConfigsWithIssues'
    | 'withGenerateReadiness'
  > as WorkspaceStore;

  const controller = new WorkspaceSyncController({
    store,
    echoFilter: new WatcherEchoFilter(),
    applySnapshot(snapshot, kind) {
      applyCalls.push({ snapshot, kind });
    },
    reportIssues() {},
    onError() {},
  });
  controller.setEditorSync(async (snapshot, kind) => {
    editorCalls.push({ snapshot, kind });
  });

  await controller.sync();
  await controller.sync({ kind: 'profile' });

  assert.equal(applyCalls.length, 2);
  assert.equal(applyCalls[1]?.kind, 'both');
  assert.deepEqual(applyCalls[1]?.snapshot.profiles, refreshedProfiles);
  assert.deepEqual(applyCalls[1]?.snapshot.configs, configs);
  assert.deepEqual(applyCalls[1]?.snapshot.generateReadiness.diagnostics, [
    {
      source: 'core-validation',
      file: 'config.json',
      message: 'Profile "node" was not found.',
      target: {
        kind: 'config',
        index: 0,
        name: 'Launch',
        field: 'profile',
      },
    },
  ]);
  assert.equal(editorCalls.length, 2);
  assert.equal(editorCalls[1]?.kind, 'profile');
  assert.deepEqual(editorCalls[1]?.snapshot.profiles, refreshedProfiles);
});
