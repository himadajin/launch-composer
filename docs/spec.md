# Launch Composer - VSCode Extension 設計仕様書

## 仕様ファイル一覧

| ファイル                                         | 内容                                                             | 対象パッケージ                                 |
| ------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| spec.md（本ファイル）                            | 概要・実装方針・ディレクトリ構成・スキーマ定義・プロジェクト構成 | 全員が読む共通基盤                             |
| [spec-core.md](./spec-core.md)                   | マージルール・パス解決・バリデーション                           | `@launch-composer/core`                        |
| [spec-communication.md](./spec-communication.md) | Extension Host ↔ Webview 通信契約・型定義                        | `launch-composer` + `@launch-composer/webview` |
| [spec-extension.md](./spec-extension.md)         | launch.json 生成動作・ファイル監視・コマンド登録・設定項目       | `launch-composer`（Extension Host）            |
| [spec-ui.md](./spec-ui.md)                       | UI 設計（サイドバー・編集フォーム）                              | `@launch-composer/webview`                     |

---

## 1. 概要

プロジェクトの `.vscode/launch-composer/` ディレクトリに配置した設定ファイル（テンプレート + 個別構成）から `.vscode/launch.json` を自動生成する VSCode 拡張機能である。

- 拡張機能名: Launch Composer
- Extension ID: `launch-composer`

データフロー:

```
templates/*.json + configs/*.json + argsFile（外部ファイル）
        ↓ マージ・変数展開
  .vscode/launch.json
```

launch.json の生成はユーザーが GUI のボタンを押した時のみ行い、自動では生成しない。

---

## 2. 実装方針

- 動作が予測可能であることを最優先とする。ユーザーが設定ファイルに書いた内容がそのまま launch.json に反映される単純な対応関係を維持する。暗黙的な変換や条件分岐を増やさない。
- 機能は必要最小限に絞る。実装コストに見合わない機能、使用頻度の低い機能は入れない。後から追加できるものは後から追加する。
- VSCode の既存の UI パターンと API に従う。独自の UI 規約を作らず、TreeView API、Codicon、テーマカラー等の標準要素をそのまま使う。
- JSON ファイルはユーザーが直接編集する前提で扱う。入力が一時的に不正でも全体を停止させず、問題は file 単位で扱う。
- GUI 保存はファイル全体の再生成ではなく、編集中エントリ単位の更新として扱う。`name` 以外は差分反映、`name` は専用 rename 処理とし、保存前に必要な整合性確認を行う。GUI 編集と直接編集が競合した場合はファイル側を優先する。
- 設定や挙動のカスタマイズ項目を増やさない。選択肢が増えるとコードパスが分岐し、テストとメンテナンスのコストが増える。

---

## 3. ディレクトリ構成

ユーザーがプロジェクトに追加する設定ファイルは以下の通りである。

```
<project-root>/
└── .vscode/
    ├── launch.json                  ← 生成先（出力）
    └── launch-composer/             ← 設定ディレクトリ（入力）
        ├── templates/
        │   ├── template.json        ← initialize が不足時に作る雛形
        │   ├── cpp.json
        │   └── scripting.json
        └── configs/
            ├── config.json          ← initialize が不足時に作る雛形
            ├── basic-test.json
            └── input-test.json
```

設定ディレクトリのパスは `.vscode/launch-composer` に固定し、ユーザーが変更する手段は提供しない。

マルチルートワークスペースへの対応はスコープ外とする。マルチルートワークスペースで使用しようとした場合の挙動は未定。

---

## 4. スキーマ定義

### 4.1 templates/\*.json

各ファイルのルートはテンプレートオブジェクトの配列とする。1ファイルに複数のテンプレートを含められる。各テンプレートは `launch.json` の configuration のベースとなる。

```jsonc
[
  {
    // --- 拡張機能固有キー ---
    "name": "cpp", // 必須。識別子。launch.jsonには出力しない。
    "args": [], // 省略可。launch.json の args に出力する。

    // --- launch.json エントリの内容（省略可）---
    "configuration": {
      // パススルーキー（launch.json の任意プロパティ）
      "type": "cppdbg",
      "request": "launch",
      "program": "${workspaceFolder}/build/myapp",
      "MIMode": "gdb",
      "env": { "PATH": "/usr/bin" },
      // ...その他 launch.json の標準プロパティ
    },
  },
]
```

制約:

- `name` は必須とする。`templates/` ディレクトリ以下の全ファイルにわたって一意でなければならない。
- GUI から `name` を変更する場合、テンプレート名の変更はそれを参照する config の `extends` を同時に更新する。
- `args` は省略可能。値は文字列の配列でなければならない。
- `configuration.request` は必須とする。値は `launch` または `attach` のいずれかでなければならない。
- `configuration` オブジェクトは省略可能だが、存在する場合はオブジェクトでなければならない。
- テンプレートに `args` が定義されている場合、そのテンプレートを `extends` する config エントリで `argsFile` を指定してはならない。指定されていた場合は Generate 時エラーとする（spec-core.md §3.1 参照）。
- テンプレート間の継承（template extends template）は実装しない。将来も追加しない。

