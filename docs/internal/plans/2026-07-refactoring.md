# Launch Composer - リファクタリング計画（2026-07）

## この文書について

このファイルは 2026-07-03 時点（commit `1ade803`）のコードベース全体調査に基づくリファクタリング計画である。実装は将来、調査時点とは別の人（またはエージェント）が行う前提で書いている。

- 各項目は「問題 → 変更内容 → 検証」の形で、意図が独立に理解できるように記述する。
- 位置の参照はシンボル名を正とする。行番号は調査時点の目安であり、ずれていたらシンボル名で探すこと。
- 着手前に、対象コードが調査時点から変わっていないかを確認する。既に解消済みの項目は `[完了]` を付ける。
- 完了した項目は `[完了]` を付け、完了済みであることが後から分かるように残す。全フェーズ完了時はこのファイル自体を削除する。

### 進め方の原則

1. **フェーズ順に進める。** Phase 1（テスト補強）は Phase 2 以降の安全網であり、順序に意味がある。フェーズ内の項目は独立しており、任意の順で小さな PR に分割できる。
2. **各変更後に検証ゲートを通す**: `npm run format` / `npm run lint` / `npm run typecheck` / `npm run test`（`AGENTS.md` の必須ゲート）。
3. **挙動を変えない。** この計画の大半は挙動保存のリファクタリングである。観測可能な挙動が変わる項目は「[挙動変更を伴う項目](#挙動変更を伴う項目仕様更新とセットで行う)」に分離してあり、`AGENTS.md` の Spec-First Change Routing に従って仕様更新とセットで行う。
4. **契約面の変更は同期を守る。** 型契約に触れる場合は `docs/internal/contracts/` が指す canonical TypeScript source とドキュメントを同時に更新する。Host/Webview 契約は Phase 2 で `packages/core/src/contracts.ts` に一元化済みであり、extension/webview 側の re-export へ手書きコピーしない。

## 背景: 調査で判明した構造的課題

コードベース（約 13,000 行）の設計は健全で、パッケージ境界の規律、pure logic と UI の分離、public API を対象とした厚いテストという資産がある。問題は次の 4 テーマに集約される。

1. **型契約の手動三重同期**: `packages/webview/src/types.ts` にあった core 型・extension メッセージ型・`ComposerDataIssue` の手書きコピーは Phase 2 で `packages/core/src/contracts.ts` に一元化済みである。
2. **ホットスポットの肥大化**: サイズ×変更頻度の上位が `workspaceStore.ts`（1,464 行・22 回変更）、`extension.ts`（1,036 行・19 回変更）、`ConfigEditor.tsx`（20 回）、`App.tsx`（15 回）。変更コストが最も高い場所に責務が集中している。
3. **profile / config 対称性によるコピー実装**: profile と config で同じ処理をコピーして書く箇所が extension のコマンド登録、webview のエディタ・updater 群に蓄積している。
4. **テストの穴**: core の `validate.ts` / `variables.ts` / `merge.ts` の未テスト分岐と `treeProvider.test.ts` のテストビルド脱落は Phase 0〜1 で解消済み。webview の React rendering 層は引き続き未テストである。

---

## Phase 0: バグ修正とデッドコード削除 [完了]

低リスクで即効性のある項目。どれも独立に実施できる。

### 0-1. treeProvider.test.ts がテスト実行から脱落している【バグ】 [完了]

- **対象**: `packages/extension/test/build-tests.mjs`
- **問題**: esbuild の `entryPoints` にテストファイル名がハードコードされており、`treeProvider.test.ts`（325 行）が含まれていない。`node --test .test-dist/*.test.js` はビルド済みファイルしか実行しないため、TreeView のテストスイート全体がサイレントに実行されていない。「テストがある」という認識と実態がずれている。
- **変更**: `entryPoints` を `test/*.test.ts` の glob（`fs.readdirSync` などで列挙）に置き換え、新しいテストファイルが二度と脱落しない構造にする。`packages/webview/test/build-tests.mjs` も同じハードコード方式なので同様に glob 化する。
- **検証**: `npm run test -w launch-composer` の実行テスト数が増えることを確認する。treeProvider のテストは長期間実行されていないため、失敗する可能性がある。失敗した場合は原因を確認し、テストまたは実装の修正を独立した変更として扱う。

### 0-2. デッドコードの削除 [完了]

参照ゼロを grep / typecheck で再確認したうえで削除する。

- `packages/extension/src/io/workspaceStore.ts`: `getRelativeComposerPattern`、`isComposerDataFile`、private `readProfileFile`、private `readConfigFile`（`*Result` 版のみ使われている）。
- `packages/extension/src/treeview/provider.ts`: `fileNodes` マップ（書き込みのみで読み手がいない）。
- `packages/webview/src/components/editorUtils.ts`: `updateOptionalArray`、`normalizeDebugRequest`、private `isDebugRequest`（`profileRequestSelect.ts` の `isDebugRequestOption` と重複した概念でもある）。
- `packages/webview/src/components/entryChanges.ts`: `createDeleteIfPresentPatch` の実装シグネチャと同一の冗長なオーバーロード宣言。
- `packages/core/src/index.ts`: `isAbsolutePath` と `buildLaunchConfig` の re-export を削除（モジュール内部・core 内部でのみ使用）。`generate` のシグネチャに現れる型（`GenerateResult` / `LaunchJson` / `LaunchConfig` / `ValidationErrorTarget` / `ArgsFileReader` など）は正当な public API なので残す。`ProfileEntry` / `ConfigEntry` は Phase 2 で webview から import されるようになるため残す。
- **検証**: typecheck とテストが通ること。

### 0-3. TreeView のコマンド ID 文字列リテラルを定数参照にする [完了]

- **対象**: `packages/extension/src/treeview/provider.ts`
- **問題**: `'launch-composer.openProfileFileJson'`、`'launch-composer.openConfigFileJson'`、`'launch-composer.editItem'` が文字列リテラルで埋め込まれている。`src/commands.ts` はコマンド ID を一元管理するために存在しており、ID 変更時にツリーアイテムのコマンドだけがサイレントに壊れる。
- **変更**: `../commands.js` の定数を import して置き換える。
- **検証**: 0-1 で復活した treeProvider テストが通ること。

---

## Phase 1: テスト補強（後続フェーズの安全網） [完了]

Phase 2 以降で触るコードのうち、現在テストがない箇所を先に固める。挙動変更はしない。

### 1-1. core: validate / variables / merge のテスト追加 [完了]

- **対象**: `packages/core/test/` に `validate.test.ts` と `variables.test.ts` を新設
- **問題**: core のテストは `generate.test.ts` の 1 ファイルのみ。以下が未テストである。
  - `validate.ts` のフィールド形状チェック: profile の name 必須 / args 配列 / configuration オブジェクト / type 必須、config の name 必須 / excluded boolean / argsFile string / args 配列 / configuration オブジェクト
  - 名前重複エラーの profile-only / config-only メッセージ変種（mixed のみテスト済み）
  - argsFile リーダーのエラー系全部: リーダー未提供、`not-found`、`error`、内容の形状不正
  - `variables.ts`: 未サポート変数エラー、`workspaceFolder` 欠落エラー、`isAbsolutePath` の UNC パス分岐
  - `merge.ts`: `buildLaunchConfig` の直接テスト、`buildLaunchArgs` / `requireDebugRequest` の throw 経路
- **変更**: 上記の失敗系マトリクスを網羅するテストを追加する。仕様の正は `docs/internal/specs/core.md`。テスト追加中に仕様とコードの食い違いを見つけたら、黙って合わせずに仕様確認を先に行う。
- **理由**: Phase 3-1（validate のテーブル駆動化）と 3-2（argsFile ロジック統合）はこれらの分岐を書き換える。ピン留めするテストなしに着手してはならない。

### 1-2. webview: App.tsx 内の純粋ロジックを .ts モジュールへ抽出してテスト [完了]

- **対象**: `packages/webview/src/App.tsx`
- **問題**: `updatePayload`（payload へのエントリデータ適用）、レスポンス型ガード群、`createPlaceholderProfile` / `createPlaceholderConfig` は純粋関数だが App.tsx 内にあるためテストされていない。webview のテスト基盤（`node --test` + esbuild、DOM なし）は plain .ts モジュールしかテストできず、同種の `mergeWorkspaceUpdatePayload`（`generateReadiness.ts`）はテスト済みという非対称がある。
- **変更**: 純粋ロジックを .ts モジュール（例: `payloadUpdates.ts`）へ移し、`test/build-tests.mjs` のビルド対象に追加してテストを書く。型ガード群は Phase 3-6（RPC 型付け）で削除予定なので、テスト対象は `updatePayload` を優先する。
- **理由**: Phase 4-3（App.tsx のフック分割）の前提。

### 1-3. extension: Webview HTML 書き換えを純関数化してテスト [完了]

- **対象**: `packages/extension/src/webview/editorPanel.ts` の `getWebviewHtml`
- **問題**: Vite が生成した `index.html` の asset パスを webview URI に書き換える正規表現処理が、テストスタブでは `node:fs` を差し替えられないため常に catch 分岐（"Webview assets are missing"）に落ち、カバレッジゼロである。Vite の出力形式変更（属性順、preload リンク等）で静かに壊れ得るホットスポットである。
- **変更**: 書き換え部分を純関数 `rewriteWebviewHtml(html, toWebviewUri)` として独立モジュールに抽出し、実際の Vite ビルド出力をキャプチャしたフィクスチャでテストする。fs 読み込みは editorPanel 側に残す。
- **検証**: 既存の editorPanel テスト + 新規ユニットテスト。実際に拡張を起動して Webview が表示されることも確認する。

---

## Phase 2: 型契約の一元化（構造上最大の改善） [完了]

`AGENTS.md` が明文化している「contracts / communication.md / messages.ts / webview types.ts / core types.ts の手動同期」をコンパイラ保証に置き換える。調査時点で技術的障害はない: `messages.ts` は vscode API に依存しておらず、core 型と plain data 型のみを参照している。webview は現在 core に依存していないが、型のみの import は Vite・esbuild 双方で消去されるためランタイムコストはない。

**この Phase は順序どおりに進める。**

### 2-1. TypeScript project references の導入 [完了]

- **対象**: `packages/core/tsconfig.json`（`composite: true`）、`packages/extension` / `packages/webview` の tsconfig（`references`）、ルートの `typecheck` スクリプト
- **問題**: extension の `typecheck` が core のビルドをスクリプト実行順序で肩代わりしている。webview → core の型依存を追加する（2-2）には、ビルド順序の保証をスクリプトの暗黙順序から `tsc -b` に移すのが安全である。
- **検証**: `npm run typecheck`、`npm run build` が通ること。core を変更した直後の typecheck が古い `dist` を見ない（参照経由で再ビルドされる）ことを確認する。

### 2-2. webview が core のデータ型を import する [完了]

- **対象**: `packages/webview/package.json`、`packages/webview/src/types.ts`
- **問題**: `types.ts` の冒頭部（`ProfileEntry` / `ProfileData` / `ConfigEntry` / `ConfigData` / `ProfileFileData` / `ConfigFileData`）は `packages/core/src/types.ts` と一字一句同一の手書きコピーである。
- **変更**: webview の `package.json` に `@launch-composer/core` を devDependencies として追加し、該当部分を `export type { ... } from '@launch-composer/core'` の re-export に置き換える。
- **検証**: `npm run build:webview`、`npm run test -w @launch-composer/webview`（テストバンドラも workspace 依存を解決できること）、および extension に webview 成果物を取り込んだ状態での動作確認。

### 2-3. メッセージ契約を共有モジュールへ移動 [完了]

- **対象**: `packages/extension/src/messages.ts` の全型、`packages/extension/src/io/workspaceStore.ts` の `ComposerDataIssue`、`packages/webview/src/types.ts` の残り全部
- **問題**: `GenerateDiagnostic` / `EditorTarget` / `InitialDataPayload` / `WorkspaceUpdatePayload` / `EntryPatchOperation` / `WebviewMessage` / `HostMessage` と `ComposerDataIssue` が extension と webview で二重定義されている。プロトコル変更のたびに 2 ファイルを人手で同期しており、片側だけ変えてもコンパイルは通ってしまう（実行時に型ガードが静かに desync する）。
- **変更**: これらの型を core 配下の契約モジュール（例: `packages/core/src/contracts.ts`、index から export）へ移動し、extension の `messages.ts` と webview の `types.ts` は薄い re-export にする（既存 import 元を壊さないため）。webview 側は最終的にファイル削除まで持っていってよい。
  - 注意: `GenerateDiagnosticTarget.kind: 'file'` と core の `ValidationErrorTarget.kind: 'configFile'` は**意図的に別の型**である（host 側で core の検証エラーを UI 向け診断へマップしている）。統合せず、両方を契約モジュールに併置する。
  - extension パッケージから直接 import させる案は不可: パッケージ `launch-composer` は `exports` マップを持たず、`@types/vscode` の型空間を引き込むため。
- **検証**: 3 パッケージの typecheck / 全テスト。ワイヤ上のメッセージ形状が変わっていないこと（editorPanel テストが posted message を検証している）。

### 2-4. EntryPatchOperation と JsonObjectPatchOperation の統合 [完了]

- **対象**: `packages/extension/src/messages.ts` の `EntryPatchOperation`、`packages/extension/src/io/json.ts` の `JsonObjectPatchOperation`
- **問題**: 構造的に同一の union が 2 箇所にあり、`editorPanel.ts` は webview から受けた `EntryPatchOperation[]` を `JsonObjectPatchOperation[]` を取る store メソッドへ渡している。形状が偶然一致しているから通っているだけで、片方が変わると離れた場所で不可解な型エラーになる。
- **変更**: 契約モジュール側の `EntryPatchOperation` を単一の定義とし、`json.ts` は `export type JsonObjectPatchOperation = EntryPatchOperation` として import する（ワイヤ形状は不変）。

### 2-5. ドキュメントと AGENTS.md の同期ルール更新 [完了]

- **対象**: `docs/internal/contracts/host-webview.md` / `json-files.md` の Ownership 節、`docs/internal/specs/communication.md`、`AGENTS.md` の Spec-First Change Routing
- **変更**: 「mirror source: `packages/webview/src/types.ts`」等のミラー行を削除し、「canonical 型を変更すれば消費側は import で追従する」という記述に改める。手動同期を要求する文面を残さないこと（この計画の目的が同期作業の廃止であるため）。

---

## Phase 3: 重複除去（低リスク・既存テストまたは Phase 1 のテストで保護）

各項目は独立。既存の公開 API・エクスポート名は維持し、呼び出し側とテストの変更を最小にする。

### 3-1. core: フィールド形状チェックのテーブル駆動化 [完了]

- **対象**: `packages/core/src/validate.ts` の `validateProfileEntries` / `validateConfigEntries`
- **問題**: 合計約 170 行が「`if (述語) errors.push(createValidationError({...}))`」の繰り返しで、field 名・述語・メッセージだけが異なる 9 個の同型ブロックである。フィールドが増えるたびに線形に伸びる。
- **変更**: `{ field, applies?, valid, message }` のルール配列 + 1 ループに置き換える。横断ルール（`validateNameUniqueness` / `validateConfigSemantics` / `validateArgsFile`)はテーブルに合わないので現状の関数のまま残す。`BLOCKED_OVERRIDE_KEYS` はデータとして維持する（`docs/internal/pending.md` に `configuration.program` を許可するかの保留課題があり、決定時に 1 行のデータ変更で済ませるため）。
- **前提**: Phase 1-1 のテストが先。エラーメッセージ文字列と `ValidationError` の形状を変えないこと。

