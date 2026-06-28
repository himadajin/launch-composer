# Launch Composer - Extension Host ↔ Webview 通信仕様

このファイルは `launch-composer` と `@launch-composer/webview` の通信 behavior を定める。message shape の canonical source は `packages/extension/src/messages.ts`、Webview 側 mirror は `packages/webview/src/types.ts` である。契約ごとの参照先は [Host/Webview contract map](../contracts/host-webview.md) を参照する。

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
- Generate readiness
- 現在の editor target
- editor target file の revision
- `launch-composer.autoSaveDelay`

workspace file が変化した場合、Host は必要に応じて `workspace-update` を送る。profile update は open config editor にも送る。config editor は profile select 候補を更新する必要があるためである。

Generate readiness は workspace 全体の生成可能性である。Host は Generate と同じ判定源を使って readiness を計算する。

- `diagnostics`: Webview、TreeView、Generate Status が使う UI 配置用 diagnostic list

Generate 可能かどうかは `diagnostics.length === 0` で判定する。routine validation の UI 表示は `diagnostics` を単一 source of truth とし、Host/Webview message は core の `ValidationError[]` を運ばない。

Generate diagnostic は `source`、`file`、`message`、必須 `target` を持つ。`source` は core validation 由来なら `core-validation`、invalid file issue 由来なら `invalid-file` である。`target.kind` は UI が配置先を決めるための値で、profile entry は `profile`、config entry は `config`、file 全体の問題は `file` とする。profile/config diagnostic は `file` と `target.index` で editor target に対応付け、可能な場合は `target.name` と `target.field` を含める。invalid file diagnostic は `target.kind: file` として扱い、entry-level inline 表示には使わない。

Host から Webview に送る workspace snapshot payload は常に `generateReadiness` を含む。readiness 未計算の中間データは Extension Host 内部に閉じる。

## 保存と競合

`name` 以外のフォーム変更は `update-profile` または `update-config` で送る。payload は対象 file、entry index、`baseRevision`、patch list を持つ。

Host は対象 file の現在 revision と `baseRevision` を比較する。

- 一致: patch を適用し `update-result.success: true` を返す
- 不一致: 書き込まず `update-result.success: false, conflict: true` を返す

`name` は `rename-entry` で送る。rename は Host 側の専用処理で、trim、空文字拒否、一意性検証、profile rename 時の参照更新を行う。

rename request の成功・失敗後、Webview は最新 `initial-data` を再取得する。patch 保存で conflict が返った場合も同様である。

## 共有データ型

共有データ型の canonical source は次の通りである。

- JSON file data / validation error: `packages/core/src/types.ts`
- Host/Webview payload: `packages/extension/src/messages.ts`
- Webview mirror: `packages/webview/src/types.ts`
- contract map: [Host/Webview contract map](../contracts/host-webview.md)

`file` は composer directory 内のファイル名である。絶対パスではない。

`editorRevision` は Host が file content から生成する opaque string である。Webview は比較や表示を行わず、次の保存 request の `baseRevision` として返す。

## Patch 型

`EntryPatchOperation` の shape は `packages/extension/src/messages.ts` を canonical source とする。Webview 側 mirror は `packages/webview/src/types.ts` である。

`path` は entry root からの相対パスである。たとえば profile の program 変更は `['configuration', 'program']`、config の profile 変更は `['profile']` である。

Host は受け取った patch path に対象 entry の document path を prefix して JSONC document に適用する。profile の場合は `[index]`、config の場合は `['configurations', index]` を prefix する。

`path[0] === 'name'` の patch は Host が拒否する。entry name の変更は必ず `rename-entry` を使う。

## Webview → Host message

`WebviewMessage` の shape は `packages/extension/src/messages.ts` を canonical source とする。Webview が送る message は次の通りである。

- `update-profile`
- `update-config`
- `rename-entry`
- `delete-profile`
- `delete-config`
- `request-initial-data`
- `generate`
- `browse-file`
- `open-file-json`

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

`HostMessage` の shape は `packages/extension/src/messages.ts` を canonical source とする。Host が送る message は次の通りである。

- `initial-data`
- `workspace-update`
- `update-result`
- `rename-result`
- `delete-result`
- `generate-result`
- `file-selected`

### initial-data

Full snapshot と editor target を送る。Editor panel を開いた直後、`request-initial-data` への response、rename 後の再同期などで使う。

### workspace-update

Profile または config の部分 snapshot を送る。`kind` は更新対象の領域を示す。payload の `issues` はその `kind` に属する issue だけを含む。

`generateReadiness` は常に workspace 全体の最新 readiness を含める。Profile または config の部分 snapshot update でも、readiness は片側だけでなく workspace 全体を対象に再計算した値である。

`editorRevision` は、現在開いている editor target の file が更新対象 kind と一致する場合に含める。

### update-result

Patch 保存結果である。

- payload: `success: true`
  - 意味: 保存成功
  - response: `revision` と `generateReadiness` を必ず含める
- payload: `success: false, conflict: true`
  - 意味: 競合
  - Webview action: 最新データを再取得する
- payload: `success: false, error`
  - 意味: 保存失敗
  - Host action: error message を表示する

### rename-result / delete-result

Rename または delete の結果である。失敗時は `error` を含める。

### generate-result

Generate の操作結果である。payload は `{ success: boolean }` だけを返す。失敗の詳細は workspace/readiness state の `diagnostics` に表示し、`generate-result` には validation detail を含めない。

### file-selected

`browse-file` の結果である。ファイル選択時は absolute path、キャンセル時は `null` を返す。
