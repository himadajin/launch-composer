# Launch Composer - UI 設計仕様

`@launch-composer/webview` および `launch-composer`（extension）の Webview 管理層が実装する UI 仕様。

前提として読むべきファイル:

- [spec-communication.md](./spec-communication.md) §1 — Extension Host との通信契約・データ型定義

---

## 概要

ユーザーは VSCode のサイドバーでテンプレートと config の一覧を確認し、各アイテムをクリックしてエディタ領域のフォームで詳細を編集する。フォームへの変更は自動的に JSON ファイルに書き込まれる。編集が終わったら CONFIGS ビューヘッダーの Generate ボタンで `.vscode/launch.json` を生成する。

UI は2つの独立したコンポーネントで構成される:

- **サイドバー（一覧パネル）**: VSCode TreeView API で実装。テンプレートと config の一覧表示・追加・名前変更・削除・有効無効の切り替え・JSON ファイルを開く/パスをコピーするといった基本操作を行う。config では file 単位と entry 単位の両方の有効状態を扱う。
- **エディタパネル（編集フォーム）**: React 19 + `@himadajin/vscode-components` で実装した Webview Panel。選択したアイテムのフィールドをフォームで編集する。GUI で扱わないフィールドは、フォーム最下部の `Edit in <sourceFile>` 導線から対応する JSON ファイルを直接開いて編集する。

JSON ファイルが一時的に不正な場合も、UI は別種の専用画面へ切り替えない。VSCode Settings UI と同様に、通常の編集レイアウトを維持したまま、問題の説明と read-only 状態で表現する。

---

## 1. UI 設計

技術スタック・全体構成・各コンポーネントの詳細仕様を以下のサブセクションで定める。

### 1.1 技術スタック

Extension Host と Webview のいずれも TypeScript で実装する。

| レイヤー                      | 技術                                             | 備考                                                    |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| サイドバー一覧                | VSCode TreeView API                              | VSCode ネイティブの API を使用し、Webview は使わない    |
| エディタ編集画面              | React 19 + @himadajin/vscode-components + Vite 8 | Webview Panel 上のフォーム UI。テーマ変更に自動対応する |
| Extension Host ↔ Webview 通信 | VSCode postMessage API                           | VSCode が提供する標準の通信手段                         |

ライブラリ:

- `@himadajin/vscode-components`: React 19 ベースの VSCode デザイン準拠コンポーネント集。VSCode 設定画面と同様の UI 要素を React コンポーネントとして提供する。スタイルは `@himadajin/vscode-components/styles.css` でインポートする。

Vite 8 から Vite+ への移行が将来必要になった場合は、`vp migrate` コマンドで移行できる。

### 1.2 全体構成: ハイブリッド方式

Launch Composer の UI は以下の2つのコンポーネントで構成する。

| コンポーネント | 配置                          | 技術                                    | 役割                                            |
| -------------- | ----------------------------- | --------------------------------------- | ----------------------------------------------- |
| 一覧パネル     | サイドバー                    | VSCode TreeView API                     | テンプレート・config 一覧、操作エントリポイント |
| 編集パネル     | エディタ領域（Webview Panel） | React 19 + @himadajin/vscode-components | 選択アイテムの詳細編集フォーム                  |

### 1.3 サイドバー（一覧パネル）: TreeView API

サイドバーパネルに **TEMPLATES** と **CONFIGS** の2つの独立した TreeView を配置する。各 TreeView はそれぞれ折りたたみ・展開できる（VSCode の標準ビュー機能）。

```
┌─ TEMPLATES ──────────────────────── [+] ─┐
│  $(file-code) cpp.json          [+]       │
│    cpp                                    │
│  $(file-code) scripting.json    [+]       │
│    python-debug                           │
└───────────────────────────────────────────┘

┌─ CONFIGS ──────────────── [+] [$(play)] ─┐
│  $(file-code) basic-test.json   [+]       │
│    [x] Basic Test                         │
│    [ ] Input Test                         │
│  $(file-code) input-test.json   [+]       │
│    [ ] Replay Test                        │
└───────────────────────────────────────────┘
```