### 3-2. core: argsFile ロジックの重複と到達不能な防御コードの整理 [完了]

- **対象**: `packages/core/src/generate.ts` の `resolveArgsForConfig` / `isStringArrayPayload`、`packages/core/src/merge.ts` の `ensureRequiredLaunchField` / `requireDebugRequest`
- **問題**:
  - `isStringArrayPayload` は validate.ts の `isArgsFileData` + `isStringArray` + `isRecord` の再実装である。
  - `generate` は `collectValidationState` がエラーゼロを返した後にしか `resolveArgsForConfig` へ進まない。その時点で `validateArgsFile` が全 argsFile を解決・読込・形状チェック済みで `argsFileCache` に格納しているため、generate 側の再読込とキャッシュミス時の throw 群は到達不能な防御コードである。
  - `merge.ts` の `ensureRequiredLaunchField` は欠落した `type` を黙って `''` に落とす。バリデーション後は到達不能だが、もし到達したらバグを隠蔽する方向に働く。
- **変更**: `resolveArgsForConfig` は `state.argsFileCache` を唯一のソースとし（ミス時は invariant 違反として明示的に throw）、再読込ロジックと `isStringArrayPayload` を削除する。共有型ガードは validate 側の実装に寄せる。merge の silent fallback は明示的な invariant エラーに置き換える。
- **前提**: 「validation エラーあり ⇒ generate は早期 return」という不変条件に依存する。この不変条件をコメントとして `generate` に明記し、キャッシュ消費のテストを追加する。