テンプレートエントリのキーは次の 2 種類に分けられる:

- **拡張機能固有キー**: `name`、`args`。生成時に launch.json にはパススルーしない（`args` は spec-core.md §1.3 のルールで処理して出力する）。
- **`configuration` オブジェクト**: launch.json エントリの内容をすべてパススルーキーとして格納する。launch.json にそのまま出力される（config の `configuration` で上書きされない限り）。

### 4.2 configs/\*.json

各ファイルのルートは config ファイルオブジェクトとする。`configurations` 配列の各要素が 1 件のデバッグ構成を表す。1 ファイルに複数の構成を含められる。

```jsonc
{
  "enabled": true, // 省略時 true。false の場合、このファイル内の全構成は生成対象外。
  "configurations": [
    {
      // --- 拡張機能固有キー ---
      "name": "Basic Test", // 必須。launch.json の name になる。
      "extends": "cpp", // 省略可。templates の name を参照。省略時はテンプレートとのマージを行わない。
      "enabled": true, // 省略時 true。file.enabled とこの値の両方が false でない場合のみ launch.json に出力。
      "argsFile": "/absolute/path/to/args.json", // 省略可。
      "args": ["--debug-mode"], // 省略可。

      // --- launch.json エントリの内容（省略可）---
      "configuration": {
        // パススルーキー（テンプレートをオーバーライド）
        "type": "cppdbg", // extends を使わない場合のみこの config 自身で指定する。
        "request": "launch", // extends を使わない場合のみこの config 自身で指定する。
        "env": { "DEBUG": "1" },
        "cwd": "${workspaceFolder}/test",
      },
    },
  ],
}
```

`enabled` の評価は file 単位と config 単位で独立して行う。`file.enabled === false` の場合、そのファイル内の config は各 config の `enabled` の値に関係なくすべて無効とする。`enabled` を省略した場合は file・config のどちらも `true` として扱う。

config エントリのキーは次の 2 種類に分けられる:

- **拡張機能固有キー**: `name`、`extends`、`enabled`、`argsFile`、`args`。launch.json にはパススルーしない（`args` は argsFile との合成結果を launch.json に出力する）。
- **`configuration` オブジェクト**: launch.json エントリの内容をすべてパススルーキーとして格納する。launch.json にそのまま出力される。

`extends` を使う config では、`type` と `request` は参照先テンプレートで管理する。`extends` を使わない config では、`configuration` オブジェクト自身が `type` と `request` を持つ。`request` は `launch` または `attach` のいずれかでなければならない。

GUI から `name` を変更する場合、config の `name` はそのエントリ自身だけを更新する。template の `name` はそれを参照する config の `extends` を同時に更新する。

### 4.3 argsFile（外部ファイル）

デバッグ対象のバイナリに渡す引数を格納するための外部ファイル。
このファイルはプロジェクト外に配置してもよい。
外部のツールが実行ログ等から引数の一覧等を自動生成することを想定している。

```jsonc
{
  "args": ["-v", "-o", "output.txt", "input.txt"],
  "generatedAt": "2026-03-16T10:30:00Z",
  "source": "replay-tool v1.2",
}
```

制約:

- 形式は JSON/JSONC とする。文字コードは UTF-8 であることを前提とする。
- ファイルのルートは JSON オブジェクトでなければならない。配列やプリミティブ値は不正とみなしエラーにする。
- ルートオブジェクトに `args` キーが必須であり、その値は文字列の配列でなければならない。
- `args` 以外のキーはすべて無視する。メタデータ等を自由に含めてよい。

