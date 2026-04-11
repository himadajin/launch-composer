# Launch Composer - Extension Host ↔ Webview 通信仕様

`launch-composer`（extension）と `@launch-composer/webview` の双方が参照する通信契約を定める。メッセージ型とデータ型はこのファイルを唯一の情報源とする。

---

## 概要

VSCode 拡張機能は、Extension Host（Node.js プロセス）と Webview（ブラウザ相当の独立したコンテキスト）の 2 つの分離されたプロセスで動作する。両者は直接関数を呼び合えないため、VSCode の `postMessage` API でメッセージを交換する。

このファイルは Extension Host と Webview の通信契約を定義する。Extension Host 側の `launch-composer`（extension）と Webview 側の `@launch-composer/webview` の双方は、このファイルで定義した型に従ってメッセージを送受信する。

主な通信の流れは次のとおり。

- 編集パネルを開くと、Extension Host が初期データ（profileおよび config の全ファイル内容）を Webview に送信する。
- ユーザーがフォームを編集すると、Webview が編集中エントリへの差分または rename 要求を Extension Host に送信する。
- 読み込み対象ファイルが一時的に不正な JSON である場合、Extension Host はそのファイルを `issues` として通知し、Webview は通常のフォームを read-only の状態で表示する。
- argsFile のブラウズダイアログや Generate のようにリクエストとレスポンスを必要とする操作では、Webview がリクエストを送信し、Extension Host がレスポンスを返す。リクエストとレスポンスは `requestId` で対応付ける。

---

## 1. Extension Host ↔ Webview 通信設計

Extension Host と Webview の間の通信設計を定める。

### 1.1 基本方針

基本的な設計方針を以下に示す。

- 通信手段: VSCode の `postMessage` API を使用する。
- 状態管理: 編集中は Webview 側の React state がデータのマスターとなる。フォームのうち `name` 以外のフィールドは、`<TextInput>` は debounce、`<Checkbox>`・`<Select>`・`<ListEditor>` は即時で Extension Host に差分を送信し、Extension Host がファイルに書き込む。`name` は専用の rename 要求で送信する。
- 競合制御: Extension Host は `initial-data` に現在の `editorRevision` を含めて送信する。Webview は差分パッチの保存ごとに `baseRevision` を添えて更新を要求し、Extension Host はその `baseRevision` が対象ファイルの最新 revision と一致した場合のみ保存する。
- 競合解決: revision が一致しない場合、Extension Host は `update-result` で conflict を返す。Webview はその応答を受けて最新の `initial-data` を再取得し、外部編集された内容を反映する。rename 要求は成功と失敗のどちらでも、その応答後に Webview が最新の `initial-data` を再取得して表示を同期する。
- Webview 破棄対策: Webview Panel の生成時に `retainContextWhenHidden: true` を設定する。この設定により、タブが非表示になっても DOM と state が破棄されずに保持される。

### 1.2 通信フロー

編集パネルを開いてからユーザーが操作するまでの、Extension Host と Webview の間のメッセージのやり取りを示す。

```
1. Webview が開く
   Extension Host → Webview: initial-data（profile一覧、対象エントリのデータ）

2. ユーザーがフォームを編集
   Webview 内で React state を更新。

3. 自動保存（フォーム変更後、`name` 以外）
   TextInput: launch-composer.autoSaveDelay ms の debounce 後に送信
   Checkbox / Select / ListEditor 操作: 変更と同時に即送信
   Webview → Extension Host: update-profile / update-config（requestId 付き、baseRevision + patches を送信）
   Extension Host: revision を検証し、JSONC の該当エントリに差分だけを書き込む
   Extension Host → Webview: update-result
   conflict の場合: Webview は request-initial-data で最新状態を再取得する

4. 名前変更
   Webview 内で `name` 入力を更新
   blur または Enter 確定時に Webview → Extension Host: rename-entry（requestId 付き、kind + file + index + name を送信）
   Extension Host: `renameEntry()` を呼び出し、必要なら profile 参照先 config の `profile` を更新する
   Extension Host → Webview: rename-result
   Webview: request-initial-data で最新状態を再取得する

5. ファイル選択ダイアログ（argsFile の Browse ボタン）
   Webview → Extension Host: browse-file（requestId 付き）
   Extension Host: vscode.window.showOpenDialog を呼び出し
   Extension Host → Webview: file-selected（同じ requestId 付き）

6. ワークスペース変更の自動通知
   ファイル変更検知時: Extension Host → Webview: workspace-update（変更種別・最新データ・issues）
   Webview: 受信データで React state を更新する
```

