# 修正計画: Watcher エコーフィルタの期待リーク

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 未着手。

## 問題

自分自身の書き込みによる watcher イベントを 1 回無視する仕組み(`WatcherEchoFilter` の `expect`)が、**実際には書き込みが発生しなかった操作でも無条件に期待を登録**する。期待に TTL がないため、リークした期待は次の外部変更まで残り、**その本物の外部編集イベントが 1 回飲み込まれて TreeView / webview が古いまま残る**。【確信度: 高】

リーク経路(調査時点で判明した分):

1. **Include All / Exclude All が no-op のとき**: `packages/extension/src/io/workspaceMutations.ts` の `setConfigFileExcluded` は全エントリが既に目的状態だと書き込まずに return するが、`packages/extension/src/commands/handlers.ts` の `syncChangedConfigFile`(調査時点 132〜135 行)は無条件に `echoFilter.expect('config', file)` する。UI のコンテキストメニューから普通に踏める。
2. **空 patch / 適用結果が同一テキストのとき**: `workspaceMutations.ts` の `applyEntryPatch` 系は patch が空、または `nextText === text` の場合も書き込みなしで `status: 'ok'` を返すが、`editorPanel.ts` の mutation ハンドラ(調査時点 353〜357 行)は無条件に `onDidMutate({expectedWatchers: ...})` → `syncController.refresh` が期待を登録する。
3. **同名への rename**: 書き込みなしで成功するが `refreshAfterMutation` が期待を登録する(`editorPanel.ts` 調査時点 286〜307 行、`workspaceMutations.ts` 408〜410 / 428〜430 行)。

関連: `docs/internal/pending.md` の「Align watcher patterns with the store's read scope」(E-3)は同じコンポーネントの basename マッチ問題を扱っている。本計画と同時に解決するのが自然だが、E-3 は仕様決定(入れ子ファイルの扱い)を伴うため独立性は保つこと。

## Phase 0: 調査

1. リーク経路 1〜3 を実機で再現する(例: 全 include 済みの config ファイルで Include All → 外部エディタで同ファイルを編集 → ツリーが更新されないこと)。
2. 上記以外のリーク経路がないか、`expect` / `onDidMutate` / `refreshAfterMutation` の全呼び出し元を洗い出して突き合わせる。
3. 修正方針を決める。候補(併用可):
   - **書き込み有無を mutation の戻り値で返し、書き込みが起きたときだけ期待を登録する**(根本対処)。
   - 期待に TTL(またはイベントループ 1 巡での失効)を付け、リークの影響を時間で限定する(防御層)。
   - E-3(watcher パターンの縮小・キーの basename 問題)とまとめて `WatcherEchoFilter` の照合キーを見直す。
4. `docs/internal/specs/extension.md` のエコー抑制に関する記述を確認し、「書き込みが発生した場合のみ抑制する」ことを明文化する。

## Phase 1: 修正

Phase 0 で決めた方針を実装する。mutation の戻り値変更を伴う場合は、`status: 'ok'` の意味(書き込み有無)の変更として editorPanel / handlers の呼び出し側もあわせて整理する。

## Phase 2: テスト

- no-op 操作(全 include 済みの Include All、空 patch、同名 rename)の後に watcher イベントを流し、**無視されずに** sync が走ることのテスト。
- 実書き込み後のイベントが従来どおり 1 回だけ無視されることの regression テスト。

## 検証

検証ゲートに加え、実機で「no-op 操作 → 外部編集 → ツリー/webview が更新される」ことを確認する。
