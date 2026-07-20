# 改修計画: CONFIGS/PROFILES の単一ビュー統合

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-20、commit `ffd2b61`(branch `feat-single-pane`)。状態: 進行中。

001〜013 と異なり、本計画はバグ修正ではなく UX 改修である。調査は Extension Development Host 上での実機操作(profile 2 件・config 15 件のサンプルワークスペース)に基づく。

## 背景と問題

現在の Launch Composer は Activity Bar のビューコンテナ内に `CONFIGS` と `PROFILES` の 2 つの TreeView を持つ。config と profile は 1 対多の参照関係で強く依存し合っているにもかかわらず、UI は両者を対等な独立リストとして分離しており、実機操作で以下の問題を確認した。

1. **参照関係が不可視**: config がどの profile をベースにするかはエディタを開くまで分からない。profile 側にも被参照数の表示がない。
2. **診断の非対称**: profile 名の変更で参照が切れると CONFIGS 側の全該当エントリに warning が並ぶ一方、原因のある PROFILES 側は正常表示のまま。修復先へ誘導する導線もない。
3. **縦スペースの奪い合い**: 2 ペインがサイドバー高さを分割するため、エントリ数が偏る(実運用では config 多数になりがち)と少数側ペインが圧迫され、少数時は空白が残る。
4. **同一アイコンのアクション重複**: 各ペインタイトルの「+」(file 作成)と file 行インラインの「+」(entry 追加)が近接し、意味の違う「+」が計 4 つ並ぶ。Generate `▷` は CONFIGS タイトルにのみあるが、生成は両 kind のデータを使う。
5. **選択状態の二重化**: エディタパネルは単一なのに TreeView の選択はペインごとに独立し、config → profile と開くと両ペインにハイライトが残る。
6. **初期セットアップの分断**: 空ワークスペースでは両ペインに別々の `viewsWelcome` が出て、初期化が 2 ペイン × 2 操作に分かれる。config 追加時の profile 選択 QuickPick も、判断材料(profile の中身)が別ペインにある。

## 採用する設計

2 つの TreeView を廃止し、単一ビューの中にセクションノードを持つ 3 階層ツリーへ統合する。「file → entry」というデータ実体とツリー構造の対応(および `ui.md` の file/entry node 仕様の大部分)は温存する。

```
LAUNCH COMPOSER                          [+ ▷]   ← view title: Add(QuickPick) / Generate
├─ ▼ Configs                              [+]    ← セクション(仮想ノード): Add Config File
│   └─ ▼ config.json                      [+]    ← file node(現行仕様を踏襲): Add Config
│       ├─ ☑ run: dev        node-app
│       └─ ☐ run: prod       excluded, node-app
└─ ▼ Profiles                             [+]    ← セクション: Add Profile File
    └─ ▼ profile.json                     [+]
        └─ node-app          2 configs
```

- セクション折りたたみが現行のペイン折りたたみを代替し、スクロール・選択・タイトルアクションが 1 本化される(問題 3・4・5 の解消)。
- `viewsWelcome` は 1 件になり、既存の `launch-composer.init` にリンクしてワンクリック初期化にする(問題 6 の解消)。
- config entry 行の description に参照 profile 名、profile entry 行に被参照数を表示し、config entry から profile へのナビゲーション導線を追加する(問題 1・2 の解消)。

**不採用案**: profile ノード配下に参照 config をネストする profile 中心ツリーは、関係可視化としては最強だが、(a) config entry のツリー位置が JSONC 上の実体(`configs/*.json` の file → entry)と乖離し file 単位の操作・invalid file 表示の置き場を失う、(b) missing profile 参照や profile 未指定 config のための例外バケツが必要になる、(c) `ui.md` の file node 仕様のほぼ全面改訂になる、ため採らない。

## 決定事項(2026-07-20)

