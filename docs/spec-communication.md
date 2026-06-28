# Launch Composer - Extension Host ↔ Webview 通信仕様

このファイルは `launch-composer` と `@launch-composer/webview` の通信契約を定める。`packages/extension/src/messages.ts` と `packages/webview/src/types.ts` はこの仕様と同じ shape を持つ。

## 基本方針

Extension Host と Webview は VS Code の `postMessage` API で通信する。Webview は workspace file I/O を直接行わない。編集内容は message として Host に送り、Host が JSONC file へ書き込む。

通信には request/response 型と fire-and-forget 型がある。

- response が必要な Webview message は `requestId: string` を持つ
- Host response は同じ `requestId` を返す
- `open-file-json` は fire-and-forget であり `requestId` を持たない

Webview 側は `RpcClient` で `requestId` を生成し、response message を Promise に対応付ける。

## データ同期

Editor panel を開いたとき、Host は `initial-data` を送る。

`initial-data` には以下を含める。

- 全 profile file data
- 全 config file data
- 現在の issue list
- 現在の editor target
- editor target file の revision
- `launch-composer.autoSaveDelay`

workspace file が変化した場合、Host は必要に応じて `workspace-update` を送る。profile update は open config editor にも送る。config editor は profile select 候補を更新する必要があるためである。

## 保存と競合

`name` 以外のフォーム変更は `update-profile` または `update-config` で送る。payload は対象 file、entry index、`baseRevision`、patch list を持つ。

Host は対象 file の現在 revision と `baseRevision` を比較する。

- 一致: patch を適用し `update-result.success: true` を返す
- 不一致: 書き込まず `update-result.success: false, conflict: true` を返す

`name` は `rename-entry` で送る。rename は Host 側の専用処理で、trim、空文字拒否、一意性検証、profile rename 時の参照更新を行う。

rename request の成功・失敗後、Webview は最新 `initial-data` を再取得する。patch 保存で conflict が返った場合も同様である。

## 共有データ型

```typescript
interface ProfileEntry {
  [key: string]: unknown;
}

interface ProfileData {
  name: string;
  args?: string[];
  configuration?: ProfileEntry;
}

interface ConfigEntry {
  [key: string]: unknown;
}

interface ConfigData {
  name: string;
  enabled?: boolean;
  profile: string;
  argsFile?: string;
  args?: string[];
  configuration?: ConfigEntry;
}

interface ProfileFileData {
  file: string;
  profiles: ProfileData[];
}

interface ConfigFileData {
  file: string;
  enabled?: boolean;
  configurations: ConfigData[];
}

interface ValidationError {
  file: string;
  configName?: string;
  field?: string;
  message: string;
}

interface EditorTarget {
  kind: 'profile' | 'config';
  file: string;
  index: number;
}

interface ComposerDataIssue {
  kind: 'profile' | 'config';
  file: string;
  code: 'empty' | 'invalid-json' | 'invalid-shape';
  message: string;
  details?: string;
}

interface InitialDataPayload {
  profiles: ProfileFileData[];
  configs: ConfigFileData[];
  issues: ComposerDataIssue[];
  editor: EditorTarget;
  editorRevision: string | null;
  autoSaveDelay: number;
}

interface WorkspaceUpdatePayload {
  kind: 'profile' | 'config';
  profiles?: ProfileFileData[];
  configs?: ConfigFileData[];
  issues: ComposerDataIssue[];
  editorRevision?: string | null;
}
```

`file` は composer directory 内のファイル名である。絶対パスではない。

`editorRevision` は Host が file content から生成する opaque string である。Webview は比較や表示を行わず、次の保存 request の `baseRevision` として返す。

## Patch 型

```typescript
type EntryPatchOperation =
  | {
      type: 'set';
      path: (string | number)[];
      value: unknown;
    }
  | {
      type: 'delete';
      path: (string | number)[];
    };
```