### 3-3. extension: ファイル読込 boilerplate の統一 [完了]

- **対象**: `packages/extension/src/io/workspaceStore.ts`
- **問題**: 「`vscode.workspace.fs.readFile` → `isMissingFileSystemError` 判定 → `decodeText`」のブロックが 5 箇所（`getDataFileRevision` / `readConfigFileResult` / `readArrayFile` / `readRequiredDataFileText` / `patchArrayEntry`）にコピーされ、missing 時の挙動（null 返却 / issue 返却 / throw）だけが異なる。
- **変更**: private `readTextFile(uri): Promise<{ status: 'ok'; text: string } | { status: 'missing' }>` を 1 つ作り、3 種の挙動は呼び出し側で導出する。
- **検証**: `workspaceStore.test.ts` が ENOENT / vscode / vscode-enoent の各エラースタイルを明示的にテストしているので、それが通ること。

### 3-4. extension: throw 版 / result 版パーサの統合 [完了]

- **対象**: `workspaceStore.ts` の `readConfigFileResult` vs `parseConfigFileContent`、`readArrayFile` vs `parseProfileEntries`
- **問題**: 「JSONC をパースして形状を確認する」ロジックが kind ごとに失敗チャネス違い（issue 返却 / throw）で二重実装され、形状チェックとエラーメッセージがコピペである。
- **変更**: kind ごとに result 返却版パーサ 1 本（`parseProfileDocument` / `parseConfigDocument`）+ throw が必要な呼び出し側用の一行 `unwrap` アダプタに統合する。エラーメッセージ文字列は変えない（テストが固定している）。

