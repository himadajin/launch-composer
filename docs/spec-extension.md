# Launch Composer - 拡張機能ホスト仕様

このファイルは `launch-composer` パッケージの Extension Host 側仕様を定める。JSON file data の contract map は [contracts/json-files.md](./contracts/json-files.md)、生成と validation は [spec-core.md](./spec-core.md)、Webview 通信は [spec-communication.md](./spec-communication.md)、UI 表示は [spec-ui.md](./spec-ui.md) を参照する。

## 役割

Extension Host は VS Code と Launch Composer のデータモデルを接続する。

- `.vscode/launch-composer/` 以下の JSONC ファイルを読む
- JSONC ファイルへ部分更新を書く
- `@launch-composer/core` を呼び出して `launch.json` を生成する
- TreeView と Webview Panel を管理する
- VS Code コマンド、設定、FileSystemWatcher を登録する

core はファイル I/O を持たない。argsFile の読み取りも Extension Host が行い、core には `readArgsFile` callback として渡す。

## ワークスペース前提

Launch Composer は workspace folder がちょうど 1 件のときだけ通常動作する。

workspace folder が 0 件または複数件の場合:

- contributed command は登録する
- TreeView、watcher、store、editor panel は初期化しない
- command 実行時は `Launch Composer requires exactly one workspace folder.` を表示する

## パス

固定パス:

- 用途: composer root
  - パス: `.vscode/launch-composer`
- 用途: profile directory
  - パス: `.vscode/launch-composer/profiles`
- 用途: config directory
  - パス: `.vscode/launch-composer/configs`
- 用途: generated launch
  - パス: `.vscode/launch.json`
- 用途: default profile
  - パス: `.vscode/launch-composer/profiles/profile.json`
- 用途: default config
  - パス: `.vscode/launch-composer/configs/config.json`

読み込み対象は profile/config directory 直下の `.json` ファイルである。ファイル名は昇順に処理する。

## データ読み込み

`WorkspaceStore.readAll()` は profile と config をそれぞれ読み、正常データと issue を返す。

snapshot の data shape は [contracts/json-files.md](./contracts/json-files.md) と [contracts/host-webview.md](./contracts/host-webview.md) を参照する。

未作成ディレクトリは空として扱う。たとえば `.vscode/launch-composer/` がない場合、`profiles: []`、`configs: []`、`issues: []` を返す。

一覧取得後にファイルが削除されていた場合、そのファイルは静かに無視する。ユーザー向け issue にはしない。

### JSONC と issue

入力ファイルは JSONC として読む。コメントと末尾カンマを受け付ける。

読み込み時の invalid file はファイル単位の `ComposerDataIssue` として扱い、他の正常ファイルの読み込みは継続する。

`ComposerDataIssue` の shape は [contracts/host-webview.md](./contracts/host-webview.md) を参照する。

issue の分類:

- 状態: 空ファイル
  - code: `empty`
  - 期待する形:
    - profile: `[]`
    - config: `configurations` 配列を持つオブジェクト
- 状態: JSON/JSONC parse error
  - code: `invalid-json`
  - 補足: `details` に parse code と offset を含める
- 状態: ルート形状が仕様と違う
  - code: `invalid-shape`
  - 期待する形:
    - profile: 配列
    - config: `configurations` 配列を持つオブジェクト

config file の `enabled` が boolean でないなど、ルート形状として読めるが意味的に不正な値は issue ではなく core validation error として扱う。

## 初期化

`launch-composer.init` は必須セットアップではない。未実行でも、読み取り系処理は空データとして動作し、書き込み系処理は必要なディレクトリを作る。

`init` はリセットではなく、不足している既定ディレクトリと既定ファイルを作る補助コマンドである。既存ファイルは上書きしない。

作成対象:

1. `.vscode/launch-composer`
2. `.vscode/launch-composer/profiles`
3. `.vscode/launch-composer/configs`
4. `.vscode/launch-composer/profiles/profile.json`
5. `.vscode/launch-composer/configs/config.json`

default profile file:

```jsonc
// Add profile entries to this array.
// Each profile should have a unique "name".
[]
```

default config file:

```jsonc
// Configure this file and add entries to "configurations".
// Set "profile" to reference a profile.
{
  "configurations": [],
}
```

完了後は InformationMessage で storage が ready になったことを表示する。既定ファイルを作った場合は、そのファイル一覧も message に含める。

## ファイル作成・変更

### ファイル名

ファイル名入力は前後空白を trim する。空文字は拒否する。`.json` で終わらない場合は `.json` を付ける。

拡張機能側で ASCII や英数字だけに制限しない。最終的に有効なファイル名かどうかは VS Code の filesystem に従う。

同名ファイルがすでに存在する場合はエラーにする。

