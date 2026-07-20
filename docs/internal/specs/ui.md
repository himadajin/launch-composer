# Launch Composer - UI 仕様

このファイルは Launch Composer の TreeView と Webview 編集フォームのユーザー向け挙動を定める。ファイル I/O と Generate の詳細は [extension.md](./extension.md)、通信契約は [communication.md](./communication.md)、生成規則は [core.md](./core.md) を参照する。

## UI 構成

Launch Composer は Activity Bar に `Launch Composer` view container を追加し、その中に単一の TreeView を表示する。

- view ID: `launchComposer.explorer`
  - 表示名: `Launch Composer`
  - 役割: config / profile の file と entry を 1 本のツリーで表示する

TreeView は section node → file node → entry node の 3 階層である。root 直下に 2 つの section node を置き、並び順は `Configs`、`Profiles` である。

編集フォームは Webview Panel として editor area に開く。TreeView は VS Code TreeView API、編集フォームは React 19 + `@himadajin/vscode-components` で実装する。

## TreeView

### 空状態

空状態は 2 態を区別する。

profile と config の両方で、対象 directory が未作成または `.json` file(invalid file を含む)が 1 件もない場合、TreeView の root を空にして VS Code の `viewsWelcome` を表示する。

- view: `launchComposer.explorer`
  - welcome content: `No profile or config files found. [Initialize Launch Composer](command:launch-composer.init)`

リンクは `launch-composer.init` を実行する。

片方の kind にだけ file がない場合は welcome を表示せず、両方の section node を表示する。file のない section は子要素なしの空のままにし、プレースホルダ項目は追加しない。file 作成の導線は section node の inline action である。

### section node

section node は root 直下の仮想ノードであり、workspace 上の file には対応しない。

- 並び順: `Configs`、`Profiles`
- label: `Configs` / `Profiles`
- context: `configSection` / `profileSection`
- TreeItem の `id`: `section:config` / `section:profile` の固定値(refresh を跨いで折りたたみ状態を保持する)
- collapsible: expanded
- children: 対応する kind の file node
- checkbox は表示しない
- 既定 action はない(クリックは折りたたみ切り替えのみ)

### file node

file node の label はファイル名である。TreeItem の `resourceUri` は実ファイル URI にする。

profile file:

- context: `profileFile`
- collapsible: expanded
- children: profile entries

config file:

- context: `configFile`
- collapsible: expanded
- checkbox は表示しない
- 生成対象状態は持たない
- context menu の一括操作は、配下の config entry の `excluded` だけを更新する

invalid file:

- context: `profileFileInvalid` または `configFileInvalid`
- warning icon を表示する
- description は issue code に応じて `empty file` / `invalid JSON` / `invalid shape`
- collapsible: none
- children は表示しない
- 既定 action は JSON file を開く
- Add Entry は提供しない
- Open / Copy Path / Copy Relative Path / Rename / Delete は提供する

valid file に file-level generate diagnostic がある場合:

- warning icon を表示する
- description は `1 issue` または `N issues`
- tooltip は 1 件なら diagnostic message、複数件なら issue count と最初の diagnostic message
- collapsible と children は通常の valid file と同じ

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

- 状態: included
  - context: `configEntryEnabled`
  - 表示:
    - checkbox: checked
- 状態: excluded
  - context: `configEntryDisabled`
  - 表示:
    - checkbox: unchecked
    - description: `excluded`

config entry の `excluded` 省略時は Generate 上も TreeView 上も included として扱う。

entry に generate diagnostic がある場合:

- warning icon を表示する
- description は `1 issue` または `N issues`
- excluded config entry では `excluded, N issues` のように excluded state と issue count を併記する
- tooltip は 1 件なら diagnostic message、複数件なら issue count と最初の diagnostic message
- command と checkbox は通常の entry と同じ
- descendant entry diagnostic は file node に集約表示しない

### view title actions

- action: `launch-composer.add` (`$(add)`)
- action: `launch-composer.generate` (`$(play)`)

`launch-composer.add` は QuickPick を開き、選択された項目の操作へ振り分ける。

- `Add Config`: config entry 追加
- `Add Profile`: profile entry 追加
- `Add Config File`: config file 作成
- `Add Profile File`: profile file 作成

QuickPick を選択せず閉じた場合は何もしない。振り分け先の各フローは [extension.md](./extension.md) を参照する。

### item context menu

section node:

- context menu は提供しない

profile file:

- Add Profile
- Open
- Copy Path
- Copy Relative Path
- Rename
- Delete

config file:

- Add Config
- Include All Configs
- Exclude All Configs
- Open
- Copy Path
- Copy Relative Path
- Rename
- Delete

profile/config entry:

- Open
- Copy Path
- Copy Relative Path
- Rename
- Delete

config entry では状態に応じて Include / Exclude を最上段に表示する。

inline actions:

- section node: 対応する kind の file 作成(`Configs`: `launch-composer.addConfigFile`、`Profiles`: `launch-composer.addProfileFile`。いずれも `$(add)`)
- file node: Add Entry
- entry node: Open JSON (`$(go-to-file)`)

削除は inline action では提供しない。

### checkbox 操作

TreeView は `manageCheckboxStateManually: true` で作成する。checkbox を表示するのは config entry だけである。

checkbox 操作は即座に JSONC file へ書き込む。

- config entry checkbox: entry-level `excluded` を切り替える

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

editor identity は `kind:file:index` である。同じ kind の別 entry を含め、identity が変わった場合はフォームを新しい editor として初期化し、前の entry のローカル入力と未発火の debounce 保存を破棄する。

