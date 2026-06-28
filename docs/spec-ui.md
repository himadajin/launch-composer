# Launch Composer - UI 仕様

このファイルは Launch Composer の TreeView と Webview 編集フォームのユーザー向け挙動を定める。ファイル I/O と Generate の詳細は [spec-extension.md](./spec-extension.md)、通信契約は [spec-communication.md](./spec-communication.md)、生成規則は [spec-core.md](./spec-core.md) を参照する。

## UI 構成

Launch Composer は Activity Bar に `Launch Composer` view container を追加し、その中に 2 つの TreeView を表示する。

- view ID: `launchComposer.configs`
  - 表示名: `CONFIGS`
  - 役割: config file / entry
- view ID: `launchComposer.profiles`
  - 表示名: `PROFILES`
  - 役割: profile file / entry

manifest 上の view 定義順は `CONFIGS`、`PROFILES` である。

編集フォームは Webview Panel として editor area に開く。TreeView は VS Code TreeView API、編集フォームは React 19 + `@himadajin/vscode-components` で実装する。

## TreeView

### 空状態

対象 directory が未作成、または `.json` file がない場合、VS Code の `viewsWelcome` を表示する。

- view: PROFILES
  - welcome content: `No profile files found. [Create Profile File]`
- view: CONFIGS
  - welcome content: `No config files found. [Create Config File]`

リンクは対応する file 作成 command を実行する。

### file node

file node の label はファイル名である。TreeItem の `resourceUri` は実ファイル URI にする。

profile file:

- context: `profileFile`
- collapsible: expanded
- children: profile entries

config file:

- context: `configFile` または `configFileDisabled`
- collapsible: expanded
- checkbox を表示する
- `enabled === false` の場合、checkbox は unchecked、description は `disabled`
- `enabled` 省略時は Generate 上も TreeView 上も enabled として扱う

invalid file:

- context: `profileFileInvalid` または `configFileInvalid`
- warning icon を表示する
- description は issue code に応じて `empty file` / `invalid JSON` / `invalid shape`
- collapsible: none
- children は表示しない
- 既定 action は JSON file を開く
- Add Entry は提供しない
- Open / Copy Path / Copy Relative Path / Rename / Delete は提供する

### entry node

profile entry:

- label は profile `name`
- context: `profileEntry`
- command: `launch-composer.editItem`
- icon は表示しない

config entry:

- label は config `name`
- command: `launch-composer.editItem`

config entry の状態:

- 状態: entry enabled、file enabled
  - context: `configEntryEnabled`
  - 表示: checked checkbox
- 状態: entry disabled、file enabled
  - context: `configEntryDisabled`
  - 表示: unchecked checkbox、description `disabled`
- 状態: file disabled 配下の entry
  - context: `configEntryDisabledByFile`
  - 表示: checkbox なし、`circle-slash` icon、description `disabled by file`

file disabled 配下の entry は、entry 自身の `enabled` が true/false のどちらでも `disabled by file` 表示にする。entry 自身の値は JSON に残り、file を再度 enabled にしたときに使われる。

### view title actions

- view: PROFILES
  - action: `launch-composer.addProfileFile` (`$(add)`)
- view: CONFIGS
  - action: `launch-composer.addConfigFile` (`$(add)`)
- view: CONFIGS
  - action: `launch-composer.generate` (`$(play)`)

### item context menu

profile file:

- Add Profile
- Open
- Copy Path
- Copy Relative Path
- Rename
- Delete

config file:

- Add Config
- Open
- Copy Path
- Copy Relative Path
- Enable または Disable
- Rename
- Delete

profile/config entry:

- Open
- Copy Path
- Copy Relative Path
- Rename
- Delete

config entry では状態に応じて Enable / Disable を最上段に表示する。ただし `configEntryDisabledByFile` には Enable / Disable を表示しない。

inline actions:

- file node: Add Entry
- entry node: Open JSON (`$(go-to-file)`)

削除は inline action では提供しない。

### checkbox 操作

CONFIGS TreeView は `manageCheckboxStateManually: true` で作成する。

checkbox 操作は即座に JSONC file へ書き込む。

- config file checkbox: file-level `enabled` を切り替える
- config entry checkbox: entry-level `enabled` を切り替える
- `disabled by file` entry には checkbox を出さない

## Webview Editor

### panel

編集フォームは単一 panel 方式である。別の TreeView entry を選ぶと、既存 panel の内容を切り替える。複数の editor panel を同時に開く手段は提供しない。

panel option:

- `enableScripts: true`
- `retainContextWhenHidden: true`

VS Code editor tab title は現在の entry name にする。entry name が解決できない場合、または対象 file が invalid な場合は `basename(file)` を使う。

Webview 内 header:

1. `Profile` または `Config`
2. 現在の entry name。entry が読めない場合は source file 名
3. source file 名

TreeView entry を開いたとき、対応する TreeView item を `TreeView.reveal()` で選択状態にする。panel を閉じた後の選択解除は実装対象外である。

### JSON を開く導線

Webview の editor title action `Open JSON` は `launch-composer.openActiveEditorJson` を実行する。

- 対象 file が valid の場合は、entry の JSON 位置を開く
- 対象 file が invalid の場合は、entry 位置を解決せず file 全体を開く

フォーム最下部の `Edit in <sourceFile>` も backing JSON file を開く。Webview 内のこの導線は entry 位置へジャンプしない。

### invalid file 表示

対象 file が invalid になった場合、panel は閉じない。通常のフォーム layout を維持し、先頭に `JSON Status` row を表示する。

`JSON Status`:

- description に issue message を表示する
- helper に issue details があれば表示する
- details がなければ `Fix the JSON file to resume form editing.` を表示する
- `Edit in <sourceFile>` で backing file を開ける

