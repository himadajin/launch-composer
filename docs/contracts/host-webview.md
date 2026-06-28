# Host-Webview Data Contracts

Extension Host と Webview の message shape は `packages/extension/src/messages.ts` を canonical source とする。Webview 側の mirror は `packages/webview/src/types.ts` である。

## Contracts

- 契約: editor target
  - canonical source: `EditorTarget` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: `file` は composer directory 内のファイル名であり、絶対パスではない
- 契約: initial data payload
  - canonical source: `InitialDataPayload` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: editor panel の full snapshot と revision を運ぶ
- 契約: workspace update payload
  - canonical source: `WorkspaceUpdatePayload` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: profile update は open config editor にも送る
- 契約: entry patch operation
  - canonical source: `EntryPatchOperation` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: path は entry root からの相対パスであり、`name` は patch では変更しない
- 契約: Webview message
  - canonical source: `WebviewMessage` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: response が必要な message は `requestId` を持つ
- 契約: Host message
  - canonical source: `HostMessage` in `packages/extension/src/messages.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-communication.md](../spec-communication.md)
  - 注意: response message は Webview request と同じ `requestId` を返す
- 契約: composer data issue
  - canonical source: `ComposerDataIssue` in `packages/extension/src/io/workspaceStore.ts`
  - mirror source: `packages/webview/src/types.ts`
  - behavior spec: [../spec-extension.md](../spec-extension.md), [../spec-communication.md](../spec-communication.md)
  - 注意: invalid file をファイル単位で表す。core validation error とは別物

## Ownership

`packages/extension/src/messages.ts` を変更した場合は、`packages/webview/src/types.ts` とこの contract map を同期する。`ProfileData`、`ConfigData`、`ValidationError` を含む payload を変更する場合は `packages/core/src/types.ts` も確認する。