### 3-5. extension: コマンド登録の重複除去 [完了]

- **対象**: `packages/extension/src/extension.ts`
- **問題**:
  - 全コマンド本体が `try { ... } catch (error) { showError(error); }` を約 25 回繰り返している。
  - profile 用ファイルコマンド 7 種（add / openJson / copyPath / copyRelativePath / rename / delete / addEntry）が config 用にほぼ逐語コピーされている（約 120 行の重複）。kind 文字列とプロンプト文言だけが違う。
  - `promptForFileName` と `promptForRequiredValue` はバリデーションメッセージ文字列以外同一。
  - include/exclude 系 4 コマンドが同一の `onDidChange` ラムダをインラインで 4 回渡している。
- **変更**: `registerSafeCommand(id, handler)`（catch + showError を一元化）を導入し、`registerFileCommands(kind: 'profile' | 'config')` がコマンド ID と文言のテーブルから 7 コマンドを生成する形に統合する。プロンプト 2 関数は `promptForNonEmptyInput(placeHolder, requiredMessage, value?)` に統合。共有ラムダは関数に括り出す。
- **検証**: `extensionCommands.test.ts`(571 行)が init / add / rename / delete / include / exclude / clipboard の各フローを押さえている。ユーザー向け文言(プロンプト、エラー)を変えないこと。

