# Launch Composer - コアロジック仕様

このファイルは `@launch-composer/core` が実装する生成、マージ、バリデーション、argsFile、変数展開の仕様を定める。JSON file data と Generate 入出力の contract map は [contracts/json-files.md](./contracts/json-files.md) を参照する。

`@launch-composer/core` は VS Code API と Node.js ファイルシステム API に依存しない。ファイル読み書きは extension が行い、core は `ProfileFileData[]`、`ConfigFileData[]`、変数、argsFile 読み取りコールバックを受け取って結果を返す。

## 公開 API

### generate(input)

`generate(input)` は全入力を検証し、エラーがなければ `LaunchJson` を返す。

`GenerateInput`、`GenerateResult`、`LaunchJson`、`ValidationError` の canonical source は `packages/core/src/types.ts` である。

処理順序:

1. profile と config をファイル順、配列順に展開する。
2. Generate 時バリデーションを全エントリに対して行う。
3. エラーが 1 件以上ある場合は `success: false` とすべてのエラーを返す。
4. エラーがなければ、entry-level の `enabled` が `false` でない config だけを生成対象にする。
5. 各 config の `profile` が指す profile をベースにマージし、`LaunchJson` を返す。

excluded な config も、Generate 時バリデーションの対象である。`enabled` は出力対象から除外するためのフラグであり、入力の不正を隠すためのフラグではない。

### validateGenerateInput(input)

`validateGenerateInput(input)` は `generate(input)` と同じ検証を実行し、`ValidationError[]` だけを返す。`launch.json` は生成しない。

## マージルール

### profile と config

生成される 1 件の `launch.json` configuration は、profile の `configuration` をベースにし、config の `configuration` で shallow merge する。

```text
profile.configuration < config.configuration
```

shallow merge はキー単位の置換である。オブジェクト、配列、プリミティブのいずれも、config に同じキーがあれば config の値で丸ごと上書きする。deep merge はしない。

例:

```jsonc
// profile.configuration
{ "env": { "PATH": "/usr/bin", "DEBUG": "1" } }

// config.configuration
{ "env": { "DEBUG": "0" } }

// output
{ "env": { "DEBUG": "0" } }
```

config に存在しないキーは profile から継承する。生成結果の `name` は常に config の `name` を使う。profile の `name` は `launch.json` に出力しない。

config の `configuration` に `program`、`type`、`request` が存在する場合は Generate 時エラーにする。これらは profile 側で管理する。

### enabled

生成対象になる条件:

```text
config.enabled !== false
```

config entry の `enabled` は、省略時に Generate 上 `true` として扱う。

### args

`launch.json` の `args` は profile の `args`、argsFile の `args`、config の `args` から決まる。profile の `args` と config の `argsFile` は同時に使えない。

- case: profile args なし、argsFile なし、config args なし
  - 条件:
    - profile.args: なし
    - argsFile: なし
    - config.args: なし
  - 出力: `args` キーを出力しない
- case: profile args なし、argsFile なし、config args あり
  - 条件:
    - profile.args: なし
    - argsFile: なし
    - config.args: あり
  - 出力: `config.args`
- case: profile args なし、argsFile あり、config args なし
  - 条件:
    - profile.args: なし
    - argsFile: あり
    - config.args: なし
  - 出力: `argsFile.args`
- case: profile args なし、argsFile あり、config args あり
  - 条件:
    - profile.args: なし
    - argsFile: あり
    - config.args: あり
  - 出力: `[...argsFile.args, ...args]`
- case: profile args あり、argsFile なし、config args なし
  - 条件:
    - profile.args: あり
    - argsFile: なし
    - config.args: なし
  - 出力: `profile.args`
- case: profile args あり、argsFile なし、config args あり
  - 条件:
    - profile.args: あり
    - argsFile: なし
    - config.args: あり
  - 出力: `[...profile.args, ...args]`
- case: profile args あり、argsFile あり、config args 任意
  - 条件:
    - profile.args: あり
    - argsFile: あり
    - config.args: 任意
  - 結果: エラー

