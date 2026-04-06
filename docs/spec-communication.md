# Launch Composer - Extension Host ↔ Webview 通信仕様

`launch-composer`（extension）と `@launch-composer/webview` の双方が参照する通信契約。メッセージ型・データ型はこのファイルが唯一の情報源。

---

## 概要

VSCode 拡張機能は Extension Host（Node.js プロセス）と Webview（ブラウザ相当の独立したコンテキスト）という2つの分離されたプロセスで動作する。両者は直接関数を呼び合えないため、VSCode の `postMessage` API でメッセージを交換する。

このファイルはその通信契約を定義する。Extension Host 側の `launch-composer`（extension）と Webview 側の `@launch-composer/webview` の双方がここで定義した型に従ってメッセージを送受信する。

主な通信の流れ:

- 編集パネルを開くと、Extension Host が初期データ（テンプレート・config の全ファイル内容）を Webview に送信する
- ユーザーがフォームを編集すると、Webview が編集中エントリへの差分と基準 revision を Extension Host に送信し、Extension Host が競合確認のうえ部分更新する
- 読み込み対象ファイルが一時的に不正な JSON の場合、Extension Host はそのファイルを `issues` として通知し、Webview は通常フォームを read-only 状態で表示する
- argsFile のブラウズダイアログや Generate などの操作は、Webview からリクエストを送り Extension Host がレスポンスを返す（`requestId` で対応付け）

---

## 1. Extension Host ↔ Webview 通信設計

Extension Host と Webview の間の通信設計を定める。

### 1.1 基本方針

Extension Host と Webview の間の通信における基本的な設計方針を以下に示す。

- 通信手段: Extension Host と Webview の間の通信には VSCode の `postMessage` API を使用する。
- 状態管理: 編集中は Webview 側の React state がデータのマスターとなる。フォームの変更は debounce（TextInput）または即時（Checkbox・Select・ListEditor）で Extension Host に送信し、Extension Host がファイルに書き込む。
- 競合制御: `initial-data` に現在の `editorRevision` を含める。Webview は自動保存ごとに `baseRevision` を添えて差分更新を要求し、Extension Host は現在の file revision と一致した場合のみ保存する。
- 競合解決: revision 不一致時は Extension Host が `update-result` で conflict を返し、Webview は最新の `initial-data` を再取得して外部変更を反映する。
- Webview 破棄対策: Webview Panel の生成時に `retainContextWhenHidden: true` を設定する。これにより、タブが非表示になっても DOM と state が破棄されずに保持される。

### 1.2 通信フロー

編集パネルを開いてからユーザーが操作するまでの、Extension Host と Webview 間のメッセージのやり取りを示す。

```
1. Webview が開く
   Extension Host → Webview: initial-data（テンプレート一覧、対象エントリのデータ）

2. ユーザーがフォームを編集
   Webview 内で React state を更新。

3. 自動保存（フォーム変更後）
   TextInput: launch-composer.autoSaveDelay ms の debounce 後に送信
   Checkbox / Select / ListEditor 操作: 変更と同時に即送信
   Webview → Extension Host: update-template / update-config（requestId 付き、baseRevision + patches を送信）
   Extension Host: revision を検証し、JSONC の該当エントリに差分だけを書き込む
   Extension Host → Webview: update-result
   conflict の場合: Webview は request-initial-data で最新状態を再取得する

4. ファイル選択ダイアログ（argsFile の Browse ボタン）
   Webview → Extension Host: browse-file（requestId 付き）
   Extension Host: vscode.window.showOpenDialog を呼び出し
   Extension Host → Webview: file-selected（同じ requestId 付き）
```

### 1.3 メッセージ型定義

リクエストとレスポンスの対応付けには `requestId` を使用する。`update-template` / `update-config` を含む、レスポンスを必要とするすべての Webview → Extension Host メッセージは `requestId: string` を持つ。`open-json` / `open-file-json` のみ fire-and-forget とする。

