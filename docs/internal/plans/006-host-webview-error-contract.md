# 修正計画: Host/Webview のエラー応答契約

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 未着手。

## 問題

request/response 型の Host/Webview 通信で、**エラー時の応答契約が欠けている・守られていない**箇所が複数あり、webview のフリーズ・未保存データの「保存済み」偽装・unhandled rejection を招く。`docs/internal/pending.md` の「Unify the editorPanel mutation error policy」(E-1)と地続きの問題であり、本計画で包含して解決するのが自然である。

### P1. host 側エラー時に応答が返らず、webview が 30 秒固まる【確信度: 高(発生条件は host 側エラー時)】

- **場所**: `packages/extension/src/webview/editorPanel.ts` の `request-initial-data` / `browse-file` / `generate` ハンドラ(調査時点 136〜137、166〜174、195〜207 行)
- **内容**: これらは `runMutation` を通らないため、処理中の例外(launch.json 書き込み失敗、readAll 失敗など)は catch されてトーストは出るが、**response が post されない**。webview の `RpcClient`(`packages/webview/src/utils/rpc.ts`)は 30 秒タイムアウトで初めて reject するため、Generate ボタン等が 30 秒 pending のまま固まる。`communication.md` は request には response を返す契約。

### P2. RPC タイムアウト(30 秒)が仕様外で、遅延応答との整合が未定義【確信度: 中】

- **場所**: `packages/webview/src/utils/rpc.ts`(調査時点 46 行)
- **内容**: `communication.md` にタイムアウトの規定がない。タイムアウト後に遅延到着した update-result は捨てられるが、host 側では書き込みが成功している可能性があり、「保存されたのに webview は失敗扱い」の状態乖離が起きうる。

### P3. 保存失敗・タイムアウトが無言で握りつぶされ、未保存 state が永続化される【確信度: 中】

- **場所**: `packages/webview/src/hooks/useEntryUpdateQueue.ts`(調査時点 108〜112、128 行)、`packages/webview/src/hooks/useComposerPayload.ts`(調査時点 69〜73 行)
- **内容**: `success: false`(非 conflict)や timeout reject 時、optimistic 反映済みの `payload` はそのまま残り(`.catch(() => undefined)`)、その未保存 state が `vscode.setState` に永続化される。パネル再表示時はこの誤った state から hydrate されるため、ディスクと食い違う値が保存済みかのように表示され続ける(refetch もされない)。仕様は host 側トーストのみ規定しており、webview 側の巻き戻しが無規定。

### P4. rename の reject 経路で必須の refetch が行われず、unhandled rejection になる【確信度: 中】

- **場所**: `packages/webview/src/hooks/useEntryUpdateQueue.ts`(調査時点 57〜67 行)、`NameField.tsx` の `void commitName()`、`ConfigEditor.tsx` の Browse ボタン async onClick
- **内容**: `sendRequest` が reject すると `requestLatestPayload()` に到達せず(`ui.md` の「結果に関わらず最新状態を再取得」に違反)、catch がないため unhandled promise rejection になる。

## Phase 0: 調査

1. P1 を実機/テストで再現する(host ハンドラに例外を注入し、webview 側の 30 秒フリーズを確認)。
2. エラー応答契約を決めて `communication.md` に明文化する(Spec-First)。決めるべき点:
   - すべての request に対し、host は成功・失敗を問わず必ず response を返す(失敗 response の形状を含む)。
   - 失敗の表示責務(E-1: webview が出すか host がトーストか)。
   - webview 側タイムアウトの要否・時間・タイムアウト後の遅延応答の扱い(P2)。
   - 保存失敗時の webview state の巻き戻しと `setState` 永続化の条件(P3)。
3. `runMutation` に P1 の 3 ハンドラを乗せられるか(応答形状の統一)を確認する。

## Phase 1: 修正

- host: 全 request ハンドラが失敗時も response を post するよう統一する(E-1 のポリシー統一を含む)。
- webview: 失敗・reject 時に refetch(または optimistic 反映の巻き戻し)を必ず行い、未確定 state を `setState` に書かないようにする。async イベントハンドラの catch 漏れを潰す。

## Phase 2: テスト

- host ハンドラ例外時に失敗 response が post されることのテスト(editorPanel テストの流儀)。
- `useEntryUpdateQueue` の失敗・reject 経路のテスト(現在テストが皆無。[計画 007](./007-webview-update-queue-revision.md) とテスト基盤を共有する)。

## 検証

検証ゲートに加え、E-1 を `pending.md` から本計画のクローズとともに削除する(解決を明記)。
