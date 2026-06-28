# Launch Composer - 共通仕様

このファイルは Launch Composer の共通入口である。詳細な挙動は領域別の仕様ファイルを正とし、このファイルには概要、仕様ファイルの読み分け、JSON ファイル構造、パッケージ構成だけを置く。

## 仕様ファイル

- ファイル: `spec.md`（本ファイル）
  - 主な内容: 概要、仕様ファイルの読み分け、JSON ファイル構造、構成
  - 対象パッケージ: 全体
- ファイル: [spec-core.md](./spec-core.md)
  - 主な内容: 生成、マージ、バリデーション、argsFile、変数展開
  - 対象パッケージ: `@launch-composer/core`
- ファイル: [spec-extension.md](./spec-extension.md)
  - 主な内容: VS Code 統合、workspace I/O、Generate コマンド、TreeView 操作
  - 対象パッケージ: `launch-composer`
- ファイル: [spec-ui.md](./spec-ui.md)
  - 主な内容: TreeView 表示、Webview 編集フォーム、ユーザー操作
  - 対象パッケージ: `launch-composer` + `@launch-composer/webview`
- ファイル: [spec-communication.md](./spec-communication.md)
  - 主な内容: Extension Host と Webview のメッセージ、共有データ型、保存契約
  - 対象パッケージ: `launch-composer` + `@launch-composer/webview`

データ構造の canonical source は TypeScript 型である。変更対象の実装面に対応する仕様ファイルを同時に更新し、JSON file data や shared message shape を変更する場合は [contracts](./contracts/README.md) の contract map も確認する。

## 概要

Launch Composer は、ワークスペース内の `.vscode/launch-composer/` に置かれた profile と config を読み込み、VS Code の `.vscode/launch.json` を生成する拡張機能である。

```text
.vscode/launch-composer/profiles/*.json
.vscode/launch-composer/configs/*.json
argsFile
        -> merge / validate / generate
.vscode/launch.json
```

`launch.json` はユーザーが Generate を実行したときだけ生成する。設定ファイルの変更は TreeView と Webview に反映するが、自動で `launch.json` を再生成しない。

Launch Composer は単一ワークスペースフォルダーを前提にする。ワークスペースフォルダーが 0 件または複数件の場合、コマンドは登録されるが、実行時に「exactly one workspace folder」が必要であることを通知して処理を行わない。マルチルートワークスペースのデータ解決や生成結果は仕様対象外とする。

## 入出力ディレクトリ

入力と出力のパスは固定である。

```text
<workspace-root>/
└── .vscode/
    ├── launch.json
    └── launch-composer/
        ├── profiles/
        │   └── *.json
        └── configs/
            └── *.json
```

読み込み対象は `profiles/` と `configs/` の直下にある `.json` ファイルである。`.vscode/launch-composer/`、`profiles/`、`configs/` が未作成の場合、読み取り系処理は空データとして扱う。ファイル作成や Generate など書き込みが必要な処理は、必要なディレクトリを作成してから書き込む。

## JSON ファイル構造

JSON file data と Generate 入出力の shape は `packages/core/src/types.ts` を canonical source とする。契約ごとの参照先は [contracts/json-files.md](./contracts/json-files.md) を参照する。

入力ファイルは JSONC として読む。コメントと末尾カンマを受け付ける。GUI からの編集は `jsonc-parser` ベースの部分更新で行い、関係しないコメントをできるだけ保持する。生成される `launch.json` は毎回ファイル全体を再生成するため、既存の `launch.json` の内容やコメントは保持しない。

### profiles/\*.json

profile ファイルのルートは配列である。各要素が 1 件の profile を表す。

profile エントリの拡張機能固有キー:

- key: `name`
  - 型: `string`
  - 必須性: Generate 時に非空文字列が必須
  - 説明: profile 識別子。`launch.json` へ出力しない
- key: `args`
  - 型: `string[]`
  - 必須性: 任意
  - 説明: 生成時に config の `args` と結合する

