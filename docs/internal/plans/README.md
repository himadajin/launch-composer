# Launch Composer - 修正計画一覧(2026-07 調査)

## この一覧について

2026-07-19 時点(commit `22a58d5`)のコードベース全体調査で見つかった問題に対する修正計画の索引である。調査は core / extension / webview の 3 パッケージを対象に行い、静的検証(lint / typecheck / 全テスト)はすべてパスする状態で、コードレビューにより検出した。

各計画は**問題提起**として書かれている。調査時点で深掘りしきっていない事項は各計画の Phase 0(調査)に明記してあり、着手時にまず Phase 0 を実施して再現・影響範囲・修正方針を確定させること。Phase 0 の結果、問題が誤認または既に解消済みと判明した場合は、その旨を記録して計画をクローズしてよい。

## 共通の進め方

1. **位置の参照はシンボル名を正とする。** 行番号は調査時点の目安であり、ずれていたらシンボル名で探すこと。
2. **着手前に対象コードが調査時点(`22a58d5`)から変わっていないかを確認する。**
3. **各変更後に検証ゲートを通す**: `npm run format` / `npm run lint` / `npm run typecheck` / `npm run test`(`AGENTS.md` の必須ゲート)。
4. **Spec-First Change Routing に従う。** 観測可能な挙動が変わる修正は、`docs/internal/specs/` / `docs/internal/contracts/` の該当文書の更新とセットで行う。仕様が無規定の領域(各計画に明記)は、コードを直す前に仕様を決めて文書化する。
5. **完了した計画はファイルを削除し、残った設計判断は `docs/internal/pending.md` に移す**(前回 2026-07 リファクタリング計画と同じライフサイクル)。

## 計画一覧

優先度は調査時点の暫定評価(実害の大きさ × 確信度)。

### 優先度: 高

- [webview エディタ state のエントリ間分離](./2026-07-webview-editor-state-isolation.md): エントリ切替時に編集中テキストが別エントリに書き込まれる、rename 失敗時に表示が復元されない、ほか。
- [core 検証の入力ガード](./2026-07-core-validation-input-guards.md): 手編集 JSON の `null` エントリ等で検証が未処理例外でクラッシュする。
- [TreeView reveal の修正](./2026-07-treeview-reveal.md): エディタを開いた際のツリー項目選択(`reveal`)が常に no-op であり、`getParent` も未実装。
- [Watcher エコーフィルタの期待リーク](./2026-07-watcher-echo-filter-leak.md): 書き込みが発生しなかった操作でも「次のイベントを無視する」期待が登録され、後の本物の外部編集が飲み込まれる。
- [kind 横断の generate 診断更新](./2026-07-sync-cross-kind-diagnostics.md): profile 側の変更で config ツリーの参照切れ警告が更新されない。

### 優先度: 中

- [Host/Webview のエラー応答契約](./2026-07-host-webview-error-contract.md): host 側エラー時に RPC 応答が返らず webview が 30 秒固まる、保存失敗が無言で握りつぶされ未保存 state が永続化される、ほか。
- [webview 保存キューの revision 整合](./2026-07-webview-update-queue-revision.md): エントリ切替・conflict 時に古い revision が使われ、不要な conflict の連鎖と表示巻き戻りが起きる。
- [webview の CSP 追加](./2026-07-webview-csp.md): webview HTML に Content-Security-Policy がない。
- [データファイル名の検証](./2026-07-data-file-name-validation.md): `file` パラメータとプロンプト入力がパス区切り・`../` を拒否しない。
- [extension mutation の整合性](./2026-07-extension-mutation-integrity.md): read-modify-write の非排他、invalid ファイルの参照無視、rename の部分失敗、空パス patch による name ガード迂回、ほか。
- [core merge の参照共有と仕様乖離](./2026-07-core-merge-aliasing.md): 生成結果が入力配列・ネストオブジェクトと参照を共有する。

### 優先度: 低

- [Command Palette 露出の仕様乖離](./2026-07-command-palette-exposure.md): `openActiveEditorJson` が仕様に反して Palette に露出している。
- [workspace folder 数の実行時変化への追従](./2026-07-workspace-folder-tracking.md): folder 数を activate 時にしか評価していない。

## 計画間の関係

- 各計画は独立に着手できるが、[webview エディタ state のエントリ間分離](./2026-07-webview-editor-state-isolation.md) と [webview 保存キューの revision 整合](./2026-07-webview-update-queue-revision.md) と [Host/Webview のエラー応答契約](./2026-07-host-webview-error-contract.md) は同じ保存パイプライン(`useEditableField` → `useEntryUpdateQueue` → RPC → host mutation)に触れるため、並行して進める場合は互いの変更を確認すること。
- [Watcher エコーフィルタの期待リーク](./2026-07-watcher-echo-filter-leak.md) は `docs/internal/pending.md` の「Align watcher patterns with the store's read scope」(E-3)と同じコンポーネントに触れる。
- [Host/Webview のエラー応答契約](./2026-07-host-webview-error-contract.md) は `docs/internal/pending.md` の「Unify the editorPanel mutation error policy」(E-1)を包含する形で解決するのが自然である。