### 4.4 生成される launch.json

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Basic Test",
      "type": "cppdbg",
      "request": "launch",
      "program": "${workspaceFolder}/build/myapp",
      "MIMode": "gdb",
      "args": ["-v", "-o", "output.txt", "input.txt", "--debug-mode"],
      "env": { "DEBUG": "1" },
      "cwd": "${workspaceFolder}/test",
    },
  ],
}
```

※ env は config で指定したため、template の env（`"PATH": "/usr/bin"`）は継承されず、config の env で丸ごと置換される（shallow merge）。

`type` と `request` は生成結果で常に出力する。`request` は常に `launch` または `attach` のいずれかでなければならない。

---

## 5. プロジェクト構成

### 5.1 方針

npm workspaces による monorepo 構成とする。設定ファイルのマージ・バリデーション・生成ロジックを `@launch-composer/core` パッケージに切り出し、VSCode 非依存の純粋な関数として実装する。これにより、VSCode API を一切モックせずにコアロジックのユニットテストを書ける。

### 5.2 パッケージ構成

```
launch-composer/
├── packages/
│   ├── core/              # @launch-composer/core
│   ├── extension/         # launch-composer (VSCode 拡張本体)
│   └── webview/           # @launch-composer/webview
├── package.json           # workspaces 定義
└── tsconfig.base.json
```

#### `@launch-composer/core`

設定ファイルの入力から launch.json 内容の出力までの純粋なロジックを実装する。VSCode・Node.js に依存しない。

- スキーマ型定義（`TemplateEntry`, `ConfigEntry`, `ArgsFile`, `LaunchConfig` 等）
- マージロジック（spec-core.md §1）
- バリデーション（spec-core.md §3）
- `generate(templates, configs, variables)` — メインの生成関数

変数解決（`${workspaceFolder}` 等）は呼び出し側から `variables: Record<string, string>` を渡す形とし、コアは文字列置換のみを行う。

#### `launch-composer`（extension）

VSCode API との統合を担う。`@launch-composer/core` と VSCode API を接続する。

- ファイル I/O（templates/configs の読み込み、launch.json の書き出し）
- TreeView プロバイダー、Webview Panel 管理、コマンド登録
- `FileSystemWatcher` によるファイル監視
- ビルドには esbuild を使用する。`@launch-composer/webview` のビルド成果物を取り込む

#### `@launch-composer/webview`

React 19 + Vite 8 で実装する編集フォーム UI を提供する。ビルド成果物を extension パッケージが取り込む。

### 5.3 パッケージ間の依存関係

```
@launch-composer/core  ←── launch-composer (extension)
                                    ↑
                        @launch-composer/webview (ビルド成果物)
```

### 5.4 ディレクトリ構成

```
launch-composer/
├── package.json                    ← workspaces 定義
├── tsconfig.base.json
├── .vscode/
│   ├── launch.json                 ← デバッグ起動設定
│   └── tasks.json                  ← ビルドタスク
└── packages/
    ├── core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── types.ts            ← TemplateEntry, ConfigEntry, ArgsFile 等
    │       ├── merge.ts            ← マージロジック
    │       ├── validate.ts         ← バリデーション
    │       └── generate.ts         ← generate()
    ├── extension/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── esbuild.mjs
    │   ├── .vscodeignore
    │   └── src/
    │       ├── extension.ts        ← エントリポイント
    │       ├── treeview/           ← TreeView プロバイダー
    │       ├── io/                 ← ファイル I/O, FileSystemWatcher
    │       ├── webview/            ← Webview Panel 管理（HTML 生成、メッセージハンドラ）
    │       └── messages.ts         ← WebviewMessage, HostMessage 型定義
    └── webview/
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── components/         ← TemplateEditor, ConfigEditor 等
            └── utils/
                └── rpc.ts          ← requestId ヘルパー
```

### 5.5 バンドラー

| 対象                    | バンドラー                        |
| ----------------------- | --------------------------------- |
| `@launch-composer/core` | tsc（型定義 + ES モジュール出力） |
| Extension Host          | esbuild                           |
| Webview                 | Vite 8                            |

Webview のビルド出力先は `packages/extension/dist/webview/` とする。

### 5.6 npm scripts

ルートの `package.json`:

```jsonc
{
  "scripts": {
    "build:core": "npm run build -w @launch-composer/core",
    "build:webview": "npm run build -w @launch-composer/webview",
    "build:extension": "npm run build -w launch-composer",
    "build": "npm run build:core && npm run build:webview && npm run build:extension",
    "watch:extension": "npm run watch -w launch-composer",
    "watch:webview": "npm run watch -w @launch-composer/webview",
    "package": "npm run build && npm run package -w launch-composer",
  },
}
```

### 5.7 開発ワークフロー

F5 でデバッグ起動する際、Extension Host と Webview のウォッチを並列実行する。

`.vscode/tasks.json`:

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "watch:extension",
      "type": "npm",
      "script": "watch:extension",
      "isBackground": true,
      "problemMatcher": ["$esbuild-watch"],
    },
    {
      "label": "watch:webview",
      "type": "npm",
      "script": "watch:webview",
      "isBackground": true,
    },
    {
      "label": "watch:all",
      "dependsOn": ["watch:extension", "watch:webview"],
      "dependsOrder": "parallel",
    },
  ],
}
```

### 5.8 パッケージング

`packages/extension/.vscodeignore`:

```
src/**
node_modules/**
.vscode/**
.vscode-test/**
esbuild.mjs
tsconfig.json
**/*.ts
**/*.map
!dist/**
```

`vsce package` を実行すると、`.vscodeignore` の設定に従い `dist/` 以下のビルド済みファイルのみが .vsix に含まれる。
