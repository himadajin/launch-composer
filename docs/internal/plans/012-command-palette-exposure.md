# 修正計画: Command Palette 露出の仕様乖離

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 完了(commit `d84663e`)。

Phase 0 の結果(2026-07-26): 全コマンドを突き合わせ、乖離は `openActiveEditorJson` の 1 件のみだった。露出を意図した変更履歴もないため、仕様どおり隠した。manifest テストは「仕様の 3 コマンド以外はすべて hidden」の網羅検査に置き換えた。

## 問題

`docs/internal/specs/extension.md`(調査時点 317〜331 行)は Command Palette に出すコマンドを `generate` / `init` / `addProfile` の 3 つに限定し、その他は隠すと定めるが、`launch-composer.openActiveEditorJson` が `packages/extension/package.json` の `menus.commandPalette` の hidden リストに含まれておらず、Palette に露出している。【確信度: 高】

- パネル未オープン時に実行すると `openCurrentAsJson` が黙って no-op(`editorPanel.ts` 調査時点 83〜85 行)のため、「実行しても何も起きないコマンド」が Palette に見える状態。
- `test/manifest.test.ts`(調査時点 163〜178 行)は hidden 指定を 2 コマンド(includeAll / excludeAll)しか検査していないため検出されない。

## Phase 0: 調査

1. `extension.md` の Palette 節と `package.json` の `menus.commandPalette` を突き合わせ、`openActiveEditorJson` 以外に乖離がないか全コマンドを確認する。
2. 隠す方針で問題ないか確認する(仕様が正のはずだが、露出を意図した変更履歴がないか git log を見る)。

## Phase 1: 修正

- `menus.commandPalette` に `openActiveEditorJson` の `"when": "false"` エントリを追加する(既存の hidden コマンドと同じ流儀)。

## Phase 2: テスト

- `manifest.test.ts` の Palette 検査を「仕様の 3 コマンド以外はすべて hidden であること」の網羅検査に書き換え、今後の乖離を構造的に防ぐ。

## 検証

検証ゲートに加え、実機の Command Palette で `Launch Composer:` を検索し、表示が仕様の 3 コマンドだけになることを確認する。