ビューヘッダーのツールバーアクション:

- **TEMPLATES ビュー**: `[+]`（`$(add)` アイコン）— テンプレートファイルを新規作成
- **CONFIGS ビュー**: `[+]`（`$(add)` アイコン）— config ファイルを新規作成、`[$(play)]` — launch.json を生成

アイテムの見た目:

- **ファイルアイテム**: VSCode Explorer のファイル行に近い見た目にする。ラベルはファイル名を拡張子付きで表示する（例: `cpp.json`）。
- **invalid なファイルアイテム**: warning アイコンを表示し、description に `empty file` / `invalid JSON` / `invalid shape` のいずれかを表示する。子エントリは表示しない。
- **config ファイルアイテム（enabled）**: 左端に checkbox を表示する。checked 状態が file-level enabled を表す。
- **config ファイルアイテム（disabled）**: 左端に unchecked の checkbox を表示する。description 欄に `disabled` と表示する。
- **テンプレートエントリ**: アイコンなし。ラベルのみ表示する。
- **config エントリ（enabled）**: 左端に checkbox を表示する。checked 状態が entry-level enabled を表す。
- **config エントリ（disabled）**: 左端に unchecked の checkbox を表示する。description 欄に `disabled` と表示する。追加の状態アイコンは表示しない。
- **config エントリ（disabled by file）**: checkbox を表示せず、左端に共通の disabled アイコンを表示する。description 欄に `disabled by file` と表示する。これは config 自体の `enabled` が `false` ではなく、親 file の `enabled` が `false` であることを示す。

インラインアクション（ホバー時のみ表示）:

- **ファイルアイテム**: `$(add)` ボタン — エントリを追加する。
- **テンプレートエントリ・config エントリ（全種別）**: `$(go-to-file)` ボタン — 対応する JSON を 1 クリックで開く。

インラインアクションは VSCode の標準動作に従いホバー時のみ表示する。config の有効/無効状態は checkbox・description・disabled by file 専用アイコンで示す。file-level disabled 配下の entry は読み取り専用表示とし、checkbox を出さない。

右クリックメニューは VSCode Explorer に近い最小構成にする。項目の追加・削除・名前変更・Open・Copy Path・Copy Relative Path を提供し、config ファイルおよび config エントリでは `Enable` / `Disable` を最上段に置く。`disabled by file` の config エントリには `Enable` / `Disable` を表示しない。削除はインラインアクションでは提供しない。

invalid なファイルアイテムでは Add Entry を表示しない。Open / Copy Path / Copy Relative Path / Rename / Delete は通常ファイルと同様に提供する。invalid file の既定アクションは JSON ファイルを開くこととする。

空の状態:

- TEMPLATES ビューにファイルが存在しない場合、`welcomeContent` でガイダンスを表示する: `No template files found. [Create Template File]`
- CONFIGS ビューにファイルが存在しない場合、`welcomeContent` でガイダンスを表示する: `No config files found. [Create Config File]`
- `welcomeContent` 内のリンクは対応するファイル作成コマンドを実行する。
- `.vscode/launch-composer/` やその子ディレクトリが未作成の場合も同じ空状態として扱い、初期化不足を示すエラーや警告は表示しない。

操作:

| 操作                               | トリガー                                                                        | 動作                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| テンプレートファイル新規作成       | TEMPLATES ビューヘッダーの `$(add)`                                             | InputBox でファイル名入力 → 空配列 `[]` の JSON ファイルを作成                                                                                                                                                                                                                                                                                                                                                                                               |
| テンプレートファイルを開く         | ファイルアイテムを右クリック → "Open"                                           | 対応する JSON ファイルを VSCode エディタで開く                                                                                                                                                                                                                                                                                                                                                                                                               |
| テンプレートファイルのパスをコピー | ファイルアイテムを右クリック → "Copy Path" / "Copy Relative Path"               | 絶対パスまたはワークスペース相対パスをクリップボードにコピー                                                                                                                                                                                                                                                                                                                                                                                                 |
| テンプレートファイル名変更         | ファイルアイテムを右クリック → "Rename"                                         | InputBox でファイル名を変更                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| テンプレートファイル削除           | ファイルアイテムを右クリック → "Delete"                                         | 確認ダイアログ → ファイル削除                                                                                                                                                                                                                                                                                                                                                                                                                                |
| テンプレートエントリ追加           | ファイルアイテムの `$(add)` インラインアクション（ホバー時）                    | InputBox でテンプレート名を入力（空文字は拒否） → JSON に `name`, `type: ""`, `request: "launch"` を含む最小構成のエントリを書き込む → エディタパネルを開く                                                                                                                                                                                                                                                                                                  |
| テンプレートエントリを開く         | テンプレートアイテムをクリック、またはテンプレートアイテムを右クリック → "Open" | 対応する JSON ファイルを VSCode エディタで開き、対象エントリの配列要素位置にカーソルを移動・選択状態にする                                                                                                                                                                                                                                                                                                                                                   |
| テンプレートエントリのパスをコピー | テンプレートアイテムを右クリック → "Copy Path" / "Copy Relative Path"           | 対応する JSON ファイルの絶対パスまたはワークスペース相対パスをクリップボードにコピー                                                                                                                                                                                                                                                                                                                                                                         |
| テンプレートエントリ名変更         | テンプレートアイテムを右クリック → "Rename"                                     | InputBox で `name` を変更する                                                                                                                                                                                                                                                                                                                                                                                                                                |
| テンプレートエントリ削除           | テンプレートアイテムを右クリック → "Delete"                                     | 確認ダイアログ → 配列から要素を削除してファイルに書き戻す。そのテンプレートを参照する config エントリが存在する場合は削除を拒否しエラーを通知する                                                                                                                                                                                                                                                                                                            |
| テンプレートエントリ編集           | テンプレートアイテムをクリック                                                  | エディタパネルで編集画面を開く                                                                                                                                                                                                                                                                                                                                                                                                                               |
| テンプレートエントリの JSON を開く | テンプレートアイテムの `$(go-to-file)` インラインアクション（ホバー時）         | 対応する JSON ファイルを VSCode エディタで開き、対象エントリの配列要素位置にカーソルを移動・選択状態にする                                                                                                                                                                                                                                                                                                                                                   |
| config ファイル新規作成            | CONFIGS ビューヘッダーの `$(add)`                                               | InputBox でファイル名入力 → `enabled: true` と空の `configurations` 配列を持つ JSON ファイルを作成                                                                                                                                                                                                                                                                                                                                                           |
| config ファイルを開く              | ファイルアイテムを右クリック → "Open"                                           | 対応する JSON ファイルを VSCode エディタで開く                                                                                                                                                                                                                                                                                                                                                                                                               |
| config ファイルのパスをコピー      | ファイルアイテムを右クリック → "Copy Path" / "Copy Relative Path"               | 絶対パスまたはワークスペース相対パスをクリップボードにコピー                                                                                                                                                                                                                                                                                                                                                                                                 |
| config ファイル名変更              | ファイルアイテムを右クリック → "Rename"                                         | InputBox でファイル名を変更                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| config ファイル削除                | ファイルアイテムを右クリック → "Delete"                                         | 確認ダイアログ → ファイル削除                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 構成エントリ追加                   | ファイルアイテムの `$(add)` インラインアクション（ホバー時）                    | QuickPick でテンプレートを選択する。利用可能なテンプレート名を先に並べ、テンプレートが1件以上ある場合は separator を挟んで末尾に `No template` を表示する。`No template` 選択時は standalone config を作成する → InputBox で name 入力（空文字は拒否） → `configurations` 配列に最小構成のエントリを書き込む。`extends` ありなら `enabled: true` と `extends` を含み、`extends` なしならさらに `type: ""`, `request: "launch"` を含む → エディタパネルを開く |
| config ファイルの有効/無効切替     | config ファイルを右クリック → "Enable" / "Disable"                              | 即座にファイルに書き込み、file-level enabled を切り替える                                                                                                                                                                                                                                                                                                                                                                                                    |
| 構成エントリの有効/無効切替        | 構成アイテムを右クリック → "Enable" / "Disable"                                 | 即座にファイルに書き込み、状態を切り替える。右クリックメニュー内では最上段に表示する                                                                                                                                                                                                                                                                                                                                                                         |
| 構成エントリを開く                 | 構成アイテムをクリック、または構成アイテムを右クリック → "Open"                 | 対応する JSON ファイルを VSCode エディタで開き、対象エントリの配列要素位置にカーソルを移動・選択状態にする                                                                                                                                                                                                                                                                                                                                                   |
| 構成エントリのパスをコピー         | 構成アイテムを右クリック → "Copy Path" / "Copy Relative Path"                   | 対応する JSON ファイルの絶対パスまたはワークスペース相対パスをクリップボードにコピー                                                                                                                                                                                                                                                                                                                                                                         |
| 構成エントリ名変更                 | 構成アイテムを右クリック → "Rename"                                             | InputBox で `name` を変更する                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 構成エントリ削除                   | 構成アイテムを右クリック → "Delete"                                             | 確認ダイアログ → `configurations` 配列から要素を削除してファイルに書き戻す                                                                                                                                                                                                                                                                                                                                                                                   |
| 構成エントリ編集                   | 構成アイテムをクリック                                                          | エディタパネルで編集画面を開く                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 構成エントリの JSON を開く         | 構成アイテムの `$(go-to-file)` インラインアクション（ホバー時）                 | 対応する JSON ファイルを VSCode エディタで開き、対象エントリの配列要素位置にカーソルを移動・選択状態にする                                                                                                                                                                                                                                                                                                                                                   |
| enabled トグル                     | config ファイルまたは構成アイテムの checkbox                                    | 即座にファイルに書き込み、対象の enabled を切り替える。`disabled by file` の構成アイテムには checkbox を表示しない                                                                                                                                                                                                                                                                                                                                           |
| Generate                           | CONFIGS ビューヘッダーの `$(play)`                                              | launch.json を生成                                                                                                                                                                                                                                                                                                                                                                                                                                           |