- **セクションの並び順は `Configs` を上**とする。現行の manifest 定義順を踏襲し、チェックボックス切り替えなど日常操作の頻度が高い config 側を上に置く。
- **config 行の参照 profile 名は常時表示**とする。`excluded`・`N issues` とはカンマ併記。
- **Phase 3(関係可視化)は Phase 2 完了後に本計画内で続けて実施**する(統合のみで区切らない)。
- **命名(Phase 0 で確定)**: view ID は `launchComposer.explorer`、表示名は `Launch Composer`。セクション contextValue は既存の単数形 kind プレフィックス規約(`profileFile` / `configEntryEnabled` 等)に合わせ **`configSection` / `profileSection`**、TreeItem.id は `section:config` / `section:profile`(固定 id で折りたたみ状態を保持)。view title の振り分けコマンドは **`launch-composer.add`**(title `Add...`、icon `$(add)`、Command Palette からは `"when": "false"` で隠す)。QuickPick 項目は既存コマンド title の語彙を再利用し「**Add Config / Add Profile / Add Config File / Add Profile File**」(「New ...」は既存 manifest・welcome 文言と不整合になるため不採用)。既存 `launchComposer.configs` / `launchComposer.profiles` は廃止する(ユーザーのサイドバー配置カスタムの記憶は破棄されるが実害なし)。
- **空状態(Phase 0 で確定)**: `viewsWelcome` は root の `getChildren` が `[]` のときだけ表示されるため、「profile / config の file と issue がすべて 0 件」のとき root で `[]` を返して単一 welcome(`launch-composer.init` リンク)を出す。**片側 kind だけ空の場合はセクションを空のまま表示**し、プレースホルダ子要素は追加しない(file 作成導線はセクション行のインライン「+」)。
- **QuickPick からの Add Config フロー(Phase 0 で確定)**: profile 側の既存フロー(`selectOrCreateFile` → entry 追加)と同型に、config 版も「file 選択 or 新規作成 → profile 選択 → 名前入力」とする(既存 `addDataEntry('config', file)` の前段に file 選択を足すだけ)。Phase 1 で `extension.md` に仕様として明文化する。
- **計画 012 との関係**: 014 に吸収せず独立のまま 014 を先行させる。新コマンド `add` は Palette hidden で登録し、012 側は行番号ずれ程度の rebase で済む。

## 進め方(体制・レビュー・コミット)

本計画は複数 Phase にまたがるため、実施体制と運用を以下に固定する。

### 体制

- **オーケストレーター兼レビュワー**: メインセッションの Claude。計画・仕様判断の管理、タスク分解と指示、全 diff のレビュー、検証ゲートの実行、Extension Development Host での実機確認、ブランチ作成とコミットを担う。
- **実装者**: 単一のサブエージェント。Phase をまたいで同一エージェントに継続指示し、コードベースの知見を蓄積させる。仕様改訂文のドラフト、コード・テストの編集はすべて実装者が行う。Phase 0 の調査タスクも同じ実装者に割り当て、以降の Phase の前提知識にする。
- 実装者はコミット・push を行わない。コミットはレビュワーだけが行う。レビューをサブエージェントに委譲しない。
- 実装者のセッションが失われた場合は、本計画ファイル(決定事項・進捗記録を含む)と関連 spec を初期コンテキストとして新しい実装者を起動する。このため各 Phase の完了時に、得られた知見・注意点を下記「進捗記録」へ外部化する。

### レビュー手順

各タスク完了時、レビュワーは次を確認してからコミットする。

1. `git diff` を直接読む(実装者の完了報告だけで判断しない)。
2. 仕様との一致: Phase 1 で確定した `ui.md` / `extension.md` の記述と実装・テストが一致しているか。仕様に書いていない挙動を実装が勝手に決めていないか(Spec-First Change Routing)。
3. `AGENTS.md` のガードレール: パッケージ境界、jsonc-parser ベースの JSON 編集、`.js` import 指定子、成功/失敗パス両方のテスト。
4. 検証ゲート(`npm run format` / `npm run lint` / `npm run typecheck` / `npm run test`)を通す。
5. UI 挙動が変わる Phase(2・3)の完了時は、Extension Development Host で本計画「背景と問題」の再現手順(多数 config + profile rename)を実機確認する。
6. 指摘がある場合は同じ実装者へ差し戻し、修正後に再レビューする。

### ブランチとコミット

- 作業ブランチは `feat-single-pane`(作成済み)。**リモートへの push は行わない**。push・PR 作成はユーザーが行う。
- コミットは「検証ゲートが green で、単独でレビュー可能な 1 単位」ごとに行う。Conventional Commits に従う。
- 予定するコミット列(レビューの結果、分割・統合してよい):
  1. `docs:` 本計画の追加と台帳更新
  2. `docs:` Phase 0 の成果(命名確定・干渉確認の結果)の本計画への追記、および `ui.md` / `extension.md` の構造統合改訂(Phase 1)
  3. `feat:` 単一ビュー統合の実装とテスト(Phase 2。manifest / provider / extension.ts / handlers は同時に変更しないと動作しないため 1 コミット)
  4. `feat:` 関係可視化の description 表示(Phase 3 前半: profile 名・被参照数)
  5. `feat:` Go to Profile と webview からの profile ジャンプ(Phase 3 後半)