すべての編集 control は disabled または read-only にする。`ListEditor` は read-only text 表示に置き換える。file が正常化すると workspace update により通常編集へ戻る。

対象 entry が削除されて存在しなくなった場合は panel を閉じる。Webview 側で current entry がなく、invalid issue もない場合は `The selected item no longer exists. Reopen it from the sidebar.` を表示する。

## Profile Editor

profile editor のフォーム項目:

- 表示ラベル: `Profile: Name`
  - JSON path: `name`
  - control: `TextInput`
  - 保存方法: blur / Enter で rename request
- 表示ラベル: `Profile: Program`
  - JSON path: `configuration.program`
  - control: `TextInput`
  - 保存方法: debounce 後 patch
- 表示ラベル: `Profile: Working Directory`
  - JSON path: `configuration.cwd`
  - control: `TextInput`
  - 保存方法: debounce 後 patch
- 表示ラベル: `Profile: Stop At Entry`
  - JSON path: `configuration.stopAtEntry`
  - control: `Checkbox`
  - 保存方法: 即時 patch
- 表示ラベル: `Profile: Args`
  - JSON path: `args`
  - control: `ListEditor`
  - 保存方法: 変更操作完了時に即時 patch

profile editor は `configuration.type` と `configuration.request` をフォーム項目として表示しない。Generate には必須なので、必要に応じて JSON を直接編集する。

保存挙動:

- `name` は patch ではなく rename request を使う
- profile rename 成功時、Extension Host は参照している config entry の `profile` も更新する
- Program / Working Directory は空白だけになった場合、対応する leaf key を削除する patch を送る
- Stop At Entry は checked 値を `true` / `false` として書く
- Args は空配列になった場合、top-level `args` を削除する
- TextInput の debounce はユーザー入力に対してだけ意味を持つ。props からの同期だけで実質的な保存 patch は発生しない

`configuration` 内の最後の GUI-managed field を削除した場合でも、Host は受け取った leaf patch だけを適用する。親の `configuration` オブジェクトを自動的に削除することは仕様にしない。

## Config Editor

config editor のフォーム項目:

- 表示ラベル: `Config: Name`
  - JSON path: `name`
  - control: `TextInput`
  - 保存方法: blur / Enter で rename request
- 表示ラベル: `Config: Profile`
  - JSON path: `profile`
  - control: `Select`
  - 保存方法: 即時 patch
- 表示ラベル: `Config: Enabled`
  - JSON path: `enabled`
  - control: `Checkbox`
  - 保存方法: 即時 patch
- 表示ラベル: `Config: Working Directory`
  - JSON path: `configuration.cwd`
  - control: `TextInput`
  - 保存方法: debounce 後 patch
- 表示ラベル: `Config: Stop At Entry`
  - JSON path: `configuration.stopAtEntry`
  - control: `Checkbox`
  - 保存方法: 即時 patch
- 表示ラベル: `Config: Args File`
  - JSON path: `argsFile`
  - control: `TextInput` + Browse
  - 保存方法: TextInput は debounce、Browse は即時 patch
- 表示ラベル: `Config: Args`
  - JSON path: `args`
  - control: `ListEditor`
  - 保存方法: 変更操作完了時に即時 patch

config editor は `configuration.type`、`configuration.request`、`configuration.program` をフォーム項目として表示しない。Generate 時、config の `configuration` にこれらの key がある場合は core validation error になるため、通常は profile 側で管理する。

保存挙動:

- `name` は patch ではなく rename request を使う
- Profile select は internal placeholder 値を選んだ場合は保存しない
- Enabled は checked 値を `true` / `false` として書く
- Working Directory は空白だけになった場合、対応する leaf key を削除する patch を送る
- Args File は trim して保存する。空白だけになった場合は top-level `argsFile` を削除する
- Args は空配列になった場合、top-level `args` を削除する
- Browse は `showOpenDialog` を開き、ファイルが選ばれたら選択 path を `argsFile` として即時保存する

親 config file の `enabled === false` の場合、`Config: Enabled` row に info helper として `This config is currently disabled by the file-level setting.` を表示する。config editor は file-level `enabled` を直接編集しない。

選択中 profile に `args` が定義されている場合、Args File control は disabled になり、`The selected profile already defines args.` を表示する。

## Profile Select

Config Editor の Profile select は、profile file から読み込んだ有効な profile name を列挙する。同じ profile name が複数ある場合、候補表示では重複を 1 件にまとめる。

境界ケース:

- 状態: `profile` が空文字、profile 候補あり
  - 表示値/状態: `Select a profile...` placeholder + warning helper
- 状態: `profile` が string ではない、profile 候補あり
  - 表示値/状態: `Select a profile...` placeholder + invalid value warning
- 状態: `profile` が未知文字列、profile 候補あり
  - 表示値/状態: `<name> (missing)` を候補末尾に表示 + warning helper
- 状態: profile 候補 0 件、`profile` 空または非 string
  - 表示値/状態: `No profiles available`、disabled + warning helper
- 状態: profile 候補 0 件、`profile` が未知文字列
  - 表示値/状態: `<name> (missing)`、disabled + warning helper

空白ラベルの option は表示しない。

## Webview 保存キュー

Webview は patch 保存要求を直列化する。前回の `update-result` を待ってから次の patch request を送る。

保存結果:

- success: Webview は `editorRevision` を更新する
- conflict: Webview は `request-initial-data` で最新状態を再取得する
- rename success / failure: Webview は結果に関わらず最新状態を再取得する

Webview は VS Code webview state に最新 payload を保存し、panel が hidden になっても state を維持する。