### 3-6. webview: RPC の型付けと手書き型ガードの削除 [完了]

- **対象**: `packages/webview/src/utils/rpc.ts`、`packages/webview/src/App.tsx`
- **問題**: `sendRequest` の戻りが全レスポンス payload の union のため、呼び出し側が手書きガード（`isInitialDataPayload` / `isFileSelected` / `isUpdateResult` / `isRenameResult`）で再絞り込みしている。`isUpdateResult` と `isRenameResult` は構造的に同一で `generate-result` の payload も受理してしまい、実際には区別能力がない。`renameEntry` はガードの成否どちらでも `requestLatestPayload()` を呼ぶデッドロジックになっている。また `RpcClient.sendRequest` は reject もタイムアウトもせず、host が応答しない場合 pending resolver がリークする。
- **変更**: リクエストの `type` からレスポンス payload 型を引く mapped type で `sendRequest` を型付けし（`Extract<HostMessage, { type: 'update-result' }>['payload']` 方式）、App.tsx のガード 4 つと `renameEntry` のデッド分岐を削除する。タイムアウト（reject + pending クリア）を追加する。rpc.ts は DOM 非依存なので `node --test` でユニットテストを追加する。

### 3-7. webview: entryChanges の updater をファクトリに集約 [完了]

- **対象**: `packages/webview/src/components/entryChanges.ts`
- **問題**: 11 個の exported updater のうち、`updateProfileCwd` ≡ `updateConfigCwd`、`updateProfileStopAtEntry` ≡ `updateConfigStopAtEntry`、`updateProfileArgs` ≡ `updateConfigArgs` が本体完全同一のペア、`updateProfileType` ≡ `updateProfileRequest` がキー名違いのみ。さらに「データ更新」（editorUtils の `updateOptionalString` 等）と「パッチ生成」（`createOptionalStringPatch` 等）が同じ optional/required セマンティクス（trim して空なら削除）を二重に符号化している。
- **変更**: `updateConfigurationString(data, key, value, { required })` / `updateOptionalArrayField` / `updateBooleanConfigurationField` の 3 ファクトリに集約し、既存の名前付き export は 1 行ラッパーとして残す（コンポーネント呼び出し側と既存テストを変えないため)。可能なら「フィールドのセマンティクス記述子」1 つからデータ更新とパッチ生成の両方を導出し、二者が食い違えない構造にする。
- **検証**: `entryChanges.test.ts`（256 行）が data と patches の両出力を固定している。このパッケージで最も安全に着手できる項目である。

### 3-8. webview: select 状態パターンの共通化（任意） [完了]

- **対象**: `packages/webview/src/components/profileSelect.ts` / `profileRequestSelect.ts`
- **問題**: sentinel 定数 + internal 値ガード + `{value, options, optionLabels, helperMessage}` リゾルバという同型パターンの二重実装。profileSelect 内では同じ二分岐オブジェクトリテラルが 3 回繰り返されている。
- **変更**: 共有 `SelectState` インターフェースと小さなビルダー（`placeholderState` / `missingValueState`）を `selectState.ts` に抽出。完全統合まではしなくてよい。優先度は低い。

---

## Phase 4: 大型ファイルの分割（中リスク・Phase 1〜3 の完了が前提）

### 4-1. workspaceStore.ts（1,464 行）の責務分割

- **対象**: `packages/extension/src/io/workspaceStore.ts`
- **問題**: 1 クラスが 6 責務を混在させている: ①パス/URI/watcher パターン計算、②低レベル FS + テキスト codec + missing エラー正規化、③スナップショット読込/パース/issue 変換、④JSONC ミューテーション（add/patch/rename/delete/exclude、参照更新、名前一意性）、⑤Generate readiness 診断 + launch.json 生成、⑥`openDataFileAsJson` / `openEntryAsJson`（`vscode.window` を使うエディタ UI 操作。`io/` にあること自体がレイヤー違反）。
- **変更**: 以下に分割する。**`WorkspaceStore` は薄い facade として維持**し、既存の呼び出し 3 箇所と 974 行のテスト（public API を対象にしている）を壊さない。facade の解体は急がず、分割が安定してから判断する。
  - `io/workspaceLayout.ts` — パス / URI / パターン計算（コンストラクタが root URI を取る純粋層）
  - `io/dataFileIo.ts` — read/write/exists/readDirectory/ディレクトリ作成 + missing 正規化 + codec（Phase 3-3 の `readTextFile` を含む）
  - `io/dataFileParser.ts` — JSONC → `ok | invalid(issue)`（Phase 3-4 の成果物。`ComposerDataIssue` 生成を所有）
  - `io/workspaceReader.ts` — スナップショット組み立て（`readAll`、kind 別読込、`hasEntry`、`listProfileNames`）
  - `io/workspaceMutations.ts` — JSONC パッチ系全部
  - `generate/launchJsonService.ts` — readiness 診断マッピング + `generateLaunchJson` / `writeLaunchJson`（`@launch-composer/core` を import する唯一の場所）
  - `ui/jsonEditorOpener.ts` — `openDataFileAsJson` / `openEntryAsJson`（`vscode.window` 消費側）
