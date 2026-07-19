# 修正計画: webview 保存キューの revision 整合

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。

## 問題

webview の保存キュー(`useEntryUpdateQueue`)と payload state 管理(`useComposerPayload` / `App.tsx`)の間で revision と state の整合が取れておらず、不要な conflict の連鎖・一時的な表示巻き戻りが起きる。自己回復はする(conflict → refetch)ため実害はデータ破壊ではなく UX 劣化だが、根が同じなのでまとめて扱う。

### P1. `setPayload` の非関数型更新による lost update【確信度: 中】

- **場所**: `packages/webview/src/App.tsx` の `handleChange`(調査時点 84 行)
- **内容**: `setPayload(updatePayload(payload, editor, nextData))` は render 時にキャプチャした `payload` から新 state を丸ごと作る。一方 workspace-update は `useComposerPayload.ts`(調査時点 54〜58 行)で `startTransition` + 関数型更新により低優先度で処理されるため、transition の commit 前に debounce commit が走ると、直値 set がキュー済みのマージ結果を丸ごと破棄する。profiles / configs / issues / readiness / editorRevision が古いまま残り、古い revision → 次 patch が conflict → refetch という余計な往復が起きる。関数型更新(`setPayload(cur => cur && updatePayload(cur, editor, nextData))`)にすべき。

### P2. エントリ切替時、旧エントリの in-flight update が新エディタの revision を汚染する【確信度: 中〜高】

- **場所**: `packages/webview/src/hooks/useEntryUpdateQueue.ts`(調査時点 46〜48、115〜125 行)
- **内容**: editorKey 変更でキューを `Promise.resolve()` にリセットするが、旧チェーンの継続処理は生きている。旧エントリへの update-result が新エントリの initial-data 受信後に届くと、`revisionRef.current` と `editorRevision` が旧ファイルの値で上書きされ、新エディタでの次の編集が必ず conflict → refetch になる。また、キューのリセット自体が `ui.md` の「前回の update-result を待ってから次の patch request を送る」直列化保証を切替時に破っており、同一ファイル内の別エントリへ切り替えた場合は同一ファイルへの並行 write になる。

### P3. conflict 後、キュー内の後続 patch が stale revision で連鎖 conflict する【確信度: 中】

- **場所**: `packages/webview/src/hooks/useEntryUpdateQueue.ts`(調査時点 108〜113 行)
- **内容**: conflict 時に `await requestLatestPayload()` するが、新 revision が `revisionRef` に入るのは transition の render + effect 後。キューの次タスクは RPC resolve 直後の microtask で走るため、ほぼ確実に古い revision を読み、再 conflict → 再 refetch のカスケードになる。conflict 時に複数フィールドの commit が溜まっていると全部落ちる。

## Phase 0: 調査

1. P1〜P3 を再現する。P2 は「同一ファイル内のエントリ切替」と「別ファイルへの切替」を分けて確認する。
2. `ui.md` の「Webview 保存キュー」章(直列化・conflict → refetch・revision 更新)を精読し、エントリ切替時のキューの扱い(旧チェーンの完了待ち? 破棄? 応答の無視?)を仕様として決める(現状は無規定)。
3. revision の管理を React state(render 後に反映)から切り離す設計(例: ref を唯一の正とし、refetch 完了時に同期的に更新する)を検討する。P3 の「refetch 完了」をどう待つか(RPC 応答の payload から直接 revision を得る等)を決める。
4. [エディタ state 分離計画](./2026-07-webview-editor-state-isolation.md)(`key` 付与による remount)と [エラー応答契約計画](./2026-07-host-webview-error-contract.md) の変更との干渉を確認する。

## Phase 1: 修正

- P1: 関数型更新へ変更する。
- P2: エントリ切替時、旧チェーンの応答が新エディタの revision / payload を汚染しないようにする(世代トークンで応答を無効化する等)。切替時の直列化保証を Phase 0 で決めた仕様どおりに実装する。
- P3: conflict 後の再送が refetch 済み revision を確実に使うようにする。

## Phase 2: テスト

`useEntryUpdateQueue` は現在テストが皆無。直列化・conflict → refetch → 後続 patch の revision・エントリ切替時の応答無視を検証するテストを新設する(`ui.md` の該当章がそのまま仕様になる)。

## 検証

検証ゲートに加え、連続入力 + 外部編集の混在シナリオを実機で操作し、conflict の連鎖・表示巻き戻りが解消していることを確認する。