### 1.3 メッセージ型定義

リクエストとレスポンスの対応付けには `requestId` を使用する。`update-profile`・`update-config`・`rename-entry` を含め、レスポンスを必要とする Webview → Extension Host のメッセージはすべて `requestId: string` を持つ。`open-file-json` だけは fire-and-forget とする。

```typescript
// ============================================
// Webview → Extension Host
// ============================================
type WebviewMessage =
  // データ更新（自動保存）
  | {
      type: 'update-profile';
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
  | {
      type: 'rename-entry';
      requestId: string;
      payload: {
        kind: 'profile' | 'config';
        file: string;
        index: number;
        name: string;
      };
    }
  // 削除
  | {
      type: 'delete-profile';
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
  // source file の JSON を開く
  | {
      type: 'open-file-json';
      payload: { kind: 'profile' | 'config'; file: string };
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
        profiles: ProfileFileData[];
        configs: ConfigFileData[];
        issues: ComposerDataIssue[];
        editor: EditorTarget;
        editorRevision: string | null;
        autoSaveDelay: number;
      };
    }
  // ワークスペース変更通知
  | {
      type: 'workspace-update';
      requestId: string;
      payload: {
        kind: 'profile' | 'config';
        profiles?: ProfileFileData[];
        configs?: ConfigFileData[];
        issues: ComposerDataIssue[];
        editorRevision?: string | null;
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
  // 名前変更結果
  | {
      type: 'rename-result';
      requestId: string;
      payload: { success: boolean; error?: string };
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

Webview 側には、requestId の生成と Promise の管理を行うヘルパー関数を用意する。このヘルパー関数は内部で requestId を自動付与して `postMessage` を送信し、対応する requestId を持つレスポンスが返ってきたら Promise を resolve する。`update-profile`・`update-config`・`rename-entry` もこのヘルパー関数を使い、結果を明示的に受け取る。

```typescript
// 使用イメージ
const result = await sendRequest({ type: 'browse-file' });
```

実装は Map（requestId → Promise resolver）を管理する小さな関数で済む。

### 1.5 データ型

`ProfileData` と `ConfigData` は [spec.md](./spec.md) §4 のスキーマに対応する TypeScript 表現である。`ProfileFileData` と `ConfigFileData` は Extension Host が Webview に渡すファイル単位のコンテナである。`ValidationError` は `@launch-composer/core` のバリデーション結果を Webview に伝えるための型である。

```typescript
interface ProfileEntry {
  [key: string]: unknown;
}

interface ProfileData {
  name: string;
  args?: string[];
  configuration?: ProfileEntry;
}

interface ConfigEntry {
  [key: string]: unknown; // パススルーキーのみ
}

interface ConfigData {
  name: string;
  enabled?: boolean;
  profile: string;
  argsFile?: string;
  args?: string[];
  configuration?: ConfigEntry;
}

interface ProfileFileData {
  file: string; // ファイル名（例: "cpp.json"）
  profiles: ProfileData[];
}

interface ConfigFileData {
  file: string; // ファイル名（例: "basic-test.json"）
  enabled?: boolean;
  configurations: ConfigData[];
}

interface ValidationError {
  file: string;
  configName?: string;
  field?: string;
  message: string;
}

interface EditorTarget {
  kind: 'profile' | 'config';
  file: string;
  index: number;
}

type EntryPatchOperation =
  | {
      type: 'set';
      path: (string | number)[];
      value: unknown;
    }
  | {
      type: 'delete';
      path: (string | number)[];
    };

interface ComposerDataIssue {
  kind: 'profile' | 'config';
  file: string;
  code: 'empty' | 'invalid-json' | 'invalid-shape';
  message: string;
  details?: string;
}
```