ファイル名に使える文字は、VSCode がサポートする各 OS（Linux・Windows・macOS）で有効なファイル名であれば受理する。拡張機能側で独自の追加制限は設けない。

### 1.4 エディタパネル（編集フォーム）: React 19 + @himadajin/vscode-components

エディタパネルは、サイドバーで選択したアイテムの詳細フィールドを編集するためのフォームを Webview Panel として表示する。使用する主要コンポーネント:

- フォームレイアウト: `<FormContainer>`, `<FormGroup>`（label・description を内包）
- 入力: `<TextInput>`, `<Checkbox>`, `<Select>`
- リスト編集（args）: `<ListEditor>`（追加・削除・ドラッグ並び替え対応）
- 操作: `<Button>`（`variant='secondary'`）

エディタパネルの見出しは、VS Code の editor tab と Webview 内ヘッダで役割を分ける。

- VS Code の editor tab には現在編集中の項目名だけを表示する。`Template` / `Config` の種別名や `Edit` のような操作名は表示しない。
- tab title は panel を開いた時、rename 成功後、workspace 同期で対象名が変わった時に再計算する。
- tab title の対象名を解決できない場合、または対象ファイルが invalid な場合は `basename(sourceFile)` を表示する。
- Webview 内ヘッダは 3 行構成とする。1 行目は種別名、2 行目は項目名、3 行目は `sourceFile` とする。

#### テンプレート編集

GUI で編集できるフィールドは以下に限定する。それ以外のプロパティ（`env` 等）を変更する場合は、フォーム最下部の `Edit in <sourceFile>` 導線から JSON ファイルを直接編集する。

