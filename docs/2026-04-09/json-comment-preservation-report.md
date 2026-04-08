# JSON コメント消失問題 調査レポート

## 概要

launch-composer の WebUI で config/template を編集すると、JSON ファイル内のコメントが消失する問題がある。VSCode の設定画面（Settings GUI）は同じ `jsonc-parser` ライブラリを使いながらコメントを適切に保持している。本レポートでは両者の実装を比較し、不具合・問題点を特定し、修正方針を提案する。

---

## 1. VSCode の Settings GUI の仕組み

### 1.1 アーキテクチャ: 「テキスト編集」方式

VSCode の Settings GUI は JSON ファイルを **JavaScript オブジェクトに変換して保持しない**。代わりに、元のテキストを保持したまま `jsonc-parser` の `modify()` を使って **テキストレベルで外科的に編集** する。

```
[VSCode のフロー]
settings.json (テキスト)
  ↓ GUI で表示するために parse() で読み取り
  ↓ ユーザーが GUI で値を変更
  ↓ modify(originalText, ['editor.fontSize'], 16, options)
  ↓ → EditOperation[] (offset, length, content) を計算
  ↓ applyEdits(originalText, edits)
  ↓ → 変更箇所のみ書き換えた新テキスト
settings.json (テキスト) に書き戻し
```

### 1.2 核心: `modify()` + `applyEdits()` の役割

- **`modify(text, path, value, options)`**: 指定パスの値を変更するために必要な **最小限のテキスト編集操作** を計算する。元テキストの構造（コメント、空白、フォーマット）は変更箇所以外一切触らない。
- **`applyEdits(text, edits)`**: 計算された編集操作を元テキストに適用する。

### 1.3 重要なポイント

- VSCode は **リーフレベル（末端プロパティ）** で `modify()` を呼ぶ。ネストされたオブジェクト全体を置換することはない。
- 例: `editor.fontSize` を変更する場合、`modify(text, ['editor.fontSize'], 14, opts)` であり、`modify(text, ['editor'], { fontSize: 14, tabSize: 4, ... }, opts)` **ではない**。
- これにより、変更対象外のプロパティに付いたコメントは完全に保持される。

### 1.4 VSCode の既知の制限

