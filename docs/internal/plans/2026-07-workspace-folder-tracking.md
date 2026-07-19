# 修正計画: workspace folder 数の実行時変化への追従

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。

## 問題

workspace folder 数を activate 時に 1 回しか評価しておらず、実行時の増減に追従しない。【確信度: 高(挙動は明確。仕様はこのケースを未定義)】

- **場所**: `packages/extension/src/extension.ts`(調査時点 34〜43、151〜154 行)
- **内容**: `onDidChangeWorkspaceFolders` を購読していないため:
  - 0 または複数 folder で起動後に 1 folder になっても、リロードするまで全コマンドが「requires exactly one workspace folder」エラーを出し続ける(enablement は `workspaceFolderCount == 1` で UI 上は有効に見えるのに、実行すると失敗する)。
  - 1 folder → 複数になっても watcher・store は旧 root に張り付いたままになる。

## Phase 0: 調査

1. 実機で再現する(folder の追加・削除を伴う両方向)。
2. 仕様を決めて `extension.md` に明文化する(Spec-First)。候補:
   - **案 A**: `onDidChangeWorkspaceFolders` で全リソース(store / watcher / provider / panel)を再初期化または破棄する。
   - **案 B**: folder 構成が変わったら「リロードが必要」通知を出すに留める(VS Code 拡張として一般的な妥協案。実装コスト小)。
3. 案 A の場合、activate 時に構築している disposable 群を再構築可能な形に括り出せるか(現在の `activate` の構造で足りるか)を確認する。

## Phase 1: 修正

Phase 0 で決めた案を実装する。

## Phase 2: テスト

- folder 数の変化イベント後に、コマンド実行が新しい構成を反映することのテスト(案 A の場合)。または通知が出ることのテスト(案 B の場合)。

## 検証

検証ゲートに加え、実機で folder 追加・削除の前後にコマンドを実行して確認する。
