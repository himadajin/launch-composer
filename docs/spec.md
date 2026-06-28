# Launch Composer - 共通仕様

このファイルは Launch Composer の共通入口である。詳細な挙動は領域別の仕様ファイルを正とし、このファイルには概要、仕様ファイルの読み分け、JSON ファイルスキーマ、パッケージ構成だけを置く。

## 仕様ファイル

| ファイル                                         | 主な内容                                                       | 対象パッケージ                                 |
| ------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| `spec.md`（本ファイル）                          | 概要、仕様ファイルの読み分け、JSON ファイルスキーマ、構成      | 全体                                           |
| [spec-core.md](./spec-core.md)                   | 生成、マージ、バリデーション、argsFile、変数展開               | `@launch-composer/core`                        |
| [spec-extension.md](./spec-extension.md)         | VS Code 統合、workspace I/O、Generate コマンド、TreeView 操作  | `launch-composer`                              |
| [spec-ui.md](./spec-ui.md)                       | TreeView 表示、Webview 編集フォーム、ユーザー操作              | `launch-composer` + `@launch-composer/webview` |
| [spec-communication.md](./spec-communication.md) | Extension Host と Webview のメッセージ、共有データ型、保存契約 | `launch-composer` + `@launch-composer/webview` |

仕様を変更する場合は、変更対象の実装面に対応する仕様ファイルを同時に更新する。共通スキーマや共有型を変更する場合は、このファイル、[spec-communication.md](./spec-communication.md)、`packages/core/src/types.ts`、`packages/extension/src/messages.ts`、`packages/webview/src/types.ts` の整合性を保つ。

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

## JSON ファイルスキーマ

入力ファイルは JSONC として読む。コメントと末尾カンマを受け付ける。GUI からの編集は `jsonc-parser` ベースの部分更新で行い、関係しないコメントをできるだけ保持する。生成される `launch.json` は毎回ファイル全体を再生成するため、既存の `launch.json` の内容やコメントは保持しない。

### profiles/\*.json

profile ファイルのルートは配列である。各要素が 1 件の profile を表す。

```jsonc
[
  {
    "name": "cpp",
    "args": ["--profile-arg"],
    "configuration": {
      "type": "cppdbg",
      "request": "launch",
      "program": "${workspaceFolder}/build/app",
      "cwd": "${workspaceFolder}",
    },
  },
]
```

profile エントリの拡張機能固有キー:

| キー   | 型         | 必須性                        | 説明                                       |
| ------ | ---------- | ----------------------------- | ------------------------------------------ |
| `name` | `string`   | Generate 時に非空文字列が必須 | profile 識別子。`launch.json` へ出力しない |
| `args` | `string[]` | 任意                          | 生成時に config の `args` と結合する       |

`configuration` は `launch.json` configuration のベースになるパススルーオブジェクトである。ファイル読み込み上は省略可能だが、Generate 時には各 profile の `configuration.type` が非空文字列であり、`configuration.request` が `launch` または `attach` でなければならない。GUI で profile を追加した直後は `type` が空文字で作られるため、Generate 前に JSON で有効な値へ修正する必要がある。

profile 間の継承はない。

### configs/\*.json

config ファイルのルートはオブジェクトであり、`configurations` 配列を持つ。各要素が 1 件のデバッグ構成を表す。

```jsonc
{
  "enabled": true,
  "configurations": [
    {
      "name": "Basic Test",
      "enabled": true,
      "profile": "cpp",
      "argsFile": "${workspaceFolder}/tmp/args.json",
      "args": ["--debug"],
      "configuration": {
        "cwd": "${workspaceFolder}/test",
        "stopAtEntry": false,
      },
    },
  ],
}
```

config ファイルの拡張機能固有キー:

| キー             | 型        | 必須性                         | 説明                                                     |
| ---------------- | --------- | ------------------------------ | -------------------------------------------------------- |
| `enabled`        | `boolean` | 任意。省略時は Generate 上有効 | `false` の場合、ファイル内の全 config を生成対象外にする |
| `configurations` | `array`   | ファイル形状として必須         | config エントリの配列                                    |

config エントリの拡張機能固有キー:

| キー       | 型         | 必須性                         | 説明                                             |
| ---------- | ---------- | ------------------------------ | ------------------------------------------------ |
| `name`     | `string`   | Generate 時に非空文字列が必須  | 生成される `launch.json` configuration の name   |
| `enabled`  | `boolean`  | 任意。省略時は Generate 上有効 | `false` の場合、この config を生成対象外にする   |
| `profile`  | `string`   | Generate 時に非空文字列が必須  | 参照する profile の `name`                       |
| `argsFile` | `string`   | 任意                           | 外部 args ファイルへの絶対パスまたは変数付きパス |
| `args`     | `string[]` | 任意                           | 生成時に profile または argsFile の args に追記  |

`configuration` は `launch.json` configuration に渡すパススルーオブジェクトである。ただし Generate 時、config の `configuration` に `program`、`type`、`request` がある場合はエラーにする。これらは profile 側で管理する。

`enabled` の省略は Generate 上は有効として扱う。file-level `enabled === false` の場合、そのファイル内の config は entry-level `enabled` の値に関わらず生成されない。

### argsFile

`argsFile` は config エントリから参照される外部 JSON/JSONC ファイルである。ルートはオブジェクトで、`args` に文字列配列を持つ。

```jsonc
{
  "args": ["-v", "input.txt"],
  "generatedAt": "2026-03-16T10:30:00Z",
  "source": "replay-tool",
}
```

`args` 以外のキーは生成に使わない。メタデータとして自由に含めてよい。`argsFile` のパス解決と結合順序は [spec-core.md](./spec-core.md) を参照する。

### 生成される launch.json

Generate が成功すると、`.vscode/launch.json` に次の形の JSONC を書き込む。

```jsonc
// This file is auto-generated by Launch Composer.
// Do not edit manually. Changes will be overwritten.
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Basic Test",
      "type": "cppdbg",
      "request": "launch",
      "program": "${workspaceFolder}/build/app",
      "cwd": "${workspaceFolder}/test",
      "args": ["-v", "input.txt", "--debug"],
    },
  ],
}
```

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

- スキーマに対応する型
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

## ビルドと検証

ルートの npm scripts を使う。

| コマンド                 | 内容                                             |
| ------------------------ | ------------------------------------------------ |
| `npm run build`          | core、webview、extension を順にビルドする        |
| `npm run lint`           | ESLint を実行する                                |
| `npm run typecheck`      | 各 workspace の TypeScript 型チェックを実行する  |
| `npm run test`           | 各 workspace の Node test を実行する             |
| `npm run format`         | Prettier で整形する                              |
| `npm run format:check`   | Prettier の整形チェックを行う                    |
| `npm run install:vscode` | extension workspace の install script を実行する |

テストは Node.js の `node --test` を使う。package ごとの詳細な script は各 `package.json` を参照する。