| フィールド        | JSON キー                  | UI コンポーネント | 備考                                                                                                     |
| ----------------- | -------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Name              | `name`（拡張機能固有キー） | `<TextInput>`     | blur または Enter 確定時に rename 要求を送る。template を参照する config の `extends` は同時に更新される |
| Type              | `type`                     | `<TextInput>`     | 空欄もそのまま文字列として保持する                                                                       |
| Request           | `request`                  | `<Select>`        | 選択肢は `launch` と `attach` のみ。変更時に即座に書き込む                                               |
| Program           | `program`                  | `<TextInput>`     | 空欄時はキーを JSON から削除                                                                             |
| Working Directory | `cwd`                      | `<TextInput>`     | 空欄時はキーを JSON から削除                                                                             |
| Stop At Entry     | `stopAtEntry`              | `<Checkbox>`      | 常に `true` / `false` を明示的に書き込む                                                                 |
| Args              | `args`                     | `<ListEditor>`    | 空リスト時はキーを JSON から削除                                                                         |

フォーム最下部に、unsupported な `launch.json` プロパティを JSON で編集するための補助導線を常時表示する。表示内容は説明文と `Edit in <sourceFile>` リンクで構成し、クリック時は対応する source file 全体を VSCode エディタで開く。エントリ位置へのジャンプは行わない。

保存の動作: フォームの変更はエントリ単位で JSON に反映する。`name` は専用の rename 要求で保存し、それ以外の GUI 編集項目はパーシャル更新として保存する。JSON ファイルに存在するその他のキー（`env` 等）は保持する。

- `Name` は blur または Enter 確定時に rename 要求を送る。自動保存の debounce は使用しない。
- `Type` / `Program` / `Working Directory` の `<TextInput>` は `launch-composer.autoSaveDelay`（デフォルト 1000ms）の debounce を挟んでから差分を書き込む。
- `Request` の `<Select>` は変更と同時に即座に書き込む（debounce なし）。
- `<Checkbox>` は変更と同時に即座に書き込む（debounce なし）。
- `<ListEditor>`（args）は要素の追加・削除・並び替えの各操作完了時に即座に書き込む（debounce なし）。
- **debounce はユーザーが TextInput を編集した場合にのみ発火する。エディタを開いた時点（初期表示）では発火しない。** これは VS Code の設定エディタが採用する原則と同様である: 「値をセットしてからハンドラを登録する」＝プログラム的な値の更新はファイル書き込みをトリガーしない。
- `configuration` 内のすべての省略可能フィールドが削除された結果 `configuration` が空になった場合、`configuration` キー自体を JSON から削除する。
- Webview は差分更新用に最新の `editorRevision` を保持し、各差分保存要求に `baseRevision` を添えて送信する。
- 差分保存要求は Webview 内で直列化し、前回保存の応答を待ってから次の保存を送る。
- rename 要求の成功・失敗後、および差分保存で conflict が返った場合は最新の `initial-data` を再取得し、直接編集されたファイル内容を優先して UI を更新する。

対象ファイルが invalid な場合:

- 通常のテンプレート編集レイアウトを維持し、フォーム先頭に `JSON Status` の行を表示する。
- `JSON Status` には issue の `message` を description として表示し、詳細がある場合は helper に表示する。
- すべての編集可能な control は disabled または read-only にする。
- `ListEditor` のように disabled を持たない部品は、編集不可のテキスト表示に置き換える。
- `JSON Status` 内の `Edit in <sourceFile>` リンクは対象ファイル自体を開く。
- ファイルが正常化したら、自動同期で通常の編集状態に戻る。

VS Code の tab title: `cpp`

```
┌─ cpp ─────────────────────────────────────────┐
│                                                │
│  Template                                      │
│  cpp                                           │
│  cpp.json                                      │
│                                                │
│  Name:              cpp ⚙                      │
│  Type:              [cppdbg                  ] │
│  Request:           [launch                  ] │
│  Program:           [${workspaceFolder}/...  ] │
│  Working Directory: [                        ] │
│  Stop At Entry:     [ ]                        │
│  Args:      [--verbose] [×]                   │
│             [+ Add arg]                        │
│                                                │
│  Edit in cpp.json                              │
└────────────────────────────────────────────────┘
```