- 各 Phase 完了時に本計画の進捗記録更新を同じコミットに含め、台帳の状態列と同期させる。

### 進捗記録

- 2026-07-20: Phase 2 完了。単一ビュー統合を実装(manifest / commands.ts / provider.ts / extension.ts / handlers.ts、テスト 3 ファイル改修・新規 8 テスト)。検証ゲート全パス(148 テスト)。レビュー時の採用判断: QuickPick placeholder `Choose what to add`、file 作成フローの `createDataFile(kind)` 共通化(仕様の「同じ file 作成フロー」を関数共有で保証)。実機確認済み: 3 階層表示・タイトル QuickPick(4 項目・キャンセル無変更)・kind 横断の単一選択・checkbox 書き込み・セクション折りたたみの refresh 跨ぎ保持・welcome 2 態と Initialize リンク・セクション inline「+」。未検証: 折りたたまれた祖先を跨ぐ reveal の自動展開(Add フローの名前入力を要するため。provider の親チェーンはテストで検証済み。Phase 3 の実機確認で再チェックする)。

- 2026-07-20: 計画作成。決定事項 3 点(セクション順・profile 名常時表示・Phase 3 継続実施)を確定。
- 2026-07-20: Phase 1 完了。`ui.md`(UI 構成 / 空状態 2 態 / section node 新設 / view title の Add QuickPick / inline actions / checkbox / reveal)と `extension.md`(単一 TreeView / Add QuickPick フロー / コマンド一覧)を改訂。起草時の判断: welcome 文言は `No profile or config files found. [Initialize Launch Composer](command:launch-composer.init)`、section node は context menu を提供せず inline「+」のみ、invalid file だけが存在する場合は welcome を出さない、Add Config の profile 0 件チェックは file 選択後(既存実装順)。
- 2026-07-20: Phase 0 完了(実装者による調査をレビュー・裏取りの上で採用)。命名・空状態・Add Config フロー・012 との進め方を確定し、影響範囲とテスト改修対象を Phase 1・2 に注記。実装者の主要な発見: `manifest.test.ts` が commands 配列順と `COMMANDS` 定義順の deepEqual を要求、テスト stub の `reveal` は `getParent` 実装が必須、`workspaceSyncController` は変更不要、既存 id 体系は kind 修飾済みで統合しても衝突なし。

## Phase 0: 設計確定(実施済み 2026-07-20)

1. 命名(view ID / セクション context / QuickPick 文言)を確定し、本計画に追記する。→ 決定事項に反映済み。
2. 影響範囲の確認: `package.json` manifest(views / menus / viewsWelcome / commandPalette)、`treeview/provider.ts`、`extension.ts` の TreeView 初期化、`commands/handlers.ts`、`sync/workspaceSyncController.ts` の provider refresh 経路。→ 実施済み。`workspaceSyncController.ts` は変更不要([005](./005-sync-cross-kind-diagnostics.md) 以降 sync は常に全体 snapshot を both 適用しており、単一 provider への refresh に自然に縮退する)。既存 TreeItem.id / entryNodes キーはすべて kind 修飾済みで、統合による id 衝突はない。詳細は Phase 1・2 の注記に反映済み。
3. 関連計画との干渉確認。→ 実施済み。台帳の「計画間の関係」および決定事項(012)に反映。006 とは Phase 3 の新 message 追加で接点があるため、仕様化時に 006 の「全 request に必ず response」方針を先取りする。

## Phase 1: 仕様改訂(構造統合)

Spec-First Change Routing に従い、実装前に仕様を確定させる。

