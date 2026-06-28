# Launch Composer - データ契約

このディレクトリは、データ構造の正規定義そのものではなく、正規定義への入口である。

データ shape の canonical source は TypeScript 型に置く。仕様書は behavior を説明し、このディレクトリは「どの契約はどの型と仕様を見るか」を示す。

## 契約一覧

- 契約: JSON file data / Generate input / Generate output
  - contract map: [json-files.md](./json-files.md)
  - canonical source: `packages/core/src/types.ts`
  - behavior spec: [../spec.md](../spec.md), [../spec-core.md](../spec-core.md), [../spec-extension.md](../spec-extension.md)
- 契約: Extension Host ↔ Webview messages
  - contract map: [host-webview.md](./host-webview.md)
  - canonical source: `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)

## 更新ルール

- TypeScript 型を変更する場合は、対応する contract map と仕様書の参照・説明も確認する。
- contract map には型全文や大きな JSON 例を複製しない。
- JSON Schema ファイルは置かない。`configuration` などのパススルー領域は TypeScript の `unknown` / index signature と仕様本文で扱う。
- behavior は `docs/spec*.md` に書く。contract map には責務と正規参照先だけを書く。