- **順序**: Phase 3-3 / 3-4 を先に済ませてから移動する（移動と書き換えを同じ PR でやらない）。1 モジュールずつ抽出し、各段階でテストを通す。

### 4-2. extension.ts の activate()（約 740 行)の分解

- **対象**: `packages/extension/src/extension.ts`
- **問題**: `activate()` が共有ミュータブル状態を閉じ込めた巨大クロージャで、次の 4 責務を混在させている。いずれも `activate()` 全体を起動しないとテストできない。
  1. スナップショットキャッシュ + 同期キュー(`snapshotCache` / `syncQueue` / `syncUiWithWorkspace` 等。部分キャッシュの不変条件を持つ小さなステートマシン)
  2. watcher エコー抑制（`pendingWatcherEvents` / `shouldIgnoreWatcherEvent`）+ profile / config でコピーされた 6 つの watcher 登録ブロック
  3. issue 通知の重複排除（`activeIssues` / `reportIssues`）
  4. 約 30 個のコマンド登録
- **変更**:
  - `sync/workspaceSyncController.ts` — ①を抽出。store / providers / editorPanel へはインターフェース経由で依存。
  - `sync/watcherEchoFilter.ts` — ②のエコー抑制を抽出し、`registerDataWatcher(kind, pattern, sync)` ファクトリで watcher 登録 6 ブロックを統合。
  - `notifications/issueReporter.ts` — ③を抽出。
  - `commands/handlers.ts` — コマンドハンドラ本体を `{ store, editorPanel, sync }` を受ける関数群として移動（Phase 3-5 のテーブルと組み合わせる）。
  - `activate()` は生成と配線のみにする。`editorPanel` が宣言前にクロージャ参照されている現状の読みにくさも、この並べ替えで自然に解消する。
  - `EditorPanelOptions.onDidMutate` と `refreshViews` が構造的一致だけで結ばれている `{ kind, expectedWatchers, syncEditor }` 形状に共有型 `RefreshRequest` を定義し、両者で使う。
- **リスクと注意**: 同期キュー・キャッシュ・watcher 抑制カウンタの相互作用は繊細である。`extensionCommands.test.ts` が activate() 経由の E2E 安全網になるが、抽出後は各モジュールへの直接ユニットテストを追加すること（それがこの分割の主目的でもある）。

### 4-3. App.tsx（475 行)のフック分割

- **対象**: `packages/webview/src/App.tsx`
- **問題**: 1 コンポーネントが RPC 配線、逐次更新キュー + リビジョン管理（3 つの `useEffect` に分散し壊しやすい）、`vscode.getState/setState` 永続化、楽観的更新、表示の全てを持つ。
- **変更**（Phase 1-2、3-6 の完了後）:
  - `useComposerPayload(rpc)` — payload 状態、message リスナー、state 永続化、`requestLatestPayload`
  - `useEntryUpdateQueue(rpc, ...)` — `updateQueueRef` / `revisionRef` / `enqueueUpdate` / `renameEntry`。conflict 時の再取得パスを含む
  - `GenerateStatus` コンポーネントを独立ファイルへ（1 コンポーネント 1 ファイルの既存慣習に合わせる）
  - エディタ 2 分岐で約 40 行ずつ重複しているハンドラ配線（`onChange` / `onRename` / `onOpenJson` のインラインクロージャ）を `useEditorHandlers(editorTarget)` に集約。`readOnlyIssue` の条件付きスプレッドは、prop 型を `ComposerDataIssue | undefined` 受け入れに変えて解消。

### 4-4. ConfigEditor / ProfileEditor の共通化