出力する場合は新しい配列を作る。入力配列を破壊しない。

## argsFile

### パス解決

argsFile のパスは、絶対パスか `${workspaceFolder}` を含むパスでなければならない。

対応する絶対パス:

- `/tmp/args.json` のような Unix 形式
- `C:\tmp\args.json` のような Windows drive 形式
- `\\server\share\args.json` のような UNC 形式

対応する変数は `${workspaceFolder}` のみである。core は `variables.workspaceFolder` の値で文字列置換する。未対応の変数、または `${workspaceFolder}` が指定されたのに `variables.workspaceFolder` が渡されていない場合はエラーにする。

置換後のパスが絶対パスでない場合もエラーにする。

### 読み取り

core 自身はファイルを読まない。`argsFile` が指定された config を検証するには、呼び出し側が `readArgsFile(resolvedPath)` を渡す必要がある。

`readArgsFile` の結果:

- 結果: `success`
  - 扱い: `data` を argsFile データとして検証する
- 結果: `not-found`
  - 扱い: `argsFile does not exist` の validation error
- 結果: `error`
  - 扱い: 読み取り失敗の validation error
- 結果: reader 未指定
  - 扱い: `args file reader was provided` の validation error

argsFile の `data` は JSON オブジェクトで、`args` が文字列配列でなければならない。`args` 以外のキーは無視する。

同じ解決済みパスが複数 config から参照される場合、検証中に読み取った argsFile データをキャッシュして再利用する。

## Generate 時バリデーション

core は Generate 前に入力全体を検証し、エラーをまとめて返す。最初のエラーで打ち切らない。

### profile

- 条件: `name` が非空文字列でない
  - エラー: はい
- 条件: `args` が存在し、文字列配列でない
  - エラー: はい
- 条件: `configuration` が存在し、オブジェクトでない
  - エラー: はい
- 条件: `configuration.request` が `launch` / `attach` でない
  - エラー: はい
- 条件: `configuration.type` が非空文字列でない
  - エラー: はい

`configuration` が省略されている profile は、`request` と `type` の検証に失敗する。

### config file

- 条件: `configurations` が配列でない
  - エラー: はい

extension のファイル読み込みでは、config ファイルのルート形状が不正な場合は `ComposerDataIssue` として扱われる。core に渡された `ConfigFileData` でも `configurations` が配列でない場合は validation error にする。

### config entry

- 条件: `name` が非空文字列でない
  - エラー: はい
- 条件: `enabled` が存在し、boolean でない
  - エラー: はい
- 条件: `profile` が非空文字列でない
  - エラー: はい
- 条件: `profile` が存在しない profile 名を参照している
  - エラー: はい
- 条件: `argsFile` が存在し、string でない
  - エラー: はい
- 条件: `args` が存在し、文字列配列でない
  - エラー: はい
- 条件: `configuration` が存在し、オブジェクトでない
  - エラー: はい
- 条件: `configuration.program` / `type` / `request` が存在する
  - エラー: はい
- 条件: 参照先 profile に `args` があり、config に `argsFile` がある
  - エラー: はい

### name の一意性

profile と config entry の `name` は、全 profile と全 config entry を通じて一意でなければならない。profile 同士、config 同士、profile と config の間の重複をすべてエラーにする。

重複エラーの message には重複した名前と `file#index` 形式の発生位置を含める。

## 出力

Generate 成功時は `LaunchJson` を返す。出力 shape の canonical source は `packages/core/src/types.ts` の `LaunchJson` / `LaunchConfig` である。

`configurations` の順序は、core に渡された `configs` 配列の順序と各ファイル内の `configurations` 配列順に従う。extension はファイル名を昇順に読んで core に渡す。

各 `LaunchConfig` には config の `name`、マージ済みの profile/config `configuration`、必要に応じて `args` が含まれる。`type` は非空文字列、`request` は `launch` または `attach` として検証済みである。

有効な config が 0 件でも成功とし、`configurations: []` を返す。