1. `docs/internal/specs/ui.md`: 「UI 構成」「TreeView」(空状態・セクションノード・view title actions・item context menu・checkbox 操作)を単一ビュー 3 階層構造へ改訂する。file node / entry node の挙動仕様は原則維持し、所属ビューへの言及をセクションへ置き換える。空状態は「全空 → 単一 welcome(`launch-composer.init` リンク)」「片側空 → 空セクションのまま(プレースホルダなし)」の 2 態を明記する。セクション行のインラインアクション(Add Config File / Add Profile File)も定義する。
2. `docs/internal/specs/extension.md`: TreeView 登録・コマンド一覧・sync の記述を更新する。具体差分: `launch-composer.add`(QuickPick 振り分け、Palette hidden)の追加、`addProfileFile` / `addConfigFile` の起点変更(view title → セクション inline)、QuickPick からの Add Config フロー(file 選択 or 新規作成 → profile 選択 → 名前入力)の明文化。
3. `docs/internal/specs/README.md` のパッケージ責務記述に影響があれば追従する。
4. TreeView 単一化により `reveal` が kind 横断で一意になることを仕様として明記する(`TreeView.reveal` の挙動は [003](./003-treeview-reveal.md) の成果を引き継ぐ)。

## Phase 2: 実装(構造統合)

1. `package.json` manifest: views を 1 件に、`view/title` / `view/item/context` / `viewsWelcome` / `commandPalette` を新 view ID・セクション context に合わせて書き換える。
2. `treeview/provider.ts`: kind 別 2 インスタンス構成を単一 provider に変更。`TreeNode` に `SectionNode` を追加し、`getChildren` / `getParent` / `reveal` を section → file → entry の 3 階層に対応させる。実装上の制約: (a) `TreeView.reveal` は `getParent` の返す親と `getChildren` の返す要素の同一性に依存するため、SectionNode は refresh を跨いで同一インスタンスをフィールドに保持し、固定 id `section:<kind>` を付ける。(b) snapshot 未設定時の `store.readAll()` フォールバックがセクションごとに走らないよう、root 呼び出し時に一括 read して保持する。(c) `FileNode` の shape 変更はテストヘルパのリテラル構築(`configFileNode()` 等)を壊すため、parent 参照を持たせる場合は optional にする。
3. `extension.ts` / `sync/workspaceSyncController.ts`: TreeView 生成と refresh を 1 系統に統合する([005](./005-sync-cross-kind-diagnostics.md) で導入した「全体 snapshot を両 kind に適用する」経路はそのまま単一 provider への適用になる)。
4. `commands/handlers.ts`: view title「+」の QuickPick 振り分けコマンドを追加する。既存の addFile / addEntry / file・entry 操作コマンドは流用する。
5. テスト: provider の 3 階層構造・セクション context・reveal・welcome 条件(root 空判定)・QuickPick 振り分けを extension テストの流儀で追加/更新する。既存テストの改修対象: `treeProvider.test.ts`(コンストラクタと階層前提の全面改修)、`manifest.test.ts`(views / when 句 / commands 配列 / inline menu の期待値。`views.explorer === undefined` の assertion は新 view ID と紛らわしいため書き換える)、`extensionCommands.test.ts`(`getCreatedTreeView` の view ID)。注意: `manifest.test.ts` は `contributes.commands` の配列順と `COMMANDS` 定義順の deepEqual を検査するため、新コマンドの挿入位置を両方で揃える。

## Phase 3: 関係可視化(仕様改訂 + 実装)

1. 仕様: `ui.md` に config entry の profile 名 description・profile entry の被参照数 description・「Go to Profile」context menu を定義する。webview エディタからの profile ジャンプ導線は `communication.md` / `docs/internal/contracts/host-webview.md` への影響を確認して定義する。
2. 実装: description 合成(既存 `applyDiagnosticDecoration` の `appendDescription` に統合)、被参照数の算出(snapshot 内の config → profile 参照の集計)、`Go to Profile` コマンド(reveal + エディタ切替)、webview 側リンク。
3. テスト: 参照切れ時の description・被参照数・ナビゲーションの成功/失敗パス。

## 検証

各 Phase の変更後に必須検証ゲート(`npm run format` / `npm run lint` / `npm run typecheck` / `npm run test`)を通す。Phase 2・3 の完了時には Extension Development Host での実機確認を行い、背景の問題 1〜6 が解消していることを本計画の再現手順(多数 config + profile rename)で確認する。実機確認には次を含める: エディタを開いた際の 3 階層 reveal(VS Code の reveal 展開は最大 3 レベルであり section → file → entry はその上限。テスト stub では実挙動を検証できない)、welcome の 2 態(全空 / 片側空)、checkbox 操作、セクション折りたたみ状態の refresh 跨ぎ保持。