- **対象**: `packages/webview/src/components/ConfigEditor.tsx` / `ProfileEditor.tsx`
- **問題**: 5 ブロックがほぼ逐語重複している（約 150〜200 行）: ①読み取り専用 JSON ステータス行、②blur/Enter でコミットする Name フィールド、③「changed-by-user ref + 同期 effect + debounce コミット」のテキストフィールドパターン×4 箇所、④Stop At Entry チェックボックス、⑤Args ListEditor + readOnly フォールバック。さらに ConfigEditor の `argsFile` フィールドだけ changed-by-user ガードが欠けている非対称があり、2 ファイルを diff しないと気づけない。
- **変更**:
  - `useEditableField(externalValue, autoSaveDelay, commit, { readOnly })` フックにパターン③を集約する。これにより argsFile のガード欠落は構造的に解消される。
  - `NameField` / `JsonStatusRow` / `StopAtEntryField` / `ArgsField` コンポーネントを抽出する。
- **リスクと注意**: この debounce + changed-by-user パターンは「エディタを開いただけでファイル書き込みが発生しない」ための仕組みである（コード内コメント参照）。**現在この層のテストはゼロ**。挙動を厳密に保存すること。テストを付けたい場合は、既存の `node --test` 基盤では React フックをテストできないため vitest + jsdom の最小導入が必要になる（`useEditableField` と `RpcClient` が最優先対象）。導入判断は独立に行ってよい。
  - 併せて `editorUtils.ts` の分割も行う: `useDebouncedCommit`(React フック)と純粋関数群が同居しており、これが同ファイルにテストがない原因である。フックを `hooks.ts` へ、残りを純粋モジュールへ分ける。

### 4-5. editorPanel.ts のハンドラ骨格統一

- **対象**: `packages/extension/src/webview/editorPanel.ts`
- **問題**: `deleteEntry` / `renameEntry` / `applyEntryPatch` が同じ骨格（store 操作 → `onDidMutate` → `syncWithWorkspace` → 成否レスポンス)を 3 回実装している。また `shouldPostWorkspaceUpdate` と `shouldSyncCurrentEditor` は `kind === 'both'` の基底値以外同一である。
- **変更**: `private runMutation(requestId, resultType, mutation)` にレスポンス送信と同期の流れを集約し、2 つの述語を `targetMatchesKind(kind)` で表現する。
- **注意**: 3 ハンドラのエラーポリシー不統一（rename / patch は失敗レスポンス後に rethrow して toast が二重表示、delete は握りつぶし）は観測可能な挙動なので、この項目では**現状のポリシー差を保存**し、統一は「[挙動変更を伴う項目](#挙動変更を伴う項目仕様更新とセットで行う)」の E-1 として別途行う。`editorPanel.test.ts`（940 行)が posted message を固定している。

---

## Phase 5: ビルド・設定の衛生化（任意順序・独立） [完了]

1. **esbuild ターゲット統一** [完了]: 本番バンドル（`packages/extension/esbuild.mjs`）は `node24`、テストバンドル(`packages/extension/test/build-tests.mjs`、`packages/webview/test/build-tests.mjs`）は `node20` と食い違っている。テストが通っても出荷物と構文レベルが違う。ルートの `engines.node >= 24` に合わせ `node24` に統一し、共有定数（例: `buildConfig.mjs`)に一元化する。
2. **tsconfig の lib 整合** [完了]: `packages/extension/tsconfig.json` が `"lib": ["ES2022"]` でベースの `target: ES2024` と不整合。override を削除するか ES2024 に揃える。
3. **ルート package.json の依存重複** [完了]: `jsonc-parser` / `react` / `react-dom` がルートと各パッケージの両方に宣言されている。npm workspaces では hoisting されるためルート側は冗長で、バージョン更新点が二重になる。ルート側を削除する(ルート直下に import する者がいないことは確認済み)。
4. **core バージョンの完全固定ピン** [完了]: `packages/extension/package.json` の `"@launch-composer/core": "0.1.1"` は core のバージョンを上げるたびに手動同期が要る。core は esbuild でバンドルされ runtime 依存として公開されないため、`"*"`(workspace 解決)にして同期点を消す。
5. **jsonc-parser の深部 import** [完了]: `packages/extension/src/io/json.ts` が `jsonc-parser/lib/esm/main.js` を import している。パッケージング変更に脆いのでルート import に変更する。※当初の「esbuild バンドル下でルート export は動作する」という記述は誤りだった: jsonc-parser の `main` は UMD ローダーを指し、esbuild の CJS バンドル内で遅延 `require()` が壊れる（`bundle.test.ts` がこれをガードしている）。実装では esbuild の `mainFields: ['module', 'main']`（`buildConfig.mjs` で共有）により ESM 解決へ切り替えたうえでルート import 化した。
6. **lint スクリプト** [完了]: ルート `package.json` の `lint` が 8 パスを列挙しており、新ディレクトリがサイレントにリント対象から漏れる。`eslint.config.mjs` の `ignores` は dist 等を除外済みなので `eslint .` に変更する。※実装時の発見: flat config の `ignores` は他のキーと同居するとグローバル ignore にならないため、専用オブジェクトへ分離する修正が必要だった。
7. **core の tsconfig 分割** [完了]: core は `test/**` を同じ tsconfig でコンパイルし `dist/test/` を生成する。`files: ["dist"]` のためコンパイル済みテストが公開物に混入し得る。また `test` スクリプトが毎回フルビルドを要求する。extension に倣い src 用と test 用の tsconfig を分ける。※実装ではテスト実行も他 2 パッケージと同じ esbuild バンドル方式（`test/build-tests.mjs` + `.test-dist`）に揃え、`dist` はフラット化（`dist/index.js`）した。

---

## 挙動変更を伴う項目（仕様更新とセットで行う）

以下は「リファクタリング」の枠を超える観測可能な挙動変更を含む。`AGENTS.md` の Spec-First Change Routing に従い、各項目を独立した変更として、`docs/internal/specs/extension.md`（および E-1 は `communication.md`）の更新とセットで行うこと。この計画のスコープには含めないが、調査で判明したため記録する。

### E-1. editorPanel のエラーポリシー統一

rename / patch は「失敗レスポンス送信 + rethrow による toast」の二重報告、delete は「失敗レスポンスのみ」と、同種の失敗に 3 通りの扱いがある。「webview が表示を所有し host は toast を出さない」等のポリシーを 1 つ選び、`docs/internal/specs/communication.md` に明文化したうえで統一する。`editorPanel.test.ts` が現状の挙動を固定しているため、テストの期待値変更が仕様変更の可視化になる。

### E-2. missing-file 判定の API ベース化

`workspaceStore.ts` の `isMissingFileSystemError` は `error.message` / `error.name` への正規表現マッチで missing を判定しており、テストスタブに 3 モードのエラースタイル切替機構（`setMissingPathErrorStyle`）まで生えている。公式には `vscode.FileSystemError.code === 'FileNotFound'` で判定できる。`instanceof vscode.FileSystemError && code === 'FileNotFound'`（+ raw Node エラー用の `code === 'ENOENT'` フォールバック)へ移行し、スタブの機構を簡略化する。**スタブの `FileSystemError` は現在 `.code` プロパティを持たないため、スタブ更新と同時に行うこと。** リモート FS プロバイダのエラー形状というエッジがあるため挙動隣接扱いとする。