#### config 編集

GUI で編集できるフィールドは以下に限定する。それ以外のプロパティ（`program`, `env` 等）を変更する場合は、フォーム最下部の `Edit in <sourceFile>` 導線から JSON ファイルを直接編集する。

| フィールド        | JSON キー                  | UI コンポーネント             | 備考                                                                                                                                                                                                                                        |
| ----------------- | -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name              | `name`（拡張機能固有キー） | `<TextInput>`                 | blur または Enter 確定時に rename 要求を送る                                                                                                                                                                                                |
| Extends           | `extends`                  | `<Select>`                    | 利用可能なテンプレート名を先に並べ、末尾に `No template` を表示する。`No template` 選択時は `extends` キーを JSON から削除する。参照先テンプレートが削除されて存在しない場合は現在の値をそのまま表示し、Generate 時バリデーションで検出する |
| Enabled           | `enabled`                  | `<Checkbox>`                  | 常に `true` / `false` を明示的に書き込む。新規追加時の初期値は `true`                                                                                                                                                                       |
| Type              | `type`                     | `<TextInput>`                 | `extends` なしのときだけ編集可能。`extends` ありのときは参照先テンプレートの値を表示し、config 側には書き込まない                                                                                                                           |
| Request           | `request`                  | `<Select>`                    | `extends` なしのときだけ編集可能。選択肢は `launch` と `attach` のみ。`extends` ありのときは参照先テンプレートの値を表示し、config 側には書き込まない                                                                                       |
| Working Directory | `cwd`                      | `<TextInput>`                 | 空欄時はキーを JSON から削除                                                                                                                                                                                                                |
| Stop At Entry     | `stopAtEntry`              | `<Checkbox>`                  | 常に `true` / `false` を明示的に書き込む                                                                                                                                                                                                    |
| Args File         | `argsFile`                 | `<TextInput>` + Browse ボタン | 空欄時はキーを JSON から削除。選択中テンプレートに `args` が定義されている場合は disabled にし、"Template has args defined" と表示する                                                                                                      |
| Args              | `args`                     | `<ListEditor>`                | 空リスト時はキーを JSON から削除                                                                                                                                                                                                            |

`extends` を設定した場合、フォームは `type` と `request` をテンプレート継承値として表示する。config に残っていた `type` / `request` は削除し、以後はテンプレート側のみを編集対象とする。`No template` に戻した場合は config 側の `type` を空文字 `""`、`request` を `"launch"` に設定し、standalone config として編集できる状態に戻す。

保存の動作: フォームの変更はエントリ単位で JSON に反映する。`name` は専用の rename 要求で保存し、それ以外の GUI 編集項目はパーシャル更新として保存する。JSON ファイルに存在するその他のキー（`program`, `env` 等）および file-level `enabled` は保持する。

- `Name` は blur または Enter 確定時に rename 要求を送る。自動保存の debounce は使用しない。
- `<TextInput>` フィールド（Type, Working Directory, Args File）は `launch-composer.autoSaveDelay`（デフォルト 1000ms）の debounce を挟んでから差分を書き込む。
- `<Checkbox>`（enabled, stopAtEntry）・`<Select>`（extends, request）は変更と同時に即座に書き込む（debounce なし）。
- `<ListEditor>`（args）は要素の追加・削除・並び替えの各操作完了時に即座に書き込む（debounce なし）。
- **debounce はユーザーが TextInput を編集した場合にのみ発火する。エディタを開いた時点（初期表示）では発火しない。** これは VS Code の設定エディタが採用する原則と同様である: 「値をセットしてからハンドラを登録する」＝プログラム的な値の更新はファイル書き込みをトリガーしない。
- `configuration` 内のすべての省略可能フィールドが削除された結果 `configuration` が空になった場合、`configuration` キー自体を JSON から削除する。
- Webview は差分更新用に最新の `editorRevision` を保持し、各差分保存要求に `baseRevision` を添えて送信する。
- 差分保存要求は Webview 内で直列化し、前回保存の応答を待ってから次の保存を送る。
- rename 要求の成功・失敗後、および差分保存で conflict が返った場合は最新の `initial-data` を再取得し、直接編集されたファイル内容を優先して UI を更新する。