```typescript
// ============================================
// Webview → Extension Host
// ============================================
type WebviewMessage =
  // データ更新（自動保存）
  | {
      type: 'update-template';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  | {
      type: 'update-config';
      requestId: string;
      payload: {
        file: string;
        index: number;
        baseRevision: string | null;
        patches: EntryPatchOperation[];
      };
    }
  // 削除
  | {
      type: 'delete-template';
      requestId: string;
      payload: { file: string; index: number };
    }
  | {
      type: 'delete-config';
      requestId: string;
      payload: { file: string; index: number };
    }
  // 初期データ要求
  | { type: 'request-initial-data'; requestId: string }
  // 生成
  | { type: 'generate'; requestId: string }
  // ファイル選択ダイアログ
  | { type: 'browse-file'; requestId: string }
  // JSON を開く
  | { type: 'open-json'; payload: EditorTarget }
  | {
      type: 'open-file-json';
      payload: { kind: 'template' | 'config'; file: string };
    };

// ============================================
// Extension Host → Webview
// ============================================
type HostMessage =
  // 初期データ / 更新データ
  | {
      type: 'initial-data';
      requestId: string;
      payload: {
        templates: TemplateFileData[];
        configs: ConfigFileData[];
        issues: ComposerDataIssue[];
        editor: EditorTarget;
        editorRevision: string | null;
        autoSaveDelay: number;
      };
    }
  // 保存結果
  | {
      type: 'update-result';
      requestId: string;
      payload: {
        success: boolean;
        conflict?: boolean;
        revision?: string | null;
        error?: string;
      };
    }
  // 削除結果
  | {
      type: 'delete-result';
      requestId: string;
      payload: { success: boolean; error?: string };
    }
  // 生成結果
  | {
      type: 'generate-result';
      requestId: string;
      payload: { success: boolean; errors?: ValidationError[] };
    }
  // ファイル選択結果
  | {
      type: 'file-selected';
      requestId: string;
      payload: { path: string | null };
    };
```

### 1.4 requestId ユーティリティ

Webview 側に、requestId の生成と Promise の管理を行うヘルパー関数を用意する。この関数は内部で requestId を自動付与して `postMessage` を送信し、対応する requestId を持つレスポンスが返ってきたら Promise を resolve する。`update-template` / `update-config` もこの経路を使い、保存完了または conflict を明示的に受け取る。

```typescript
// 使用イメージ
const result = await sendRequest({ type: 'browse-file' });
```

実装は Map（requestId → Promise resolver）を管理する小さな関数で済む。

### 1.5 データ型

`TemplateData` / `ConfigData` は §4 のスキーマと対応する TypeScript 表現である。`TemplateFileData` / `ConfigFileData` は Extension Host が Webview に渡すファイル単位のコンテナである。`ValidationError` はコアのバリデーション結果を Webview に伝えるための型である。

```typescript
interface TemplateData {
  name: string;
  [key: string]: unknown; // パススルーキー
}

interface ConfigData {
  name: string;
  extends?: string;
  enabled: boolean;
  argsFile?: string;
  args?: string[];
  [key: string]: unknown; // パススルーキー
}

interface TemplateFileData {
  file: string; // ファイル名（例: "cpp.json"）
  templates: TemplateData[];
}

interface ConfigFileData {
  file: string; // ファイル名（例: "basic-test.json"）
  configs: ConfigData[];
}

interface ValidationError {
  file: string;
  configName?: string;
  field?: string;
  message: string;
}

interface EditorTarget {
  kind: 'template' | 'config';
  file: string;
  index: number;
}

type EntryPatchOperation =
  | {
      type: 'set';
      key: string;
      value: unknown;
    }
  | {
      type: 'delete';
      key: string;
    };

interface ComposerDataIssue {
  kind: 'template' | 'config';
  file: string;
  code: 'empty' | 'invalid-json' | 'not-array';
  message: string;
  details?: string;
}
```
