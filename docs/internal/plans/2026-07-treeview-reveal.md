# 修正計画: TreeView reveal の修正

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。

## 問題

エディタパネルを開いた際にツリー上の該当項目を選択・展開する `reveal` 経路(`extension.ts` の `revealTarget` → `provider.ts` の `reveal`)が、実装バグにより**常に no-op** になっている。【確信度: 高】

- **場所**: `packages/extension/src/treeview/provider.ts` の `reveal`(調査時点 196〜215 行)と `loadRootNodes`(同 217 行〜、`entryNodes.clear()` は 225 行)
- **内容(2 段のバグ)**:
  1. `reveal` は `await this.loadRootNodes()` の直後に `this.entryNodes.get(...)` でエントリノードを探すが、`loadRootNodes` は先頭で `entryNodes.clear()` を実行し、**file ノードしか作らない**(エントリノードは VS Code が `getChildren(fileElement)` を呼んだ時にのみ Map へ登録される)。したがって `get` は常に `undefined` で早期 return し、`view.reveal` に到達しない。
  2. 仮に到達しても、本プロバイダは `TreeDataProvider.getParent` を実装していないため、実 VS Code では `TreeView.reveal` が例外を投げる(API 仕様上 `getParent` 必須)。
- **検出されない理由**: テストスタブ(`test/stubs/vscode.ts`)の `reveal` が no-op のため、テストでは沈黙する。

## Phase 0: 調査

1. Extension Development Host で再現確認する(エディタを開いてもツリー項目が選択・展開されないこと)。
2. `docs/internal/specs/ui.md` / `extension.md` の reveal に関する規定(選択・フォーカス・展開のそれぞれの期待)を確認し、無規定なら明文化する。
3. 実装方針を決める。候補:
   - `loadRootNodes` がエントリノードまで構築して `entryNodes` を充填する(getChildren の遅延構築と二重にならないよう整理が必要)。
   - `reveal` 側で対象 file ノードの `getChildren` を明示的に辿ってからエントリノードを引く。
4. `getParent` の実装方法(ノードに親参照を持たせる/Map で引く)を決める。
5. テストスタブの `reveal` を「`getParent` で root まで辿れることを検証する」程度に強化できるか検討する(実 API の挙動をどこまで模倣するかの線引きを含む)。

## Phase 1: 修正

- `getParent` を実装する。
- `reveal` がエントリノードを確実に解決できるようにする。
- スタブの `reveal` を強化し、regression をテストで検出可能にする。

## Phase 2: テスト

- 「エディタを開いたとき、対象エントリのノードで `view.reveal` が select/expand オプション付きで呼ばれる」ことのテスト。
- `getParent` がエントリノード → file ノード → undefined(root)を返すことのテスト。

## 検証

検証ゲートに加え、実機でエディタを開いた際にツリー項目が選択・展開されることを確認する。
