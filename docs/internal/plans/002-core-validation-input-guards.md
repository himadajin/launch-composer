# 修正計画: core 検証の入力ガード

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 未着手。

## 問題

`validateGenerateInput` / `generate` は入力の各エントリが「非 null のオブジェクト」「正しい配列形状」である前提で書かれており、ユーザーが手編集した JSON がその前提を破ると検証エラーではなく**未処理例外**になる。extension 側のパーサ(`packages/extension/src/io/dataFileParser.ts`)はルートが配列かどうかしか検査せず、要素は型キャストのみで素通しするため、この前提破りは現実に到達する。

### P1. エントリが `null` / 非オブジェクトだと検証がクラッシュする【確信度: 高(実行再現済み)】

- **場所**: `packages/core/src/validate.ts` の `collectValidationState` / `validateProfileEntries` / `validateConfigEntries` 等、`profileRef.data.name` へ直接アクセスする箇所(調査時点 27 行、119 行付近ほか)
- **内容**: `profiles/x.json` に `[null]`、または `configs/x.json` の `configurations` に `null` を書くと、`data.name` アクセスで `TypeError: Cannot read properties of null (reading 'name')`。extension 側は `launchJsonService.ts` でこれを catch していないため、generate readiness 計算全体が未処理例外で落ちる。**ユーザーが JSON を手編集するだけで拡張の中核機能が壊れる**。

### P2. `profiles` が非配列/欠落だと `flattenProfiles` がクラッシュする(config 側と非対称)【確信度: 高(クラッシュ自体は再現済み)】

- **場所**: `packages/core/src/validate.ts` の `flattenProfiles`(調査時点 140〜148 行)
- **内容**: `flattenConfigs` は `Array.isArray` ガード + `validateConfigFiles` で検証エラー化するのに、`flattenProfiles` はガードなしで `fileData.profiles.map` を呼ぶ。extension 経由ではルート形状ガードにより通常到達しないが、core は公開 API であり防御レベルが非対称。

### 関連する軽微な問題(同時に扱うか Phase 0 で判断)

- **P3**: `profile` が空文字/欠落だと `configuration.program` / `type` / `request` の禁止キー検査がスキップされ、エラーが逐次的にしか出ない(`validateConfigSemantics` の早期 return。`core.md` の「エラーをまとめて返す」意図に反する)。【確信度: 中】
- **P4**: profile 名重複時、`profileMap` が後勝ちのため、argsFile 競合などの二次診断が「どの重複を基準にしたか」で変わる。【確信度: 中】
- **P5**: 空白のみの `name`(`"  "`)を有効名として受理する。【確信度: 低】
- **P6**: `resolveArgsFilePath` が複数の変数エラーのうち最後の 1 件しか報告しない(`packages/core/src/variables.ts`)。【確信度: 低】

## Phase 0: 調査

1. P1 / P2 の再現を extension 経由(手編集 JSON → readiness 計算)で確認し、クラッシュがユーザーにどう見えるか(通知・ツリー表示・webview)を記録する。
2. 防御をどの層に置くかを決める(Spec-First):
   - **案 A**: core の検証層でエントリ形状(非 null オブジェクト)を検証エラーとして報告する。`core.md` に「エントリ形状の検証」を追記。
   - **案 B**: extension のパーサ(`dataFileParser.ts`)で要素レベルの形状検証を行い、invalid file として扱う。`extension.md` / `docs/internal/contracts/json-files.md` に追記。
   - 両方に置く(core は公開 API として防御、extension はユーザー向け診断)のが安全だが、エラー報告の重複をどう扱うか決めること。
3. P3〜P6 をこの計画に含めるか、別途 `pending.md` 行きにするかを判断する。P3 は仕様(`core.md` のエラー列挙)との突き合わせが必要。

## Phase 1: 修正

Phase 0 で決めた層にガードを実装する。`flattenProfiles` / `flattenConfigs` の対称性を回復する。エラーメッセージは既存の `ValidationError` の形式・target 付与規則に合わせる。

## Phase 2: テスト

- core: エントリ `null` / 非オブジェクト / `profiles` 非配列 / `configurations` 非配列の各ケースが「クラッシュせず検証エラーになる」ことのテスト。
- extension: 手編集で壊れた JSON が invalid file(または診断)として UI に届くことのテスト。
- 調査で判明したその他のテスト欠落(excluded config も検証対象になること等)は、余力があればここで補う。

## 検証

検証ゲートに加え、`profiles/x.json` に `[null]` を書いた状態で拡張が正常動作(エラー表示のうえ generate ブロック)することを実機確認する。
