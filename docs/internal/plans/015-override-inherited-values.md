# 改修計画: 継承値の表示と override の unset 復帰

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-26、commit `84dc330`(branch `feat-override-ui`)。状態: 進行中。

`docs/internal/pending.md` の「Show inherited values and support returning overrides to unset」(2026-07-20 UI boundary 調査)を昇格した UX 改修である。

## 背景と問題

profile-owned program モデルの決定([specs/core.md](../specs/core.md)、2026-07-20)により、config の役割は「profile が所有する実行物の実行パラメータを override するもの」と明示された。しかし config editor はその役割を表現できていない。

1. **継承値が不可視**: config editor は config 自身の値しか表示せず、profile から継承される実効値が見えない。override しているのか継承しているのかもフォームから読み取れない。
2. **checkbox field を unset に戻せない**: Stop At Entry は checkbox のため、未設定と明示的 `false` が同一表示になる。一度操作すると常に `true` / `false` が書かれ、GUI から key を未設定(=継承)に戻す手段がない。`cwd` はテキストを空にすれば key 削除で継承に戻れるが、その非対称も分かりにくい。
3. **profile editor にも同型の問題**: profile の Stop At Entry も一度操作すると `true` / `false` しか書けず、unset(= `launch.json` に key を出力せずアダプタ既定値に任せる)へ GUI から戻せない。

## 採用する設計(2026-07-26 決定)

フィールド毎の Override トグルを採用する。仕様は [specs/ui.md](../specs/ui.md) の「Override と継承値」(config editor)と「Stop At Entry の Set」(profile editor)に反映済みであり、そちらを正とする。要点:

- config の Working Directory / Stop At Entry に `Override` checkbox を付ける。override 状態は JSON の key 存在から導出し、UI 独自フラグは永続化しない。
- `Override` off: 値 control は disabled で継承値を表示(text は placeholder、checkbox は実効値)、key を削除する。
- `Override` on: boolean は表示中の実効値を即時 patch で書く。text は継承値を初期テキストとして編集可能にし、ユーザー編集の commit で初めて key を書く。
- profile の Stop At Entry には同型の `Set` checkbox を付ける(意味は「アダプタ既定値に任せるか明示するか」)。

**不採用案**: (a) VS Code 設定画面スタイル(modified indicator + Reset リンク)は、checkbox の unset / `false` の区別が indicator 頼みになり問題 2 を解きにくい。(b) boolean のみ 3 値 Select 化は、field 型ごとに操作パターンが割れ、pending 課題「GUI field set and pass-through key visibility」で検討する汎用 key-value エディタへフィールド単位パターンとして再利用できない。

## 影響範囲

- `packages/webview`: `ConfigEditor.tsx` / `ProfileEditor.tsx` / `StopAtEntryField.tsx` / `entryChanges.ts` / `styles.css` とテスト
- 通信契約・extension host・core は変更しない。保存は既存の set / delete leaf patch で完結する

## 作業手順

1. Phase 0(仕様): `ui.md` へ Override / Set 仕様を追記し、本計画を台帳へ登録する
2. `entryChanges.ts` に `configuration` leaf key の削除操作(`clearConfigCwd` / `clearConfigStopAtEntry` / `clearProfileStopAtEntry`)を追加し、テストで set / delete / no-op patch を検証する
3. `StopAtEntryField` を Override / Set トグル対応に拡張し、`ConfigEditor` / `ProfileEditor` を改修する
4. コンポーネントテストを追加する: override 状態の JSON からの導出、トグル操作で発行される patch、継承値の placeholder / 実効値表示、継承元 helper、read-only 時の disabled
5. 検証ゲート(`npm run format` / `lint` / `typecheck` / `test`)
