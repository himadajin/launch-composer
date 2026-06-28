# JSON File Data Contracts

JSON file data と Generate 入出力の shape は `packages/core/src/types.ts` を canonical source とする。

## Contracts

- 契約: profile entry
  - 用途: Generate の base になる reusable profile
  - canonical source: `ProfileData` in `packages/core/src/types.ts`
  - file shape: `profiles/*.json` の配列要素
  - behavior spec: [../spec.md](../spec.md), [../spec-core.md](../spec-core.md)
  - 注意: `configuration` は VS Code `launch.json` configuration のベースになるパススルーオブジェクト
- 契約: profile file
  - 用途: profile entry をまとめる入力ファイル
  - canonical source: `ProfileFileData` in `packages/core/src/types.ts`
  - file shape: `profiles/*.json` の root 配列
  - behavior spec: [../spec.md](../spec.md), [../spec-extension.md](../spec-extension.md)
  - 注意: `file` は composer directory 内のファイル名であり、絶対パスではない
- 契約: config entry
  - 用途: profile を参照して 1 件の生成対象を表す
  - canonical source: `ConfigData` in `packages/core/src/types.ts`
  - file shape: `configs/*.json` の `configurations` 配列要素
  - behavior spec: [../spec.md](../spec.md), [../spec-core.md](../spec-core.md)
  - 注意: `configuration` は config 側の上書き用パススルーオブジェクト
- 契約: config file
  - 用途: config entry をまとめる入力ファイル
  - canonical source: `ConfigFileData` in `packages/core/src/types.ts`
  - file shape: `configs/*.json` の root object
  - behavior spec: [../spec.md](../spec.md), [../spec-extension.md](../spec-extension.md)
  - 注意: 生成対象判定は config entry の `enabled` で行う
- 契約: argsFile data
  - 用途: config entry から参照する外部 args source
  - canonical source: `ArgsFileData` in `packages/core/src/types.ts`
  - file shape: config entry の `argsFile` が参照する JSON/JSONC object
  - behavior spec: [../spec.md](../spec.md), [../spec-core.md](../spec-core.md)
  - 注意: `args` 以外の key は生成に使わない
- 契約: generated launch.json
  - 用途: Generate が `.vscode/launch.json` に書き込む出力
  - canonical source: `LaunchJson` and `LaunchConfig` in `packages/core/src/types.ts`
  - file shape: `.vscode/launch.json`
  - behavior spec: [../spec-core.md](../spec-core.md), [../spec-extension.md](../spec-extension.md)
  - 注意: Extension Host は固定コメントを付けてファイル全体を再生成する
- 契約: validation error
  - 用途: Generate failure と Webview への error 表示に使う
  - canonical source: `ValidationError` in `packages/core/src/types.ts`
  - behavior spec: [../spec-core.md](../spec-core.md), [../spec-communication.md](../spec-communication.md)
  - 注意: invalid file issue は Extension Host で validation-style error に変換される

## Ownership

`packages/core/src/types.ts` を変更した場合は、このファイルの contract map、関連する `docs/spec*.md`、および mirror している `packages/webview/src/types.ts` / `packages/extension/src/messages.ts` を確認する。