`configuration` は `launch.json` configuration のベースになるパススルーオブジェクトである。ファイル読み込み上は省略可能だが、Generate 時には各 profile の `configuration.type` が非空文字列であり、`configuration.request` が `launch` または `attach` でなければならない。GUI で profile を追加した直後は `type` が空文字で作られるため、Generate 前に JSON で有効な値へ修正する必要がある。

profile 間の継承はない。

### configs/\*.json

config ファイルのルートはオブジェクトであり、`configurations` 配列を持つ。各要素が 1 件のデバッグ構成を表す。

config ファイルの拡張機能固有キー:

- key: `enabled`
  - 型: `boolean`
  - 必須性: 任意。省略時は Generate 上有効
  - 説明: `false` の場合、ファイル内の全 config を生成対象外にする
- key: `configurations`
  - 型: `array`
  - 必須性: ファイル形状として必須
  - 説明: config エントリの配列

config エントリの拡張機能固有キー:

- key: `name`
  - 型: `string`
  - 必須性: Generate 時に非空文字列が必須
  - 説明: 生成される `launch.json` configuration の name
- key: `enabled`
  - 型: `boolean`
  - 必須性: 任意。省略時は Generate 上有効
  - 説明: `false` の場合、この config を生成対象外にする
- key: `profile`
  - 型: `string`
  - 必須性: Generate 時に非空文字列が必須
  - 説明: 参照する profile の `name`
- key: `argsFile`
  - 型: `string`
  - 必須性: 任意
  - 説明: 外部 args ファイルへの絶対パスまたは変数付きパス
- key: `args`
  - 型: `string[]`
  - 必須性: 任意
  - 説明: 生成時に profile または argsFile の args に追記

`configuration` は `launch.json` configuration に渡すパススルーオブジェクトである。ただし Generate 時、config の `configuration` に `program`、`type`、`request` がある場合はエラーにする。これらは profile 側で管理する。

`enabled` の省略は Generate 上は有効として扱う。file-level `enabled === false` の場合、そのファイル内の config は entry-level `enabled` の値に関わらず生成されない。

### argsFile

`argsFile` は config エントリから参照される外部 JSON/JSONC ファイルである。ルートはオブジェクトで、`args` に文字列配列を持つ。

`args` 以外のキーは生成に使わない。メタデータとして自由に含めてよい。`argsFile` のパス解決と結合順序は [spec-core.md](./spec-core.md) を参照する。

### 生成される launch.json

Generate が成功すると、`.vscode/launch.json` に `LaunchJson` shape の JSONC を書き込む。出力 shape の canonical source は `packages/core/src/types.ts` の `LaunchJson` / `LaunchConfig` である。

`launch.json` の生成ルール、確認ダイアログ、エラー処理は [spec-extension.md](./spec-extension.md) と [spec-core.md](./spec-core.md) を参照する。

## パッケージ構成

このリポジトリは npm workspaces による monorepo である。

```text
launch-composer/
├── package.json
├── tsconfig.base.json
├── docs/
└── packages/
    ├── core/
    ├── extension/
    └── webview/
```

### @launch-composer/core

VS Code API と Node.js のファイルシステム API に依存しない純粋な TypeScript ロジックを持つ。

- JSON file data と Generate 入出力に対応する型
- マージと args 結合
- Generate 時バリデーション
- `generate(input)` と `validateGenerateInput(input)`

### launch-composer

VS Code 拡張本体である。`@launch-composer/core` と VS Code API を接続する。

- workspace I/O
- JSONC 読み書きと部分更新
- TreeView
- Webview Panel 管理
- コマンド登録
- Generate コマンドと `launch.json` 書き込み

### @launch-composer/webview

React 19 + Vite 7 で実装する Webview UI である。ビルド成果物は extension パッケージの `dist/webview/` に取り込まれる。

- 編集フォーム
- Webview 側 RPC
- フォーム変更から `EntryPatchOperation` への変換

依存関係は次のとおりである。

```text
@launch-composer/core <- launch-composer
                              ^
                              |
                  @launch-composer/webview (build artifact)
```
