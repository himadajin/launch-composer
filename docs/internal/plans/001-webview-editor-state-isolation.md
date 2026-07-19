# 修正計画: webview エディタ state のエントリ間分離

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 完了(commit `ff28fa8`)。

## 問題

webview のエディタコンポーネントは、表示対象エントリが切り替わってもローカル state(編集中テキスト・debounce タイマー)を引き継いでしまい、エントリをまたいだ誤保存・表示不整合を起こす。関連する問題が 4 件ある。

### P1. エントリ切替時に編集中テキストが別エントリに書き込まれる【確信度: 高】

- **場所**: `packages/webview/src/App.tsx` の `ProfileEditor` / `ConfigEditor` レンダリング(調査時点 113〜146 行)、`packages/webview/src/components/hooks.ts` の `useEditableField` 同期 effect(同 45〜48 行)
- **内容**: エディタコンポーネントに `key`(editorKey 相当)が付いていないため、同種エントリ間の切替では remount されず、`useEditableField` / `NameField` のローカル state と debounce タイマーが生き残る。同期 effect は `externalValue` が「変化した時」しか走らないため、旧エントリと新エントリで外部値が同一(空文字どうしが典型)の場合、旧エントリで入力したテキストが新エントリの画面に残り、debounce 発火時には最新 render のクロージャ(= 新エントリの `data` / `editor`)を通じて**新エントリの JSON に patch として保存される**。
- **再現**: エントリ A の Program(空)に入力 → autoSaveDelay 経過前に TreeView で同種のエントリ B(Program 空)を開く → A で入力した値が B に表示され、B に書き込まれる。

### P2. rename 失敗・正規化時に NameField の表示が復元されない【確信度: 高】

- **場所**: `packages/webview/src/components/NameField.tsx` の同期 effect(調査時点 26〜35 行)
- **内容**: effect が `externalName` の変化時のみ `setName` するため、rename が重複名で拒否された場合や host 側 trim(`normalizeEntryName`)で no-op になった場合、refetch 後も prop が変化せず、却下された名前・末尾空白付きの名前が入力欄に表示され続ける。`docs/internal/specs/ui.md` の「rename の成否に関わらず最新状態を再取得する」が意図する「失敗時は元に戻る」挙動が実現されていない。

### P3. フォーカス中(debounce 待ち)の外部更新が未保存入力を無言で破棄する【確信度: 高(挙動として)/仕様は無規定】

- **場所**: `packages/webview/src/components/hooks.ts` の `useEditableField` 同期 effect
- **内容**: 入力中(commit 前)に workspace-update が届いて `externalValue` が変わると、`changedByUserRef` を false に戻して値を上書きするため、入力途中のテキストが警告なしに消え、保存もされない。`ui.md` はこのケースを規定しておらず、`test/useEditableField.test.tsx` の 'syncs from external data and does not commit the synced value' がこの破棄挙動を正常系として固定化している。

### P4. disabled 化された Args File フィールドの pending debounce が commit される【確信度: 中】

- **場所**: `packages/webview/src/components/ConfigEditor.tsx`(調査時点 87〜92 行、229 行)
- **内容**: argsFile 入力中に Profile select を args 定義済み profile に変えると入力欄は disabled になるが、`useEditableField` には `readOnly`(invalid file 時)しか渡していないため、走行中の debounce が argsFile patch を書いてしまう。

## Phase 0: 調査

1. P1〜P4 を実際の拡張(Extension Development Host)で再現し、記録する。特に P1 は profile→profile 切替と config→config 切替の両方、および同一ファイル内のエントリ切替で確認する。
2. `ui.md` を精読し、次の未規定事項の仕様を決めて文書化する(Spec-First):
   - フォーカス中・debounce 待ち中に外部更新が届いた場合の挙動(P3)。候補: 「フォーカス中は外部同期を保留し、blur/commit 時に競合解決する」「外部更新を優先し入力を破棄する(現挙動の明文化)」など。
   - rename 失敗時の入力欄の復元(P2)。
3. `key` 付与(P1)が `useEntryUpdateQueue` のエントリ切替処理([計画 007](./007-webview-update-queue-revision.md))と干渉しないか確認する。

### 調査結果

- 2026-07-19、commit `d5cb2e7` で P1〜P4 が残っていること、および調査時点以降に関連実装が変更されていないことを確認した。
- editor identity は `kind:file:index` とする。identity の変更時は editor component を remount し、ローカル入力と未発火の debounce を破棄する。
- debounce 待ち中に外部更新が届いた場合はローカル入力を維持し、最新 snapshot の data と revision に対して保存する。field が disabled または read-only になった場合は、ローカル入力と pending commit を破棄して外部値へ同期する。
- rename の成功・失敗・正規化にかかわらず最新 snapshot を再取得し、request 完了時にも入力表示を外部名へ明示的に戻す。
- editor component の remount と保存キューの `editorKey` は同じ identity を使用するため、未発火 debounce の破棄とは干渉しない。すでに queue へ投入された update と in-flight response の扱いは計画 007 の範囲とする。

## Phase 1: 修正

- P1: エディタコンポーネントに editorKey ベースの `key` を付与し、エントリ切替で確実に remount させる。debounce タイマーが unmount 時に破棄されること(旧エントリへの commit も走らないこと)を確認する。
- P2: NameField が「rename 結果の反映」を prop 変化に依存せず行えるようにする(例: refetch 完了を契機に external 値へ強制同期する)。
- P3: Phase 0 で決めた仕様に合わせて `useEditableField` を修正し、既存テストの期待値を仕様に合わせて書き直す。
- P4: `argsFileDisabled` を `useEditableField` に伝搬し、disabled 中は pending commit を破棄する。

## Phase 2: テスト

- エントリ切替時にローカル state が持ち越されないこと(P1)の regression テスト。
- rename 失敗 → 表示復元(P2)、フォーカス中外部更新(P3)、disabled 後の debounce 破棄(P4)のテスト。`NameField` は現在テストが皆無なので、このタイミングで基本ケースも足す。

## 検証

検証ゲート(format / lint / typecheck / test)に加え、実際の拡張で P1〜P4 の再現手順が解消していることを確認する。