フォーム最下部の `Edit in <sourceFile>` 導線の挙動はテンプレート編集と同様とする。対応する JSON ファイル全体を開き、エントリ位置へのジャンプは行わない。

config 編集フォームは file-level `enabled` を直接編集しない。親 file の `enabled` が `false` の場合、`Enabled` 行に informational helper を表示し、その config が現在は生成対象外であることを示す。

対象ファイルが invalid な場合の表示原則はテンプレート編集と同じとする。通常の config 編集レイアウトを維持し、`JSON Status` を表示し、すべての編集操作を無効化する。`JSON Status` 内の `Edit in <sourceFile>` リンクは対象ファイル自体を開く。

VS Code の tab title: `Basic Test`

```
┌─ Basic Test ──────────────────────────────────┐
│                                                │
│  Config                                        │
│  Basic Test                                    │
│  basic-test.json                               │
│                                                │
│  Name:              Basic Test ⚙               │
│  Extends:           [cpp ▼]                    │
│  Enabled:           [✓]                        │
│  Type:              [cppdbg                  ] │
│  Request:           [launch                  ] │
│                                                │
│  Working Directory: [                        ] │
│  Stop At Entry:     [ ]                        │
│                                                │
│  ── Args ────────────────────────────────────  │
│  Args File: [/path/to/args.json     ] [...]    │
│  Args:      [--debug-mode] [×]  [-v] [×]      │
│             [+ Add arg]                        │
│                                                │
│  Edit in basic-test.json                       │
└────────────────────────────────────────────────┘
```

### 1.5 フォーム要素の編集方法

フィールドの種類と使用する UI コンポーネントの対応を以下に示す。

| フィールド                                      | コンポーネント                                 |
| ----------------------------------------------- | ---------------------------------------------- |
| テキスト入力（type, program, cwd, argsFile 等） | `<TextInput>`                                  |
| 列挙選択（request, extends）                    | `<Select>`                                     |
| boolean（enabled, stopAtEntry）                 | `<Checkbox>`                                   |
| 文字列リスト（args）                            | `<ListEditor>`（追加・削除・ドラッグ並び替え） |

### 1.6 エディタパネルの枚数とタブ管理

エディタパネルは**単一パネル方式**とする。サイドバーのアイテムをクリックするたびに同じ Webview Panel の内容が切り替わる。パネルは常に最大1枚。複数の編集画面を同時に開く手段は提供しない。

これは VSCode の Settings エディタ（`workbench.action.openSettings`）と同じパターンであり、「一覧から選んで詳細を編集する」UIの標準的な実装に従う。

### 1.7 サイドバーの選択状態

エディタパネルで編集中のアイテムに対応するサイドバーのツリーアイテムをハイライト（選択状態）にする。`TreeView.reveal()` を使用して実装する。

エディタパネルを閉じたとき、またはパネルが存在しないときは選択状態を解除する。

### 1.8 ファイル変更の自動検知とツリー更新

`vscode.workspace.createFileSystemWatcher` と `workspace.onDidChangeTextDocument` / `workspace.onDidSaveTextDocument` で `.vscode/launch-composer/templates/` および `.vscode/launch-composer/configs/` 以下のファイル変更を反映し、サイドバーのツリーと編集パネルの内容を自動更新する。

編集中ファイルの途中変更でも UI は最新テキストを取り込み続けるが、issue 通知は保存時に評価する。これにより、直接編集の途中入力で通知が連続することを避ける。

本実装は、VSCode の拡張機能が外部変更を反映する標準的なパターンに従う。
