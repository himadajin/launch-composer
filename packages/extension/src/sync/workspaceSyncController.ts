import type {
  ComposerDataIssue,
  WorkspaceDataSnapshot,
  WorkspaceDataWithoutReadiness,
  WorkspaceStore,
} from '../io/workspaceStore.js';
import type { DataFileKind } from '../io/workspaceLayout.js';
import {
  expectDataFileWrites,
  type WatcherEchoFilter,
} from './watcherEchoFilter.js';

export type SnapshotKind = DataFileKind | 'both';

export interface SyncOptions {
  notifyIssues?: boolean;
  kind?: SnapshotKind;
  syncEditor?: boolean;
}

/** A UI refresh request emitted after a workspace mutation. */
export interface RefreshRequest {
  kind: SnapshotKind;
  expectedWatchers?: ReadonlyArray<{
    kind: DataFileKind;
    file: string;
  }>;
  syncEditor?: boolean;
}

type SyncStore = Pick<
  WorkspaceStore,
  | 'readAll'
  | 'readProfilesWithIssues'
  | 'readConfigsWithIssues'
  | 'withGenerateReadiness'
>;

interface SyncControllerDeps {
  store: SyncStore;
  echoFilter: WatcherEchoFilter;
  applySnapshot: (snapshot: WorkspaceDataSnapshot, kind: SnapshotKind) => void;
  reportIssues: (issues: ComposerDataIssue[]) => void;
  onError: (error: unknown) => void;
}

/**
 * Owns the workspace snapshot cache and the sequential sync queue that
 * keeps tree views and the editor panel consistent with the workspace.
 *
 * Invariant: the per-kind cache entries are only trusted together — a
 * partial cache (e.g. profiles read but configs never read) yields no
 * cached snapshot and forces a full read.
 */
export class WorkspaceSyncController {
  private readonly cache: {
    profiles?: WorkspaceDataSnapshot['profiles'];
    configs?: WorkspaceDataSnapshot['configs'];
    profileIssues?: ComposerDataIssue[];
    configIssues?: ComposerDataIssue[];
  } = {};

  private queue = Promise.resolve();
  private editorSync:
    | ((snapshot: WorkspaceDataSnapshot, kind: SnapshotKind) => Promise<void>)
    | undefined;

  constructor(private readonly deps: SyncControllerDeps) {}

  /**
   * Late binding for the editor panel, which is constructed after this
   * controller because its mutation callback is `refresh`.
   */
  setEditorSync(
    editorSync: (
      snapshot: WorkspaceDataSnapshot,
      kind: SnapshotKind,
    ) => Promise<void>,
  ): void {
    this.editorSync = editorSync;
  }

  async sync(options?: SyncOptions): Promise<void> {
    const nextSync = this.queue.then(async () => {
      const kind = options?.kind ?? 'both';
      const snapshot = await this.readSnapshotForKind(kind);
      if (options?.notifyIssues !== false) {
        this.deps.reportIssues(snapshot.issues);
      }
      // A partial file change can alter diagnostics placed on either tree
      // (for example, a renamed profile can invalidate a config reference).
      // The editor still receives the original kind below so its partial
      // payload and revision semantics remain unchanged.
      this.deps.applySnapshot(snapshot, 'both');
      if (options?.syncEditor !== false) {
        await this.editorSync?.(snapshot, kind);
      }
    });

    this.queue = nextSync.catch(() => undefined);
    await nextSync;
  }

  refresh(request?: Partial<RefreshRequest>): void {
    expectDataFileWrites(this.deps.echoFilter, request?.expectedWatchers ?? []);
    const syncOptions: SyncOptions = {
      notifyIssues: false,
    };
    if (request?.kind !== undefined) {
      syncOptions.kind = request.kind;
    }
    if (request?.syncEditor !== undefined) {
      syncOptions.syncEditor = request.syncEditor;
    }

    void this.sync(syncOptions).catch(this.deps.onError);
  }

  private async readSnapshotForKind(
    kind: SnapshotKind,
  ): Promise<WorkspaceDataSnapshot> {
    const cachedSnapshot = this.getCachedSnapshot();
    if (kind === 'both' || cachedSnapshot === undefined) {
      const snapshot = await this.deps.store.readAll();
      this.cacheSnapshot(snapshot);
      return snapshot;
    }

    if (kind === 'profile') {
      const profileData = await this.deps.store.readProfilesWithIssues();
      this.cache.profiles = profileData.profiles;
      this.cache.profileIssues = profileData.issues;
    } else {
      const configData = await this.deps.store.readConfigsWithIssues();
      this.cache.configs = configData.configs;
      this.cache.configIssues = configData.issues;
    }

    return this.deps.store.withGenerateReadiness(
      this.getCachedSnapshot() ?? cachedSnapshot,
    );
  }

  private cacheSnapshot(snapshot: WorkspaceDataSnapshot): void {
    this.cache.profiles = snapshot.profiles;
    this.cache.configs = snapshot.configs;
    this.cache.profileIssues = snapshot.issues.filter(
      (issue) => issue.kind === 'profile',
    );
    this.cache.configIssues = snapshot.issues.filter(
      (issue) => issue.kind === 'config',
    );
  }

  private getCachedSnapshot(): WorkspaceDataWithoutReadiness | undefined {
    if (
      this.cache.profiles === undefined ||
      this.cache.configs === undefined ||
      this.cache.profileIssues === undefined ||
      this.cache.configIssues === undefined
    ) {
      return undefined;
    }

    return {
      profiles: this.cache.profiles,
      configs: this.cache.configs,
      issues: [...this.cache.profileIssues, ...this.cache.configIssues],
    };
  }
}
