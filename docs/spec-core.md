# Launch Composer - コアロジック仕様

`@launch-composer/core` パッケージが実装するロジックの仕様を定める。VSCode にも Node.js にも依存しない純粋な関数として実装する。

データ型の定義は [spec-communication.md](./spec-communication.md) §1.5 を参照する。スキーマ（JSON ファイル形式）は [spec.md](./spec.md) §4 を参照する。

---

## 概要

`@launch-composer/core` は、`.vscode/launch-composer/` 以下に配置された `profiles/*.json` と `configs/*.json` を入力として受け取り、`.vscode/launch.json` に書き込むデバッグ構成を生成するパッケージである。マージとバリデーションもこのパッケージが担う。

ファイルの読み書きは `launch-composer`（extension）側が担い、`@launch-composer/core` はデータの変換だけを行う。VSCode API にも Node.js のファイルシステム API にも依存せず、入力データを受け取って出力データを返す純粋な関数として実装する。

主な処理の流れは次のとおり。

1. profile エントリ（`profiles/*.json`）と config ファイルオブジェクト（`configs/*.json`）を入力として受け取る。
2. config の `profile` が指定する profile をベースに、config の値でオーバーライドしてマージする。
3. `argsFile` が指定されている場合は、外部ファイルの `args` と config の `args` を結合する。
4. バリデーションエラーがあれば、生成を中断してエラーリストを返す。
5. バリデーションエラーがなければ、ファイル単位の `enabled` と config 単位の `enabled` のどちらも `false` でない config だけを `launch.json` の `configurations` 配列として返す。

---

## 1. マージルール

profileと config をマージして launch.json のエントリを生成するルールを定める。

### 1.1 マージの優先順位

profileと config のマージ優先順位を以下に示す。

```
profile（ベース） < config（オーバーライド）
```

profile をベースとし、config の値で上書きする。argsFile はマージの対象外として扱い、launch.json の args を決定するルール（1.3 を参照）で別途処理する。

config は常に `profile` を参照する。launch.json のエントリは profile の `configuration` をベースにし、config の `configuration` で上書きする。

config を生成対象にするか否かは、config ファイルの `enabled` と config エントリの `enabled` の論理積で決まる。どちらか一方でも `false` であれば、その config は生成対象外とする。どちらも省略されている場合は両方とも `true` として扱う。

config の `configuration` に `program`、`type`、`request` のいずれかのパススルーキーが存在する場合、Launch Composer は Generate 時にエラーを返す。これら 3 つのキーはデバッグ対象のバイナリとデバッガの種類を定義するフィールドであり、profile で一元管理する。

生成される各 configuration には `type` と `request` を必ず出力する。`request` の値は `launch` または `attach` のいずれかでなければならない。

### 1.2 キーの型ごとのマージ動作

キーの値の型ごとに、適用するマージ戦略が異なる。

| 値の型                                  | 戦略                    | 備考                       |
| --------------------------------------- | ----------------------- | -------------------------- |
| プリミティブ（string, number, boolean） | config で上書き         |                            |
| オブジェクト（env を含む）              | config で上書き（置換） | profile の値は引き継がない |
| 配列（args 以外）                       | config で上書き（置換） |                            |
| args                                    | 特殊処理（1.3 参照）    |                            |

Launch Composer はすべてのキーに shallow merge を適用する。config に同じキーが存在する場合、値の型に関わらず config の値で profile の値を丸ごと上書きする。config に存在しないキーは、profile の値をそのまま継承する。

例:

```jsonc
// profile
{ "env": { "PATH": "/usr/bin", "DEBUG": "1" } }

// config（env を指定）
{ "env": { "PATH": "/usr/bin", "MY_VAR": "hello" } }

// 結果: config の env がそのまま使われる
{ "env": { "PATH": "/usr/bin", "MY_VAR": "hello" } }
// → DEBUG は消える。必要なら config 側に全キーを書く。
```

```jsonc
// config（env を指定しない）
{ "cwd": "${workspaceFolder}/test" }

// 結果: profile の env がそのまま継承される
{ "env": { "PATH": "/usr/bin", "DEBUG": "1" }, "cwd": "${workspaceFolder}/test" }
```

### 1.3 launch.json の args を決定するルール

