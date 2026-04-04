# Launch Composer - コアロジック仕様

`@launch-composer/core` パッケージが実装するロジックの仕様。VSCode・Node.js に依存しない純粋な関数として実装する。

データ型の定義は [spec-communication.md](./spec-communication.md) §1.5 を参照。スキーマ（JSON ファイル形式）は [spec.md](./spec.md) §4 を参照。

---

## 概要

`@launch-composer/core` は、ユーザーが `.vscode/launch-composer/` に配置した `templates/*.json` と `configs/*.json` を入力として受け取り、マージ・バリデーションを行い、`.vscode/launch.json` に出力するデバッグ構成の内容を生成するパッケージである。

ファイルの読み書きは `launch-composer`（extension）側が担い、このパッケージはデータの変換のみを行う。VSCode API や Node.js のファイルシステム API には一切依存せず、入力データを受け取って出力データを返す純粋な関数として実装する。

主な処理の流れ:

1. テンプレートエントリ（`templates/*.json`）と config エントリ（`configs/*.json`）を入力として受け取る
2. config の `extends` が指定するテンプレートをベースに、config の値でオーバーライドしてマージする
3. `argsFile` が指定されている場合は外部ファイルの `args` と config の `args` を結合する
4. バリデーションエラーがあれば生成を中断してエラーリストを返す
5. 問題がなければ `launch.json` の `configurations` 配列として出力するオブジェクトの配列を返す

---

## 1. マージルール

テンプレートと config をマージして launch.json のエントリを生成するルールを定める。

### 1.1 マージの優先順位

テンプレートと config のマージにおける優先順位を以下に示す。

```
template（ベース） < config（オーバーライド）
```

template をベースとし、config の値で上書きする。argsFile はマージの対象ではなく、launch.json の args を決定するルール（1.3 参照）として別に処理する。

config の `extends` が省略されている場合はテンプレートとのマージを行わず、config のパススルーキーのみで launch.json のエントリを構成する。

`extends` が設定されている config に `program`, `type`, `request` のいずれかのパススルーキーが存在する場合は Generate 時エラーとする。これらはデバッグ対象のバイナリとデバッガの種類を定義するフィールドであり、テンプレートで一元管理する。`extends` が省略されている config はこれらのフィールドを持てる。

生成される各 configuration では `type` と `request` を必ず出力する。マージ後の値が文字列でない場合は、Generate を失敗させず空文字 `""` を補完して出力する。これは VS Code 上で Missing property 警告を出しにくくするための出力正規化である。

### 1.2 キーの型ごとのマージ動作

キーの値の型ごとに、適用するマージ戦略が異なる。

| 値の型                                  | 戦略                    | 備考                        |
| --------------------------------------- | ----------------------- | --------------------------- |
| プリミティブ（string, number, boolean） | config で上書き         |                             |
| オブジェクト（env 等）                  | config で上書き（置換） | template の値は引き継がない |
| 配列（args 以外）                       | config で上書き（置換） |                             |
| args                                    | 特殊処理（1.3 参照）    |                             |

すべてのキーについて shallow merge を適用する。config に同じキーが存在する場合は、値の型に関わらず config の値で template の値を丸ごと上書きする。config に存在しないキーは template の値がそのまま継承される。

例:

```jsonc
// template
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

// 結果: template の env がそのまま継承される
{ "env": { "PATH": "/usr/bin", "DEBUG": "1" }, "cwd": "${workspaceFolder}/test" }
```

### 1.3 launch.json の args を決定するルール

args は、template の `args`（ベース）・config の `argsFile`（外部ファイル参照）・config の `args`（直接指定）の組み合わせで決定する。template.args と argsFile は同時に使用できない。

`extends` のない config は template.args が存在しないため、下表の「template.args なし」の行のみ適用される。

| template.args | argsFile | config.args | 結果                                 |
| ------------- | -------- | ----------- | ------------------------------------ |
| なし          | なし     | なし        | `args` キー自体を出力しない          |
| なし          | なし     | あり        | `config.args`                        |
| なし          | あり     | なし        | `argsFile.args`                      |
| なし          | あり     | あり        | `[...argsFile.args, ...config.args]` |
| あり          | あり     | —           | エラー（Generate を中断）            |
| あり          | なし     | なし        | `template.args`                      |
| あり          | なし     | あり        | `[...template.args, ...config.args]` |

---

## 2. パス解決

config の `argsFile` に指定するファイルパスの解決ルールを定める。

### 2.1 argsFile パスでサポートする変数

argsFile のパスでは以下の変数を使用できる。

| 変数                 | 展開先                        |
| -------------------- | ----------------------------- |
| `${workspaceFolder}` | VSCode のワークスペースルート |

argsFile のパスには絶対パスまたは `${workspaceFolder}` を含むパスを指定する。相対パスを指定した場合はエラーとして生成を中断する。

### 2.2 ${workspaceFolder} の展開手順

`${workspaceFolder}` を含むパスは、以下の手順で展開する。

1. `${workspaceFolder}` をワークスペースルートのパスに置換する。
2. 展開後の結果が絶対パスであることを検証する。絶対パスでなければエラーとして生成を中断する。

変数解決は呼び出し側から `variables: Record<string, string>` を渡す形とし、コアは文字列置換のみを行う。

### 2.3 エラーハンドリング

argsFile のパス解決でエラーが発生した場合の挙動を定める。

- argsFile のパスを指定した場合、展開後のパスにファイルが存在しなければエラーとして生成を中断する。
- ファイルの存在を任意（optional）にする仕組みは設けない。ファイルが不要な構成では argsFile キー自体を省略する。

---

## 3. バリデーション

Generate 実行時に行う入力データのバリデーションルールを定める。

### 3.1 Generate 時の検証

バリデーションは Generate 実行時にまとめて行う。リアルタイムバリデーションは行わない。

| 検証内容                                                                                                                                             | 表示方法        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| テンプレートまたは構成エントリの `name` が空文字または未指定                                                                                         | VSCode 通知バー |
| 構成エントリの `extends` が存在しないテンプレート名を参照している（`extends` 省略時はチェックしない）                                                | VSCode 通知バー |
| `extends` が設定されている構成エントリが `program`, `type`, `request` のいずれかをパススルーキーとして持っている（`extends` 省略時はチェックしない） | VSCode 通知バー |
| `name` が他のテンプレートまたは構成エントリと重複している（テンプレートはファイルをまたいだ重複を含む）                                              | VSCode 通知バー |
| `argsFile` で指定したファイルが存在しない                                                                                                            | VSCode 通知バー |
| `argsFile` で指定したファイルの内容が不正（`args` キーがない、配列でない等）                                                                         | VSCode 通知バー |
| `argsFile` のパスに含まれる変数の展開に失敗した                                                                                                      | VSCode 通知バー |
| `extends` で参照するテンプレートに `args` が定義されているにもかかわらず、config エントリに `argsFile` が指定されている                              | VSCode 通知バー |

`type` / `request` の未設定自体は Generate 時エラーにしない。未設定の場合は、出力時に空文字 `""` を補完する。

テンプレート名の重複エラーは、どのファイルで重複が発生しているかをメッセージに含める。例:

```
Template name "cpp" is defined in multiple files: cpp.json, scripting.json
```

エラーが1つでもあれば launch.json の生成を中断し、検出したすべてのエラーを通知バーに一覧表示する。

エラーの型定義は [spec-communication.md](./spec-communication.md) §1.5 の `ValidationError` を参照。