`path` は entry root からの相対パスである。たとえば profile の program 変更は `['configuration', 'program']`、config の profile 変更は `['profile']` である。

Host は受け取った patch path に対象 entry の document path を prefix して JSONC document に適用する。profile の場合は `[index]`、config の場合は `['configurations', index]` を prefix する。

`path[0] === 'name'` の patch は Host が拒否する。entry name の変更は必ず `rename-entry` を使う。

## Webview → Host message

```typescript
type WebviewMessage =
  | {
      type: 'update-profile';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  | {
      type: 'update-config';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  | {
      type: 'rename-entry';
      requestId: string;
      payload: {
        kind: 'profile' | 'config';
        file: string;
        index: number;
        name: string;
      };
    }
  | {
      type: 'delete-profile';
      requestId: string;
      payload: { file: string; index: number };
    }
  | {
      type: 'delete-config';
      requestId: string;
      payload: { file: string; index: number };
    }
  | { type: 'request-initial-data'; requestId: string }
  | { type: 'generate'; requestId: string }
  | { type: 'browse-file'; requestId: string }
  | {
      type: 'open-file-json';
      payload: { kind: 'profile' | 'config'; file: string };
    };
```

### update-profile / update-config

Entry patch 保存 request である。Host は `update-result` を返す。

### rename-entry

Entry name 変更 request である。Host は `rename-result` を返す。

profile rename の場合、Host は参照している config entry の `profile` も更新する。

### delete-profile / delete-config

Webview から entry を削除する request である。Host は `delete-result` を返す。現在の UI では TreeView の削除導線が主だが、通信型としては存在する。

### request-initial-data

現在の editor target に対する最新 `initial-data` を要求する。Host は `initial-data` を返す。

### generate

Webview から Generate を要求する。Host は通常の Generate 処理を実行し、`generate-result` を返す。

### browse-file

Host に `showOpenDialog` を開かせる。Host は `file-selected` を返す。キャンセル時の `path` は `null` である。

### open-file-json

Backing JSON file を開く fire-and-forget message である。response はない。

## Host → Webview message

```typescript
type HostMessage =
  | {
      type: 'initial-data';
      requestId: string;
      payload: InitialDataPayload;
    }
  | {
      type: 'workspace-update';
      requestId: string;
      payload: WorkspaceUpdatePayload;
    }
  | {
      type: 'update-result';
      requestId: string;
      payload: {
        success: boolean;
        conflict?: boolean;
        revision?: string | null;
        error?: string;
      };
    }
  | {
      type: 'rename-result';
      requestId: string;
      payload: {
        success: boolean;
        error?: string;
      };
    }
  | {
      type: 'delete-result';
      requestId: string;
      payload: { success: boolean; error?: string };
    }
  | {
      type: 'generate-result';
      requestId: string;
      payload: { success: boolean; errors?: ValidationError[] };
    }
  | {
      type: 'file-selected';
      requestId: string;
      payload: { path: string | null };
    };
```

### initial-data

Full snapshot と editor target を送る。Editor panel を開いた直後、`request-initial-data` への response、rename 後の再同期などで使う。

### workspace-update

Profile または config の部分 snapshot を送る。`kind` は更新対象の領域を示す。payload の `issues` はその `kind` に属する issue だけを含む。

`editorRevision` は、現在開いている editor target の file が更新対象 kind と一致する場合に含める。

### update-result

Patch 保存結果である。

| payload                          | 意味                                       |
| -------------------------------- | ------------------------------------------ |
| `success: true`                  | 保存成功。`revision` を含める              |
| `success: false, conflict: true` | 競合。Webview は再取得する                 |
| `success: false, error`          | 保存失敗。Host は error message も表示する |

### rename-result / delete-result

Rename または delete の結果である。失敗時は `error` を含める。

### generate-result

Generate の結果である。失敗時は core validation error または invalid file 由来の error を `errors` に含める。

### file-selected

`browse-file` の結果である。ファイル選択時は absolute path、キャンセル時は `null` を返す。