VSCode の Settings GUI にも制限がある（[GitHub Issue #75599](https://github.com/microsoft/vscode/issues/75599)）。設定値に直接紐づくコメントは、その設定値を GUI で変更すると消えることがある。ただし、**関係ないプロパティのコメントが消えることはない**。

---

## 2. launch-composer の現在の実装

### 2.1 使用ライブラリ

`jsonc-parser` v3.3.1（VSCode と同じライブラリ）

```typescript
// packages/extension/src/io/json.ts:1-8
import {
  applyEdits,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';
```

### 2.2 二つの書き込みパス

launch-composer には JSON ファイルを書き戻す **2 つのパス** が存在する。

#### パス A: テキストレベルパッチ（`applyArrayObjectPatch`）

```typescript
// packages/extension/src/io/json.ts:62-87
export function applyArrayObjectPatch(
  text: string,
  path: (string | number)[],
  patches: JsonObjectPatchOperation[],
): string {
  let nextText = text;
  for (const patch of patches) {
    const edits = modify(
      nextText,
      [...path, patch.key],
      patch.type === 'set' ? patch.value : undefined,
      { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } },
    );
    nextText = applyEdits(nextText, edits);
  }
  return nextText.endsWith('\n') ? nextText : `${nextText}\n`;
}
```

**使用箇所**: `patchTemplateEntry()`, `patchConfigEntry()`（WebUI からのフィールド編集時）

#### パス B: 全体書き換え（`stringifyJsonFile`）

```typescript
// packages/extension/src/io/json.ts:58-60
export function stringifyJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
```

**使用箇所**: `writeTemplateFile()`, `writeConfigFile()`（エントリの追加・削除・リネーム等）

---

## 3. 発見された問題点

### 問題 1: `JSON.stringify` による全コメント消失（重大度: 高）

**影響を受ける操作一覧:**

| 操作 | 呼び出し元 | 影響 |
|------|-----------|------|
| エントリ追加 | `addTemplateEntry()` → `writeTemplateFile()` | ファイル全体のコメント消失 |
| エントリ追加 | `addConfigEntry()` → `writeConfigFile()` | ファイル全体のコメント消失 |
| エントリ削除 | `deleteEntry()` → `writeTemplateFile()` / `writeConfigFile()` | ファイル全体のコメント消失 |
| エントリリネーム | `renameEntry()` → `writeTemplateFile()` / `writeConfigFile()` | ファイル全体のコメント消失 |
| Config 有効/無効切替 | `toggleConfigEnabled()` → `writeConfigFile()` | ファイル全体のコメント消失 |
| Config ファイル有効/無効切替 | `toggleConfigFileEnabled()` → `writeConfigFile()` | ファイル全体のコメント消失 |
| テンプレート参照更新 | `updateTemplateReferences()` → `writeConfigFile()` | ファイル全体のコメント消失 |

**根本原因**: これらの操作は全て以下のフローを通る:
1. `parseJsoncDocument()` でテキスト → JS オブジェクトに変換（コメント情報は捨てられる）
2. JS オブジェクトを変更
3. `JSON.stringify()` で再シリアライズ → コメントは全て消失

**VSCode との違い**: VSCode は常に `modify()` + `applyEdits()` を使い、テキストレベルで編集する。JS オブジェクトへの変換 → 再シリアライズは行わない。

### 問題 2: `configuration` サブツリーの丸ごと置換（重大度: 中）

WebUI からのフィールド編集（パス A）でも、`configuration` オブジェクト内のコメントは消失する。

**原因の流れ:**

1. ユーザーが WebUI で `program` を変更
2. エディタコンポーネントが新しい `configuration` オブジェクトを作成:
   ```typescript
   // TemplateEditor.tsx:104-109
   onChange(
     withConfiguration(
       data,
       updateOptionalString({ ...data.configuration }, 'program', value),
     ),
   );
   ```
3. `createEntryPatches()` が差分を計算:
   ```typescript
   // App.tsx:408-449
   // current.configuration と next.configuration を比較
   // → isEqualPatchValue() はオブジェクトの参照比較（===）を使用
   // → 常に「変更あり」と判定される
   ```
4. パッチが生成される:
   ```
   { type: 'set', key: 'configuration', value: { program: 'bar.js', type: 'node', request: 'launch' } }
   ```
5. `applyArrayObjectPatch()` が実行:
   ```
   modify(text, [index, 'configuration'], { ...entire object... }, options)
   ```
6. `configuration` オブジェクト全体が新しい JSON テキストで置換される → **内部のコメントが消失**

**具体例:**

```jsonc
// 変更前
[
  {
    "name": "my-template",
    "configuration": {
      // デバッガのタイプ
      "type": "node",
      "request": "launch",
      // 実行するファイルのパス
      "program": "${workspaceFolder}/src/index.ts"
    }
  }
]
```

ユーザーが WebUI で `program` のみ変更した場合:

```jsonc
// 変更後（期待される結果）
[
  {
    "name": "my-template",
    "configuration": {
      // デバッガのタイプ
      "type": "node",
      "request": "launch",
      // 実行するファイルのパス
      "program": "${workspaceFolder}/src/main.ts"
    }
  }
]

// 変更後（実際の結果）
[
  {
    "name": "my-template",
    "configuration": {
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/main.ts"
    }
  }
]
```

**VSCode との違い**: VSCode はリーフプロパティ単位で `modify()` を呼ぶため、`program` のみが変更され、他のプロパティに付いたコメントは保持される。

### 問題 3: `isEqualPatchValue` がオブジェクトを適切に比較しない（重大度: 中）

```typescript
// App.tsx:451-461
function isEqualPatchValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => entry === right[index]);
  }
  return left === right;  // オブジェクトは参照比較 → 常に false
}
```

**問題点:**
- オブジェクト（`configuration` など）は参照比較のみ → `{ ...data.configuration }` で新しい参照が作られるため **値が同じでも常に「変更あり」** と判定
- 配列の要素比較も浅い（`===`）→ 配列内にオブジェクトがある場合、同じ内容でも不一致と判定
- 不要なパッチが生成され、不要なファイル書き込みが発生する（パフォーマンス問題）

### 問題 4: パッチの粒度が粗い（重大度: 中）

`createEntryPatches()` はエントリの **トップレベルキーのみ** を比較する。

```typescript
// 生成されるパッチ（現状）
{ type: 'set', key: 'configuration', value: { ...entire object... } }

// 生成されるべきパッチ（理想）
{ type: 'set', key: 'configuration.program', value: '${workspaceFolder}/src/main.ts' }
// または、パスを使う方式:
// path: [index, 'configuration', 'program'], value: '...'
```

`configuration` 内の 1 プロパティだけ変更しても、`configuration` 全体が置換される。

---

## 4. VSCode との実装比較サマリ

| 観点 | VSCode Settings GUI | launch-composer |
|------|-------------------|-----------------|
| **データモデル** | 元テキストを保持、表示のみ parse | parse した JS オブジェクトを保持 |
| **編集方式** | `modify()` でテキストを直接編集 | 一部は `modify()`、多くは `JSON.stringify()` |
| **パッチ粒度** | リーフプロパティ単位 | トップレベルキー単位（`configuration` 全体） |
| **コメント保持** | 変更箇所以外は完全保持 | 多くの操作で全消失 |
| **等価性比較** | N/A（テキスト差分ベース） | 参照比較（オブジェクトは常に不一致） |
| **不要な書き込み** | 発生しない | `isEqualPatchValue` の問題で発生しうる |

---

## 5. 修正方針

### Phase 1: 全体書き換え操作の `modify()` 化（問題 1 の修正）

**目標**: `writeTemplateFile()` / `writeConfigFile()` による `JSON.stringify` を排除し、全ての操作で `modify()` + `applyEdits()` を使う。

#### 5.1.1 テキストベースのヘルパー関数を追加

`json.ts` に以下のテキスト編集ヘルパーを追加する:

```typescript
// 配列にエントリを追加（テキストレベル）
export function appendToArray(
  text: string,
  arrayPath: (string | number)[],
  value: unknown,
): string;

// 配列からエントリを削除（テキストレベル）
export function removeFromArray(
  text: string,
  path: (string | number)[],
  index: number,
): string;

// 単一プロパティを変更（テキストレベル）
export function modifyProperty(
  text: string,
  path: (string | number)[],
  value: unknown,
): string;
```

これらは全て内部で `modify()` + `applyEdits()` を使う。`jsonc-parser` の `modify()` は配列末尾への追加（`path: [arrayPath, -1]`）やプロパティの削除（`value: undefined`）もサポートしている。

#### 5.1.2 各操作を個別に変換

| 操作 | 現在の実装 | 修正後 |
|------|-----------|--------|
| `addTemplateEntry()` | 配列に push → `stringify` | raw text を読み、`modify(text, [-1], newEntry, opts)` で配列末尾に追加 |
| `addConfigEntry()` | 配列に push → `stringify` | raw text を読み、`modify(text, ['configurations', -1], newEntry, opts)` で追加 |
| `deleteEntry()` | splice → `stringify` | raw text を読み、`modify(text, [index], undefined, opts)` で配列要素を削除 |
| `renameEntry()` | オブジェクトのスプレッド → `stringify` | raw text を読み、`modify(text, [index, 'name'], newName, opts)` で名前のみ変更 |
| `toggleConfigEnabled()` | オブジェクトのスプレッド → `stringify` | `modify(text, ['configurations', index, 'enabled'], value, opts)` |
| `toggleConfigFileEnabled()` | 全体 → `stringify` | `modify(text, ['enabled'], value, opts)` |
| `updateTemplateReferences()` | 全体 → `stringify` | 各参照箇所で `modify(text, ['configurations', i, 'extends'], newName, opts)` |

#### 5.1.3 `writeTemplateFile` / `writeConfigFile` の段階的廃止

全ての呼び出し元がテキスト編集方式に移行した後、`writeTemplateFile` / `writeConfigFile` を削除（または新規ファイル作成用途のみに限定）。

### Phase 2: パッチ粒度の改善（問題 2, 3, 4 の修正）

**目標**: WebUI からのパッチを `configuration` 全体ではなく、変更されたプロパティ単位で生成する。

#### 5.2.1 `createEntryPatches` の再帰化

現状: トップレベルキーのみの浅い差分

```typescript
// 現状のパッチ
[{ type: 'set', key: 'configuration', value: { type: 'node', program: 'bar.js', request: 'launch' } }]
```

修正後: ネストされたオブジェクトも再帰的に差分を取る

```typescript
// 修正後のパッチ
[{ type: 'set', key: 'configuration.program', value: 'bar.js' }]
```

#### 5.2.2 `isEqualPatchValue` のディープ比較対応

```typescript
function isEqualPatchValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => isEqualPatchValue(entry, right[index]));
  }

  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    for (const key of keys) {
      if (!isEqualPatchValue(leftRecord[key], rightRecord[key])) return false;
    }
    return true;
  }

  return false;
}
```

#### 5.2.3 `applyArrayObjectPatch` のネストパス対応

パッチキーにドット区切りのパスをサポートするか、パッチ形式を拡張してネストされたパスを渡せるようにする。

```typescript
// 方式 A: ドット区切りキーをパスに展開
// patch.key = 'configuration.program'
// → modify(text, [...basePath, 'configuration', 'program'], value, opts)

// 方式 B: パッチ型にパス配列を追加
export type JsonObjectPatchOperation =
  | { type: 'set'; path: string[]; value: unknown }
  | { type: 'delete'; path: string[] };
```

### Phase 3: その他の改善

#### 5.3.1 不要なファイル書き込みの抑制

`isEqualPatchValue` の修正により、値が変わっていない `configuration` オブジェクトに対するパッチ生成がなくなり、不要な書き込みが削減される。

#### 5.3.2 共通の「テキスト編集→書き戻し」ユーティリティ

全ての書き込み操作が同じパターンを使うため、共通ユーティリティを作成:

```typescript
async function editJsonFile(
  uri: vscode.Uri,
  editor: (text: string) => string,
): Promise<void> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const text = decodeText(bytes);
  const nextText = editor(text);
  if (nextText !== text) {
    await vscode.workspace.fs.writeFile(uri, encodeText(nextText));
  }
}
```

---

## 6. 実装優先度

| 優先度 | 修正内容 | 影響範囲 | 工数見込 |
|--------|---------|---------|---------|
| **P1** | Phase 1: 全体書き換え操作の `modify()` 化 | 7 箇所の操作 | 中 |
| **P2** | Phase 2.2: `isEqualPatchValue` のディープ比較 | パッチ生成ロジック | 小 |
| **P3** | Phase 2.1 + 2.3: パッチ粒度の改善 | パッチ形式の変更、WebView + Extension 両方 | 中〜大 |
| **P4** | Phase 3: ユーティリティ整理 | リファクタリング | 小 |

### 推奨実装順序

1. **P2 → P1 → P3** の順で進める
2. P2（`isEqualPatchValue` 修正）は独立して即座に適用可能で、不要なパッチ生成を防ぐ
3. P1（全体書き換え排除）が最もインパクトが大きい修正
4. P3（パッチ粒度改善）は P1 完了後に進める（`configuration` 内コメント保持のため）

---

## 7. 関連ファイル一覧

| ファイル | 役割 |
|---------|------|
| `packages/extension/src/io/json.ts` | JSON パース・シリアライズ・パッチ適用 |
| `packages/extension/src/io/workspaceStore.ts` | ファイル読み書き・各操作の実装 |
| `packages/extension/src/webview/editorPanel.ts` | WebView ↔ Extension 間のメッセージハンドリング |
| `packages/webview/src/App.tsx` | パッチ生成・送信ロジック (`createEntryPatches`, `enqueueUpdate`) |
| `packages/webview/src/components/editorUtils.ts` | フォーム値の更新ユーティリティ |
| `packages/webview/src/components/TemplateEditor.tsx` | テンプレートエディタ UI |
| `packages/webview/src/components/ConfigEditor.tsx` | コンフィグエディタ UI |
| `packages/extension/src/messages.ts` | メッセージ型定義 |

---

## 8. テスト方針

修正後のテストでは以下を確認する:

1. **コメント保持テスト**: 各操作（追加・削除・リネーム・フィールド編集・有効/無効切替）実行後、変更対象外のコメントが保持されていること
2. **フォーマット保持テスト**: インデント、改行、trailing comma などの元のフォーマットが保持されていること
3. **機能回帰テスト**: 既存の全操作が正しく動作すること（パッチの適用結果が同じであること）
4. **コンフリクト検出テスト**: revision ベースのコンフリクト検出が引き続き正しく動作すること
5. **パフォーマンステスト**: 不要なファイル書き込みが発生しないこと（`isEqualPatchValue` 修正後）