### data file 作成

profile file 作成時の内容:

- root: 空配列

config file 作成時の内容:

- `enabled`: `true`
- `configurations`: 空配列

親ディレクトリが未作成の場合は作成してから書き込む。

### entry 追加

profile entry 追加は、対象 profile file がなければ `[]` のファイルを作成してから配列末尾に追加する。

追加する profile entry:

```jsonc
{
  "name": "<input>",
  "configuration": {
    "type": "",
    "request": "launch",
  },
}
```

config entry 追加は、対象 config file がなければ空の config file を作成してから `configurations` 末尾に追加する。

追加する config entry:

```jsonc
{
  "name": "<input>",
  "enabled": true,
  "profile": "<selected-profile>",
}
```

config entry 追加時に利用可能な profile が 0 件の場合、config は作らず `Create a profile before adding a config.` を表示する。`Create Profile` action が選ばれた場合は通常の profile 追加フローへ進む。

### rename

entry rename は `name` を trim し、空文字を拒否する。profile と config entry の全体で同じ `name` が使われている場合は拒否する。

profile entry を rename した場合、その profile 名を参照する全 config entry の `profile` も同じ名前へ更新する。更新は JSONC 部分更新で行い、関係しないコメントを保持する。

file rename はファイル内容を変更しない。新しいファイル名へ同じ bytes を書き、元ファイルを削除する。

### delete

profile entry delete は、その profile を参照する config entry が存在する場合に拒否する。参照がない場合は profile 配列から対象要素を削除する。

config entry delete は `configurations` 配列から対象要素を削除する。

file delete は VS Code `WorkspaceEdit.deleteFile` を使い、対象ファイルがすでに存在しなくても成功扱いにする。

### included toggle

config entry の checkbox または `Include` / `Exclude` は entry-level `enabled` を切り替える。config file は生成対象状態を持たず、単なるグループとして扱う。

切り替えは JSONC 部分更新で行う。関係しないコメントは保持する。

## Webview からの保存

Webview からの保存はファイル全体の再生成ではなく、編集中 entry への部分更新である。通信契約は [spec-communication.md](./spec-communication.md) を参照する。

`name` の変更は patch ではなく `rename-entry` request で処理する。`patchProfileEntry` / `patchConfigEntry` は patch path の先頭が `name` の場合に拒否する。

`name` 以外の変更は `EntryPatchOperation[]` として受け取り、対象 entry path に prefix して JSONC document へ適用する。

revision 制御:

1. Extension Host は Webview に `editorRevision` を送る。
2. Webview は patch request に `baseRevision` を付ける。
3. Host は現在の file revision と一致した場合だけ書き込む。
4. 不一致なら `conflict: true` を返し、Webview は最新データを再取得する。

patch が空の場合は書き込まず、現在 revision を返す。

## Generate

`launch-composer.generate` は `.vscode/launch.json` を生成する。

処理順序:

1. profile/config を読み込む。
2. invalid file issue が 1 件以上あれば、validation-style error として失敗を返す。
3. `@launch-composer/core.generate()` を呼ぶ。
4. core validation error があれば VS Code error message に一覧表示して失敗する。
5. Generate 結果が成功してから overwrite confirmation を評価する。
6. confirmation が許可された場合、`.vscode/launch.json` を全体上書きする。

有効な config が 0 件でも成功とし、`configurations: []` を持つ `launch.json` を書く。

`.vscode/launch-composer/` が未作成でも Generate の前提エラーにしない。この場合は profile 0 件、config 0 件として扱う。既存の `.vscode/launch.json` が存在しない場合も前提エラーにしない。

### overwrite confirmation

設定 `launch-composer.confirmOverwrite` が `true` かつ `.vscode/launch.json` が存在する場合だけ、Generate 成功後の書き込み前に modal warning を表示する。

message:

```text
launch.json will be overwritten. Continue?
```

actions:

- `Yes`
- `Yes, Don't Ask Again`

`Yes` は今回だけ上書きする。`Yes, Don't Ask Again` は workspace setting として `launch-composer.confirmOverwrite: false` を保存し、今回も上書きする。action 未選択または dialog cancel は Generate を中断する。

チェックボックス付きダイアログは使わない。

`launch-composer.confirmOverwrite` が `false` の場合、または `.vscode/launch.json` が存在しない場合は確認を表示しない。

### launch.json 出力

書き込み前に `.vscode/` を作成する。

出力は固定コメントを先頭に持つ JSONC である。

- 1 行目: `// This file is auto-generated by Launch Composer.`
- 2 行目: `// Do not edit manually. Changes will be overwritten.`
- body: `LaunchJson` shape の JSONC

