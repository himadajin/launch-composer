# 修正計画: webview の CSP 追加

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。

## 問題

エディタパネルの webview HTML に `Content-Security-Policy` がない。【確信度: 高(欠落自体は事実。悪用可能性は webview 側実装に依存)】

- **場所**: `packages/extension/src/webview/editorPanel.ts` の HTML 生成(調査時点 472〜496 行、fallback HTML 含む)、`packages/extension/src/webview/webviewHtml.ts`、`packages/webview/index.html`
- **内容**: CSP meta も nonce もリポジトリ全体で 0 件。`enableScripts: true` の webview で CSP なしは VS Code のセキュリティガイドライン違反であり、webview 内に何らかの injection ベクタができた場合に外部リソース読み込み・スクリプト実行を許す。`localResourceRoots` の限定だけでは不十分。

## Phase 0: 調査

1. VS Code 公式の webview セキュリティガイド(`https://code.visualstudio.com/llms.txt` 経由で該当ページ)を確認し、推奨 CSP(`default-src 'none'` + `script-src 'nonce-...'` + `style-src ${webview.cspSource}` 等)を把握する。
2. Vite ビルド出力(script / stylesheet / インライン style の有無)を確認し、必要なディレクティブを確定する。`rewriteWebviewHtml` が nonce 注入を担えるか確認する。
3. `@himadajin/vscode-components` がインライン style 等 CSP に抵触する挙動を持たないか確認する。

## Phase 1: 修正

- HTML 生成時に nonce を発行し、CSP meta タグと script タグへの nonce 付与を行う。fallback HTML にも同じ CSP を適用する。
- `rewriteWebviewHtml` を拡張する場合は純関数のまま保ち、既存テストの流儀でフィクスチャテストを足す。

## Phase 2: テスト

- 生成 HTML に CSP meta と nonce が含まれることのテスト(`webviewHtml.test.ts` に追加)。

## 検証

検証ゲートに加え、実機で webview が表示・動作すること(CSP 違反が Developer Tools コンソールに出ないこと)を確認する。