TreeView entry を開いたとき、対応する TreeView item を `TreeView.reveal()` で選択状態にし、祖先(section node と file node)を展開する。TreeView は単一のため、選択は profile / config を横断して常に高々 1 項目である。editor から TreeView へ focus は移さない。panel を閉じた後の選択解除は実装対象外である。

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

### TextInput の外部同期

debounce 保存を行う TextInput は、ユーザー入力が pending でない場合に外部 snapshot の値へ同期する。ユーザー入力が debounce 待ちの場合、workspace update が届いてもローカル入力を維持し、最新 snapshot の entry data と revision に対して保存する。

field が disabled または read-only になった場合は、pending のローカル入力と未発火の debounce 保存を破棄し、外部 snapshot の値へ同期する。再び編集可能になっても、破棄した入力を保存しない。

Name field は rename request の成功・失敗後に最新 snapshot を再取得する。重複名による拒否や trim による正規化で外部名が変化しない場合も、request 完了時に入力欄を外部名へ戻す。

### Generate Status

Webview は editor header 直下に `Generate Status` を表示する。

- `generateReadiness.diagnostics.length === 0` の場合: `Ready to generate launch.json.` を表示する
- diagnostics が 1 件以上ある場合: Generate を block している issue count を表示する

Generate Status は workspace 全体の summary であり、現在開いている editor entry だけに絞らない。詳細な修正内容は `Entry Issues` または field-level helper に表示する。

### Entry Issues と field-level helper

Webview は current editor target に一致する generate diagnostic をフォーム内に表示する。

- field に対応する diagnostic: 該当 `FormGroup` の helper に表示する
- field に対応しない current entry の diagnostic: フォーム先頭の `Entry Issues` row に表示する
- invalid file issue: 従来の `JSON Status` を優先し、entry-level inline diagnostics は表示しない

field-level helper は diagnostic error を local helper より優先する。同じ field に diagnostic と local helper が両方ある場合、diagnostic を表示し、local helper は重複表示しない。

config 側で GUI 管理しない `configuration.type`、`configuration.request`、`configuration.program` などの blocked override は `Entry Issues` に表示し、`Edit in <sourceFile>` で JSON 編集へ誘導する。

Generate command の disabled 制御はこの仕様では扱わない。

## Profile Editor

profile editor のフォーム項目:

- 表示ラベル: `Profile: Name`
  - JSON path: `name`
  - control: `TextInput`
  - 保存方法: blur / Enter で rename request
- 表示ラベル: `Profile: Type`
  - JSON path: `configuration.type`
  - control: `TextInput`
  - 保存方法: debounce 後 patch
- 表示ラベル: `Profile: Request`
  - JSON path: `configuration.request`
  - control: `Select`
  - options: `launch`, `attach`
  - 保存方法: 即時 patch
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

profile editor は `configuration.type` と `configuration.request` をフォーム項目として表示する。`type` が空文字または空白だけの場合、または `request` が未設定か `launch` / `attach` 以外の場合、Generate に必要な field として warning helper を表示する。

保存挙動:

- `name` は patch ではなく rename request を使う
- profile rename 成功時、Extension Host は参照している config entry の `profile` も更新する
- Type は空文字でも leaf key を削除せず `configuration.type` に保存する
- Request は `launch` / `attach` の選択値だけを保存する。不正な既存値や placeholder 値は保存しない
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
- 表示ラベル: `Config: Include`
  - UI state: included
  - JSON path: `excluded`（inverse persistence）
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
- Config: Include は checked のとき included として扱い、`excluded` key を削除する。unchecked のとき excluded として扱い、`excluded: true` を書く
- Working Directory は空白だけになった場合、対応する leaf key を削除する patch を送る
- Args File は trim して保存する。空白だけになった場合は top-level `argsFile` を削除する
- Args は空配列になった場合、top-level `args` を削除する
- Browse は `showOpenDialog` を開き、ファイルが選ばれたら選択 path を `argsFile` として即時保存する

選択中 profile に `args` が定義されている場合、Args File control は disabled になり、`The selected profile already defines args.` を表示する。

## Profile Select

Config Editor の Profile select は、profile file から読み込んだ有効な profile name を列挙する。同じ profile name が複数ある場合、候補表示では重複を 1 件にまとめる。

境界ケース:

- 入力状態: `profile` が空文字、profile 候補あり
  - 表示値: `Select a profile...`
  - 状態: warning helper を表示する
- 入力状態: `profile` が string ではない、profile 候補あり
  - 表示値: `Select a profile...`
  - 状態: invalid value warning を表示する
- 入力状態: `profile` が未知文字列、profile 候補あり
  - 表示値: `<name> (missing)`
  - 状態: warning helper を表示する
  - 候補位置: 末尾
- 入力状態: profile 候補 0 件、`profile` 空または非 string
  - 表示値: `No profiles available`
  - 状態:
    - disabled
    - warning helper を表示する
- 入力状態: profile 候補 0 件、`profile` が未知文字列
  - 表示値: `<name> (missing)`
  - 状態:
    - disabled
    - warning helper を表示する

空白ラベルの option は表示しない。

## Webview 保存キュー

Webview は patch 保存要求を直列化する。前回の `update-result` を待ってから次の patch request を送る。

保存結果:

- success: Webview は `editorRevision` を更新する
- success: Webview は response の `generateReadiness` を最新状態として採用する
- conflict: Webview は `request-initial-data` で最新状態を再取得する
- rename success / failure: Webview は結果に関わらず最新状態を再取得する

Webview は VS Code webview state に最新 payload を保存し、panel が hidden になっても state を維持する。
