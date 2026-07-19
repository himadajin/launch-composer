# 修正計画: extension mutation の整合性

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 未着手。

## 問題

extension 側のファイル mutation(`packages/extension/src/io/workspaceMutations.ts`)に、同時実行・部分失敗・invalid ファイルまわりの整合性の穴がまとまって存在する。個々の発生頻度は低いが、いずれも lost update や参照不整合というデータ品質の問題につながる。

### P1. mutation の read-modify-write に排他がない【確信度: 中】

- **場所**: `workspaceMutations.ts` の `patchArrayEntry`(調査時点 221〜263 行)ほか各 mutation
- **内容**: 「読み込み → revision 比較 → (await を挟んで)書き込み」の間に他の mutation(ツリーのチェックボックス toggle や `toggleConfigExcluded` は revision チェック自体を持たない)や外部編集が割り込むと lost update になる。`WorkspaceSyncController` は sync(読み取り)だけを直列化しており、mutation は直列化されていない。webview 保存とツリー操作がほぼ同時に起きると片方の変更が消えうる。

### P2. profile の rename / delete が invalid な config ファイルの参照を無視する【確信度: 高(ロジックは明確)】

- **場所**: `workspaceMutations.ts` の `findConfigReferences`(調査時点 453〜466 行)/ `updateProfileReferences`(同 507〜543 行)、`workspaceReader.ts` の `readConfigsWithIssues`
- **内容**: 参照チェック・参照更新は parse エラーのある config ファイルを黙ってスキップする。invalid な config が profile X を参照していても X の削除が成功し(修復した瞬間に dangling reference)、rename では invalid config 内の `"profile"` 参照が更新されない。`extension.md` は invalid ファイルの扱いを規定していない。

### P3. `updateProfileReferences` の部分失敗で参照が不整合のまま確定する【確信度: 中】

- **場所**: `workspaceMutations.ts`(調査時点 412〜421 行で先に profile を書き、517〜542 行で `Promise.all` により config 群を更新)
- **内容**: config 側の 1 ファイルでも書き込みに失敗すると、profile 名は新名・一部 config は旧名参照のまま確定し、ロールバックがない。

### P4. 空パス patch で name 変更ガードを迂回できる【確信度: 中(現行 webview が送るかは未確認)】

- **場所**: `workspaceMutations.ts`(調査時点 209〜211 行)
- **内容**: `patch.path[0] === 'name'` のみ拒否するため、`{type:'set', path:[], value:{name:'newName',...}}` のようなエントリ全体置換 patch は通り、rename フロー(一意性検証・参照更新)を迂回して name を変更できる。`communication.md` の文言は `path[0] === 'name'` の拒否だが、意図は name 変更の全面禁止のはず。

### P5. `EditorPanelController.open` の並行呼び出しでパネルが二重生成されうる【確信度: 低】

- **場所**: `packages/extension/src/webview/editorPanel.ts`(調査時点 35〜54 行)
- **内容**: `open()` は `await store.readAll()` の後に `this.panel === undefined` を判定するため、2 つの `open` が同時に走る稀なケースで両方がパネルを生成し、片方がリークする。

## Phase 0: 調査

1. P1 の lost update を再現できるか確認する(テストで await 境界に割り込ませる形が現実的)。単一イベントループ上で実際に窓が開く操作列を特定する。
2. P2 / P3 の挙動を仕様として決める(Spec-First、`extension.md` の rename / delete 節):
   - invalid config が参照している可能性がある場合、削除・rename をブロックするか、警告付きで続行するか。
   - 参照更新の部分失敗時の扱い(残りを続行して結果を報告するか、順序を工夫して被害を限定するか)。
3. P1 の対処方針を決める(mutation を `WorkspaceSyncController` と同系の直列化キューに乗せるのが素直な候補)。
4. P4 は契約の意図を確認し、`communication.md` の文言を「name の変更につながる patch は拒否」に改める必要があるか判断する。
5. P5 は方針だけ決める(open の入口で in-flight Promise を共有する等)。優先度が見合わなければ `pending.md` 送りにしてよい。

## Phase 1: 修正

Phase 0 の決定に従い実装する。P1(直列化)を先に入れると P2〜P4 のテストが書きやすくなる可能性が高い。

## Phase 2: テスト

- 並行 mutation が直列化され lost update が起きないことのテスト。
- invalid config が絡む rename / delete の仕様どおりの挙動のテスト。
- 空パス patch・エントリ置換 patch が拒否されることのテスト。

## 検証

検証ゲートに加え、webview 編集とツリー操作を同時に行う操作列を実機で確認する。