既存の `.vscode/launch.json` の内容、手動編集、コメント、既存 configurations は保持しない。常に生成結果で全体を置き換える。

## watcher と UI 同期

Extension Host は profile と config の JSON ファイルを `FileSystemWatcher` で監視する。

登録する pattern:

- `.vscode/launch-composer/profiles/**/*.json`
- `.vscode/launch-composer/configs/**/*.json`

watcher event の扱い:

- event: create
  - 処理:
    - TreeView を更新する
    - Webview を更新する
  - issue 通知: 評価しない
- event: change
  - 処理:
    - TreeView を更新する
    - Webview を更新する
    - issue 通知を評価する
- event: delete
  - 処理:
    - TreeView を更新する
    - Webview を更新する
    - 残っている issue を再評価する

拡張機能自身が書き込んだ直後に発生する watcher event は、期待済み event として 1 回分無視する。

issue notification:

- 同じ `kind:file` の同じ `code:message` は繰り返し通知しない
- `details` だけが変わっても同じ issue とみなす
- ファイルが正常化したら通知状態を破棄する
- 復旧通知は出さない

現在 Webview で開いている entry のファイルが invalid になった場合、panel は閉じず、invalid file の初期データを送って read-only 表示へ切り替える。対象 entry がなくなった場合は panel を閉じる。

profile の更新は、open config editor にも workspace update を送る。config editor は profile selector の候補を更新する必要があるためである。profile editor が開いているときの config-only update は editor へ送らない。

## コマンド

### Command Palette に表示する command

- command ID: `launch-composer.generate`
  - title: `Generate launch.json`
  - category: `Launch Composer`
- command ID: `launch-composer.init`
  - title: `Initialize`
  - category: `Launch Composer`
- command ID: `launch-composer.addProfile`
  - title: `Add Profile`
  - category: `Launch Composer`

その他の command は command palette から隠す。

すべての contributed command は `workspaceFolderCount == 1` の enablement を持つ。

### TreeView / Webview 用 command

- command ID: `launch-composer.addProfileFile`
  - 主な用途: profile file 作成
- command ID: `launch-composer.addConfigFile`
  - 主な用途: config file 作成
- command ID: `launch-composer.addProfileEntry`
  - 主な用途: profile entry 追加
- command ID: `launch-composer.addConfigEntry`
  - 主な用途: config entry 追加
- command ID: `launch-composer.openProfileFileJson`
  - 主な用途: profile file を開く
- command ID: `launch-composer.openConfigFileJson`
  - 主な用途: config file を開く
- command ID: `launch-composer.openItemJson`
  - 主な用途: entry の JSON 位置を開く
- command ID: `launch-composer.openActiveEditorJson`
  - 主な用途: Webview editor の title action から JSON を開く
- command ID: `launch-composer.copyProfileFilePath`
  - 主な用途: profile file の絶対パスをコピー
- command ID: `launch-composer.copyConfigFilePath`
  - 主な用途: config file の絶対パスをコピー
- command ID: `launch-composer.copyItemFilePath`
  - 主な用途: entry 所属 file の絶対パスをコピー
- command ID: `launch-composer.copyProfileFileRelativePath`
  - 主な用途: profile file の workspace 相対パスをコピー
- command ID: `launch-composer.copyConfigFileRelativePath`
  - 主な用途: config file の workspace 相対パスをコピー
- command ID: `launch-composer.copyItemFileRelativePath`
  - 主な用途: entry 所属 file の workspace 相対パスをコピー
- command ID: `launch-composer.renameProfileFile`
  - 主な用途: profile file rename
- command ID: `launch-composer.renameConfigFile`
  - 主な用途: config file rename
- command ID: `launch-composer.renameItem`
  - 主な用途: entry rename
- command ID: `launch-composer.deleteProfileFile`
  - 主な用途: profile file delete
- command ID: `launch-composer.deleteConfigFile`
  - 主な用途: config file delete
- command ID: `launch-composer.deleteItem`
  - 主な用途: entry delete
- command ID: `launch-composer.enableConfig`
  - 主な用途: config file / entry を有効化
- command ID: `launch-composer.disableConfig`
  - 主な用途: config file / entry を無効化
- command ID: `launch-composer.toggleEnabled`
  - 主な用途: checkbox 操作による enabled toggle

menus と表示条件の詳細は [spec-ui.md](./spec-ui.md) を参照する。

## 設定

- setting: `launch-composer.confirmOverwrite`
  - 型: boolean
  - default: `true`
  - 説明: 既存 `launch.json` 上書き前に確認する
- setting: `launch-composer.autoSaveDelay`
  - 型: number
  - default: `1000`
  - 説明: Webview の text field 編集を保存する debounce delay(ms)

`autoSaveDelay` は `minimum: 0` として contribution する。