launch.json の `args` は、profile の `args`（ベース）と config の `argsFile`（外部ファイル参照）と config の `args`（直接指定）の組み合わせで決定する。profile の `args` と argsFile は同時に使用できない。

| profile.args | argsFile | args | 結果                          |
| ------------ | -------- | ---- | ----------------------------- |
| なし         | なし     | なし | `args` キー自体を出力しない   |
| なし         | なし     | あり | `config.args`                 |
| なし         | あり     | なし | `argsFile.args`               |
| なし         | あり     | あり | `[...argsFile.args, ...args]` |
| あり         | あり     | —    | エラー（Generate を中断）     |
| あり         | なし     | なし | `profile.args`                |
| あり         | なし     | あり | `[...profile.args, ...args]`  |

---

## 2. パス解決

config の `argsFile` に指定するファイルパスの解決ルールを定める。

### 2.1 argsFile パスでサポートする変数

argsFile のパスで使用できる変数は以下のとおり。

| 変数                 | 展開先                        |
| -------------------- | ----------------------------- |
| `${workspaceFolder}` | VSCode のワークスペースルート |

`argsFile` のパスには、絶対パスか `${workspaceFolder}` を含むパスのどちらかを指定する。相対パスを指定した場合、Launch Composer はエラーとして生成を中断する。

### 2.2 ${workspaceFolder} の展開手順

`${workspaceFolder}` を含むパスは、以下の手順で展開する。

1. `${workspaceFolder}` をワークスペースルートのパスに置換する。
2. 置換後のパスが絶対パスであることを検証する。絶対パスでなければ、Launch Composer はエラーとして生成を中断する。

変数解決では、呼び出し側が `variables: Record<string, string>` を渡し、コアは文字列置換のみを行う。

### 2.3 エラーハンドリング

argsFile のパス解決でエラーが発生した場合の挙動を定める。

- argsFile のパスを指定した場合、展開後のパスにファイルが存在しなければ、Launch Composer はエラーとして生成を中断する。
- ファイルの存在を任意（optional）にする仕組みは設けない。ファイルが不要な構成では、`argsFile` キー自体を省略する。

---

## 3. バリデーション

Generate 実行時に行う入力データのバリデーションルールを定める。

### 3.1 Generate 時の検証

Launch Composer はバリデーションを Generate 実行時にまとめて行う。リアルタイムのバリデーションは行わない。

| 検証内容                                                                                                             | 表示方法        |
| -------------------------------------------------------------------------------------------------------------------- | --------------- |
| profileまたは構成エントリの `name` が空文字または未指定                                                              | VSCode 通知バー |
| 構成エントリの `profile` が存在しない profile 名を参照している                                                       | VSCode 通知バー |
| 構成エントリの `configuration` が `program`, `type`, `request` のいずれかを持っている                                | VSCode 通知バー |
| `name` が他の profile または構成エントリと重複している（profile はファイルをまたいだ重複を含む）                     | VSCode 通知バー |
| `argsFile` で指定したファイルが存在しない                                                                            | VSCode 通知バー |
| `argsFile` で指定したファイルの内容が不正（`args` キーが存在しない、または `args` が文字列配列でない）               | VSCode 通知バー |
| `argsFile` のパスに含まれる変数の展開に失敗した                                                                      | VSCode 通知バー |
| `profile` で参照する profile に `args` が定義されているにもかかわらず、config エントリに `argsFile` が指定されている | VSCode 通知バー |
| config ファイルのルートに `configurations` 配列がない                                                                | VSCode 通知バー |
| profile の `request` が `launch` または `attach` ではない                                                            | VSCode 通知バー |
| profile の `type` が空文字または未指定                                                                               | VSCode 通知バー |

`request` は Generate 時に検証する必須値とする。空文字、未指定、または `launch`・`attach` 以外の値はエラーとする。

profile 名の重複エラーでは、どのファイルで重複が発生しているかをメッセージに含める。例を以下に示す。

```
Profile name "cpp" is defined in multiple files: cpp.json, scripting.json
```

エラーが 1 つでもあれば、Launch Composer は launch.json の生成を中断し、検出したすべてのエラーを通知バーに一覧表示する。

エラーの型定義は [spec-communication.md](./spec-communication.md) §1.5 の `ValidationError` を参照する。
