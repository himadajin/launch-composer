# 修正計画: core merge の参照共有と仕様乖離

進め方・ライフサイクルは [plans/README.md](./README.md) に従う。調査時点: 2026-07-19、commit `22a58d5`。状態: 未着手。

## 問題

`packages/core/src/merge.ts` の生成結果が、入力データおよび他の出力エントリと参照を共有しており、仕様(`docs/internal/specs/core.md` の「入力配列を破壊しない」)と乖離している。現状の呼び出し経路(生成直後に JSON 文字列化)では顕在化しないが、core の公開 API 契約として変更耐性がない。

### P1. `config.args` のみのケースで入力配列がそのまま出力にエイリアスされる【確信度: 高(実行で `out === input` を確認済み)】

- **場所**: `merge.ts` の `buildLaunchArgs`(調査時点 35 行の `return configArgs;`)
- **内容**: profile args も argsFile もない場合だけコピーせず入力の `config.args` 参照をそのまま返す(他の分岐は `[...]` でコピー)。`core.md`(調査時点 117 行)の「出力する場合は新しい配列を作る。入力配列を破壊しない」に反する。生成された `launchJson.configurations[].args` がワークスペースキャッシュ内の配列と共有され、どちらかを後から変更すると他方が壊れる潜在バグ。既存テストは `deepEqual` のみで同一性を検査していないため検出できない。

### P2. shallow merge によりネストオブジェクトが入力・全出力エントリ間で共有される【確信度: 中(設計問題)】

- **場所**: `merge.ts` の `buildLaunchConfig`(調査時点 8〜12 行)
- **内容**: スプレッドによる shallow merge のため、`profile.configuration.env` などのネスト値は入力 `ProfileData` と、同じ profile を参照する全出力 `LaunchConfig` の間で同一参照になる。args は仕様が明示的にコピーを要求しているのに、オブジェクトは無防備という一貫性のなさ。

### P3. `profile.configuration.args` と top-level args パイプラインの相互作用が未定義【確信度: 低〜中(設計上の穴)】

- **場所**: `merge.ts`(調査時点 8〜17 行)
- **内容**: `profile.configuration` に `args` を書くと、top-level args がすべて無い場合だけ生き残り、`config.args` があると黙って上書きされる。禁止キー検査は `program` / `type` / `request` のみで `args` を対象にしていないため、動作が入力の組み合わせで暗黙に変わる。

## Phase 0: 調査

1. `core.md` を精読し、次を仕様として確定する(Spec-First):
   - 出力の独立性の範囲: args 配列だけか、生成結果全体(deep copy / structuredClone)か。
   - `configuration.args`(パススルー内の args)を許可するか、禁止キーに加えるか、優先順位を明文化するか(P3)。`docs/internal/pending.md` の「Should configs be allowed to define `configuration.program`?」と同系の製品判断であり、決めきれなければ pending 送りにする。
2. 生成結果を保持・再利用している箇所(extension の snapshot キャッシュ等)を洗い出し、参照共有が現時点で実害に転じる経路がないか確認する。

## Phase 1: 修正

- P1: `buildLaunchArgs` の全分岐でコピーを返す。
- P2: Phase 0 の決定に従い、出力の独立性を保証する(生成結果全体のコピーが最も単純)。
- P3: 仕様決定に応じて検証または merge を修正する。

## Phase 2: テスト

- `deepEqual` に加えて参照の非同一性(`notStrictEqual`)を検証するテストを追加する。
- P3 の決定に対応する検証・merge のテスト。

## 検証

検証ゲート(format / lint / typecheck / test)。挙動変更は生成される JSON の形には現れない想定だが、`generate.test.ts` 全体が通ることを確認する。
