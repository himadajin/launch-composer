# Launch Composer - 修正計画(plans)

## この一覧について

このディレクトリは、調査で見つかった問題に対する修正計画を 1 問題 1 ファイルで管理する。このファイルは全計画の**台帳**である。計画の追加・状態変更時は必ずこのファイルを同時に更新する。

各計画は**問題提起**として書かれている。深掘りしきっていない事項は各計画の Phase 0(調査)に明記してあり、着手時にまず Phase 0 を実施して再現・影響範囲・修正方針を確定させること。Phase 0 の結果、問題が誤認または既に解消済みと判明した場合は、その旨を記録して計画をクローズしてよい。

## 運用ルール(付番・追加・完了)

1. **ファイル名は `NNN-<slug>.md`**(3 桁ゼロ埋め連番 + 短い kebab-case スラッグ)。
2. **番号は作成順の通し番号。** 新しい計画の番号は、**既存プランファイルの最大番号 + 1** とする(ファイルは削除しないため、ディレクトリを見れば一意に決まる)。番号の再利用・振り直しはしない。
3. **番号に意味を持たせない。** 優先度・カテゴリ・日付は番号に埋め込まず、この台帳で管理する。調査時点(日付と commit)と状態は各計画ファイルの冒頭に記す。
4. **状態は 3 値**: 「未着手」「進行中」「完了(commit `xxxxxxx`)」。計画ファイル冒頭の状態と[台帳](#台帳)の状態列を常に一致させる。
5. **計画を追加するとき**: ファイルを作成し(状態: 未着手)、[台帳](#台帳)に行を追加する。既存計画と依存・干渉があれば[計画間の関係](#計画間の関係)にも追記する。
6. **計画が完了したとき**: ファイルは削除せず、冒頭の状態を「完了(修正 commit を記す)」に更新し、台帳の状態列も更新する。実装しないと決めた設計判断が残る場合は `docs/internal/pending.md` へ移す。
7. **完了した計画は歴史的記録である。** 本文中の行番号や「〜が壊れている」という記述は作成時点のものであり、現状として扱わないこと。

## 共通の進め方

1. **位置の参照はシンボル名を正とする。** 行番号は計画作成時点の目安であり、ずれていたらシンボル名で探すこと。
2. **着手前に対象コードが計画冒頭に記された調査時点の commit から変わっていないかを確認する。**
3. **各変更後に検証ゲートを通す**: `npm run format` / `npm run lint` / `npm run typecheck` / `npm run test`(`AGENTS.md` の必須ゲート)。
4. **Spec-First Change Routing に従う。** 観測可能な挙動が変わる修正は、`docs/internal/specs/` / `docs/internal/contracts/` の該当文書の更新とセットで行う。仕様が無規定の領域(各計画に明記)は、コードを直す前に仕様を決めて文書化する。

## 台帳

優先度は計画作成時点の暫定評価(実害の大きさ × 確信度)。001〜013 は 2026-07-19 時点(commit `22a58d5`)のコードベース全体調査に基づく。調査時、静的検証(lint / typecheck / 全テスト)はすべてパスしており、問題はコードレビューにより検出した。

| 番号 | 計画                                                                               | 優先度 | 状態                   | 概要                                                                                                     |
| ---- | ---------------------------------------------------------------------------------- | ------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 001  | [webview エディタ state のエントリ間分離](./001-webview-editor-state-isolation.md) | 高     | 完了(commit `ff28fa8`) | エントリ切替時に編集中テキストが別エントリに書き込まれる、rename 失敗時に表示が復元されない、ほか        |
| 002  | [core 検証の入力ガード](./002-core-validation-input-guards.md)                     | 高     | 進行中                 | 手編集 JSON の `null` エントリ等で検証が未処理例外でクラッシュする                                       |
| 003  | [TreeView reveal の修正](./003-treeview-reveal.md)                                 | 高     | 進行中                 | エディタを開いた際のツリー項目選択(`reveal`)が常に no-op、`getParent` も未実装                           |
| 004  | [Watcher エコーフィルタの期待リーク](./004-watcher-echo-filter-leak.md)            | 高     | 進行中                 | 書き込みが発生しなかった操作でも「次のイベントを無視する」期待が登録され、本物の外部編集が飲み込まれる   |
| 005  | [kind 横断の generate 診断更新](./005-sync-cross-kind-diagnostics.md)              | 高     | 進行中                 | profile 側の変更で config ツリーの参照切れ警告が更新されない                                             |
| 006  | [Host/Webview のエラー応答契約](./006-host-webview-error-contract.md)              | 中     | 未着手                 | host 側エラー時に RPC 応答が返らず webview が 30 秒固まる、保存失敗の無言化と未保存 state の永続化、ほか |
| 007  | [webview 保存キューの revision 整合](./007-webview-update-queue-revision.md)       | 中     | 未着手                 | エントリ切替・conflict 時に古い revision が使われ、不要な conflict の連鎖と表示巻き戻りが起きる          |
| 008  | [webview の CSP 追加](./008-webview-csp.md)                                        | 中     | 未着手                 | webview HTML に Content-Security-Policy がない                                                           |
| 009  | [データファイル名の検証](./009-data-file-name-validation.md)                       | 中     | 未着手                 | `file` パラメータとプロンプト入力がパス区切り・`../` を拒否しない                                        |
| 010  | [extension mutation の整合性](./010-extension-mutation-integrity.md)               | 中     | 未着手                 | read-modify-write の非排他、invalid ファイルの参照無視、rename の部分失敗、ほか                          |
| 011  | [core merge の参照共有と仕様乖離](./011-core-merge-aliasing.md)                    | 中     | 未着手                 | 生成結果が入力配列・ネストオブジェクトと参照を共有する                                                   |
| 012  | [Command Palette 露出の仕様乖離](./012-command-palette-exposure.md)                | 低     | 未着手                 | `openActiveEditorJson` が仕様に反して Palette に露出している                                             |
| 013  | [workspace folder 数の実行時変化への追従](./013-workspace-folder-tracking.md)      | 低     | 未着手                 | folder 数を activate 時にしか評価していない                                                              |

## 計画間の関係

- 各計画は独立に着手できるが、[001](./001-webview-editor-state-isolation.md)・[007](./007-webview-update-queue-revision.md)・[006](./006-host-webview-error-contract.md) は同じ保存パイプライン(`useEditableField` → `useEntryUpdateQueue` → RPC → host mutation)に触れるため、並行して進める場合は互いの変更を確認すること。
- [004](./004-watcher-echo-filter-leak.md) は `docs/internal/pending.md` の「Align watcher patterns with the store's read scope」(E-3)と同じコンポーネントに触れる。
- [006](./006-host-webview-error-contract.md) は `docs/internal/pending.md` の「Unify the editorPanel mutation error policy」(E-1)を包含する形で解決するのが自然である。
