# 修正計画: データファイル名の検証

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。

## 問題

Host/Webview 契約(`docs/internal/contracts/host-webview.md`)は「`file` は composer directory 内のファイル名であり、絶対パスではない」と定めるが、host 側にこれを強制する検証が**どこにもない**。【確信度: 中(実害シナリオはユーザー入力経由が主)】

- **場所**: `packages/extension/src/io/workspaceLayout.ts` の `normalizeFileName`(調査時点 10〜17 行)と `getDataFileUri`(同 55〜60 行)、およびファイル追加/rename のプロンプト(`packages/extension/src/commands/handlers.ts` 調査時点 191〜203、235〜252 行)
- **内容**:
  - `normalizeFileName` は trim と `.json` 付与のみで、`../` やパス区切りを拒否しない。
  - webview からの `open-file-json` / `update-*` / `delete-*` の `payload.file` に `../../foo` を渡すと composer directory 外の JSON の読み書き・エントリ削除ができる。webview は自前コードだが、契約を強制する防御層がゼロという状態。
  - ユーザー入力経路では、ファイル追加/rename プロンプトに `sub/foo` や `../foo` を入力すると、監視ディレクトリ外・一覧(`listFiles` は直下のみ)に出ないファイルが作られ、ツリーに現れない/rename でファイルが「消えた」ように見える。

## Phase 0: 調査

1. 上記の各経路(webview payload、追加プロンプト、rename プロンプト)で実際に何が起きるかを確認し、影響を記録する。
2. 検証ルールを決めて文書化する(Spec-First):
   - 許可するファイル名の形(例: パス区切り・`..`・先頭ドット・予約文字を拒否。既存の unicode ファイル名サポートは維持)。
   - 検証をどこに置くか: プロンプトの `validateInput`(ユーザー向け即時フィードバック)と、`getDataFileUri` 直前の共通ガード(webview 経由を含む全経路の防御)の両方が候補。
   - 不正な `file` を受けた際の応答(mutation の失敗 response / エラートースト)。
3. `contracts/host-webview.md` と `specs/extension.md` に検証ルールを追記する。

## Phase 1: 修正

共通のファイル名検証関数を実装し、プロンプトと host 側受信経路の両方に適用する。

## Phase 2: テスト

- `../foo`・`sub/foo`・絶対パス・空文字などが全経路で拒否されることのテスト。
- 既存の unicode ファイル名テスト(`createDataFile supports unicode file names ...`)が通り続けることの確認。

## 検証

検証ゲートに加え、プロンプトに不正な名前を入れた際にその場で検証メッセージが出ることを実機確認する。