### E-3. watcher パターンと store 読み取り範囲の不一致解消

watcher は `profiles/**/*.json`（再帰）を監視するが、store の `readDirectory` は直下しか読まず、エコー抑制のキーは basename のみである。`profiles/sub/x.json` のようなネストファイルは「監視はされるが読めず、同名の直下ファイルと抑制キーが衝突する」半端な状態にある。watcher パターンを `profiles/*.json` に狭めて 2 層のスコープを一致させるのが最小修正。ネストファイルの扱いは仕様が無言なので、`docs/internal/specs/extension.md` への明記とセットで行う。

---

## 実施順序と依存関係のまとめ

```text
Phase 0（完了）
  0-1 テストビルド glob 化 ── 0-3 の前提（treeProvider テスト復活） [完了]
  0-2 デッドコード削除 [完了]
  0-3 コマンド ID 定数化 [完了]

Phase 1（完了 / Phase 2〜4 の安全網）
  1-1 core テスト追加 ──────→ 3-1, 3-2 の前提 [完了]
  1-2 App.tsx 純粋ロジック抽出 → 4-3 の前提 [完了]
  1-3 HTML 書き換え純関数化 [完了]

Phase 2（完了: 2-1 → 2-2 → 2-3 → 2-4 → 2-5）
  2-1 TypeScript project references 導入 [完了]
  2-2 webview の core 型 re-export 化 [完了]
  2-3 メッセージ契約の core contracts 移動 [完了]
  2-4 EntryPatchOperation / JsonObjectPatchOperation 統合 [完了]
  2-5 docs / AGENTS 同期ルール更新 [完了]

Phase 3（各項目独立）
  3-1 core フィールド形状チェックのテーブル駆動化 [完了]
  3-2 core argsFile ロジックと到達不能防御コードの整理 [完了]
  3-3 extension ファイル読込 boilerplate の統一 [完了]
  3-4 extension throw/result パーサの統合 [完了]
  3-3, 3-4 ────────────────→ 4-1 の前提 [完了]
  3-5 extension コマンド登録の重複除去 [完了]
  3-5 ─────────────────────→ 4-2 と組み合わせる [完了]
  3-6 webview RPC 型付けと手書き型ガード削除 [完了]
  3-6 ─────────────────────→ 4-3 の前提 [完了]
  3-7 webview entryChanges updater ファクトリ集約 [完了]
  3-8 webview select 状態パターンの共通化 [完了]

Phase 4（対応する Phase 1 / 3 項目の後）
Phase 5（任意順序・いつでも）
挙動変更 E-1〜E-3（独立・仕様更新とセット）
```

投資対効果が最大なのは Phase 2（手動 3 面同期の恒久的廃止）と Phase 4-1 / 4-2（変更頻度最上位ファイルの変更コスト低減）である。Phase 3 の各項目は小さな独立 PR にでき、既存テストに守られているため、隙間時間に単独で進めてよい。
