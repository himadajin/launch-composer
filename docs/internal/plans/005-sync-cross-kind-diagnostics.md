# 修正計画: kind 横断の generate 診断更新

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 完了(commit `f6ded80`)。

## 問題

watcher イベント起点の sync が kind 限定(`sync({kind: 'profile'})` → profileProvider のみ refresh)で行われるため、**profile 側の変更が引き起こす config 側の generate 診断の変化が config ツリーに反映されない**。【確信度: 高】

- **場所**: `packages/extension/src/extension.ts` の watcher 購読(調査時点 68〜78 行)、`packages/extension/src/sync/workspaceSyncController.ts` の `applySnapshot`(調査時点 80〜95 行)
- **内容**: profile ファイルの変更(外部編集での profile 名変更・削除など)は、config 側の診断(`generateReadiness.diagnostics` のうち `target.kind: 'config'` の参照切れ警告)を変化させる。しかし profile の watcher イベントでは profileProvider しか refresh されないため、CONFIGS ツリーの警告アイコン・"N issues" 表示が config 側のイベントが起きるまで古いまま残る。参照切れ診断は config ツリーにしか表示されないため、**ユーザーにはどこにも警告が出ない**ケースになる。
- 逆方向(config 側の変更が profile 側の表示に影響するケース)があるかは調査時点で未確認。

## Phase 0: 調査

1. 実機で再現する: config が参照する profile を外部エディタで rename → CONFIGS ツリーに参照切れ警告が出ないこと。config 側のファイルに触ると警告が現れること。
2. `generateReadiness` の診断のうち kind をまたいで変化しうるものを列挙する(参照切れ、名前衝突、argsFile 競合など)。逆方向の陳腐化も確認する。
3. 修正方針を決める。候補:
   - **snapshot は常に全体を読み、両 provider を refresh する**(kind 限定 sync を廃止)。読み取りは既に `readAll` ベースなのでコストは限定的なはずだが、Phase 0 で確認する。
   - kind 限定の読み取りは維持し、`generateReadiness` の diff 等で反対側 provider の refresh 要否を判定する(複雑さに見合うかを評価)。
4. `docs/internal/specs/extension.md` の sync に関する記述を確認し、「watcher イベントは両ツリーの generate 診断を最新化する」ことを明文化する。

## Phase 1: 修正

Phase 0 で決めた方針を実装する。webview(editorPanel)への workspace-update も同じ snapshot から配られるため、影響がないか(むしろ改善になるか)確認する。

## Phase 2: テスト

- profile ファイルの変更イベント後に、config 側ツリーの診断デコレーションが更新されることのテスト(既存の treeProvider / extensionCommands テストの流儀に合わせる)。

## 検証

検証ゲートに加え、Phase 0 の再現手順が解消していることを実機確認する。

## 完了記録

- kind 限定の読み取りは維持しつつ、再構成した全体 snapshot を常に両 provider へ適用する方針を採用した。webview にも反対 kind の更新を配り、全体の generate readiness を最新化する。
- profile の部分更新で config の参照切れ診断が再計算され、両ツリーへ反映されることと、反対 kind の更新が開いているエディタを誤って閉じないことを回帰テストで確認した。
- 手動の profile rename 確認は未実施だが、controller/provider/editor の接続を含む extension テストで同じ snapshot 更新経路を検証した。
- 必須検証ゲートはすべて成功した。
