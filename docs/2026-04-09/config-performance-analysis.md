# Config パフォーマンス問題 調査レポート

## 概要

Config の有効無効切り替え時の遅延、および Config 設定変更時にサイドバーの Template セクションで不要なロードが発生する問題について調査を行った。

根本原因は **イベント伝播の設計** にある。具体的には以下の 3 つの問題が複合的に作用している。

1. **Config チェックボックストグルが FileSystemWatcher 経由の間接更新に依存** している
2. **`syncUiWithWorkspace` が常に全データ (`readAll`) を読み直し、Webview に全量送信** している
3. **Webview 側の単一 state 構造** により、Config 変更が Template 領域の再レンダリングを誘発する

---

## 問題 1: Config 有効無効切り替え時の遅延

### 症状

サイドバーの Config チェックボックスをトグルした際に、UI への反映にわずかな遅延がある。

### 原因: FileSystemWatcher を経由した間接的な UI 更新

チェックボックスのトグルハンドラ `handleConfigCheckboxChange` (`extension.ts:108-137`) は、ファイルへの書き込みのみを行い、**UI の更新を直接トリガーしない**。

```
ユーザー操作
  → handleConfigCheckboxChange (extension.ts:108)
    → store.toggleConfigEnabled / toggleConfigFileEnabled
      → writeConfigFile (workspaceStore.ts:807-819)  ... ファイル書き込み
        → [FileSystemWatcher が変更を検知]  ... OS レベルの遅延
          → configWatcher.onDidChange (extension.ts:222-226)
            → syncUiWithWorkspace({ kind: 'config' })
              → store.readAll()  ... 全ファイル再読み込み
                → applySnapshot → UI 更新
```

**遅延の発生箇所:**

| 箇所 | 内容 |
|------|------|
| `writeConfigFile` → `configWatcher.onDidChange` | FileSystemWatcher の検知遅延 (OS 依存、通常数十〜数百 ms) |
| `store.readAll()` | 全 Template + Config ファイルのディスク I/O |

### 対照的な設計

`handleConfigCheckboxChange` の末尾 (`extension.ts:137`) には `refreshViews()` や `syncUiWithWorkspace()` の呼び出しがない。同様のトグル操作を行う `enableConfig` / `disableConfig` コマンド (`extension.ts:599-604`) も、ファイル書き込み後に明示的な UI 更新を行っていない。

一方で、`deleteEntry`、`renameEntry`、`addConfigEntry` などの他の操作は、ファイル書き込み後に明示的に `syncUiWithWorkspace()` を呼び出している。

つまり、**トグル操作は FileSystemWatcher の発火に完全に依存しており、即座の UI フィードバックがない。**

---

## 問題 2: Config 変更時のサイドバー Template セクションの不要なロード

### 症状

Config の設定を変更すると、データ依存のないはずのサイドバー Template ツリーにもロード (再構築) が発生する。

### 原因の全体像

Config 変更時、以下の 2 つの経路で Template セクションに影響が波及する。

#### 経路 A: Extension 側 — `readAll()` が常に全データを読む

```
Config 変更
  → applyEntryPatch (editorPanel.ts:252-313)
    → store.patchConfigEntry → ファイル書き込み
    → onDidMutate() = refreshViews() (extension.ts:104-106)
      → syncUiWithWorkspace({ notifyIssues: false })  ← kind 未指定!
        → store.readAll()  ... Template ファイルも全て読み直し
          → applySnapshot(snapshot, 'both')  ← デフォルト値 'both'
            → templateProvider.refresh(snapshot)  ← Template ツリーも更新!
            → configProvider.refresh(snapshot)
```

**問題箇所:**

| ファイル | 行 | 問題 |
|----------|-----|------|
| `extension.ts:104-106` | `refreshViews` | `syncUiWithWorkspace` を `kind` 指定なしで呼び出し → デフォルト `'both'` |
| `extension.ts:92-102` | `syncUiWithWorkspace` | `options?.kind ?? 'both'` でデフォルトが `'both'` |
| `workspaceStore.ts:103-114` | `readAll` | Template と Config を常に両方読み込む (分離不可) |

`refreshViews` は `editorPanel` の `onDidMutate` コールバックとして登録されている (`extension.ts:192`)。Config パッチ適用成功時 (`editorPanel.ts:292`) に呼ばれるが、**`kind` パラメータを渡す手段がない。**

#### 経路 B: FileSystemWatcher の連鎖

Config ファイル書き込み後、FileSystemWatcher も同時に発火する。

```
patchConfigEntry → ファイル書き込み
  ↓ (同時に)
  ├→ onDidMutate → refreshViews → syncUiWithWorkspace(kind: 未指定 = 'both')
  └→ configWatcher.onDidChange → syncUiWithWorkspace(kind: 'config')
```

`configWatcher` 側は `kind: 'config'` を正しく指定しているが、`onDidMutate` 側が `kind: 'both'` で先に実行される可能性があり、結果的に **Template ツリーが不要にリフレッシュされる。**

さらに、2 つの `syncUiWithWorkspace` 呼び出しが競合し、**`readAll()` が短時間に 2 回実行される** 可能性がある。

#### 経路 C: Webview への全量送信

```
syncUiWithWorkspace (extension.ts:96-101)
  → store.readAll()
  → applySnapshot(snapshot, kind)  ... ツリーは kind で制御可能
  → editorPanel.syncWithWorkspaceData(snapshot)  ← kind 情報なし!
```

`editorPanel.syncWithWorkspaceData` (`editorPanel.ts:100-119`) は `kind` パラメータを受け取らず、常に **全データ (templates + configs + issues) を Webview に送信する**。

```typescript
// editorPanel.ts:324-325
const payload: InitialDataPayload = {
  ...snapshot,  // templates, configs, issues の全量
  editor: this.currentTarget,
  editorRevision: await this.options.store.getDataFileRevision(...),
  autoSaveDelay: getAutoSaveDelay(),
};
```

### Tree Provider のリフレッシュ動作

`LaunchComposerTreeProvider.refresh()` (`provider.ts:66-71`) は `fire(undefined)` で全ノードの再構築をトリガーする。

```typescript
refresh(snapshot?: WorkspaceDataSnapshot): void {
  this.snapshot = snapshot;
  this.fileNodes.clear();
  this.entryNodes.clear();
  this.didChangeTreeDataEmitter.fire(undefined);  // ツリー全体を再構築
}
```

`fire(undefined)` は VS Code の TreeDataProvider API において「ルートから全て再取得」を意味する。`applySnapshot` で `templateProvider.refresh(snapshot)` が呼ばれると、Template ツリーが全ノード再構築される。

---

## 問題 3: Webview 側の再レンダリング波及

### 単一 State 構造

`App.tsx:28-30` で `payload` を単一の `useState` で管理している。

```typescript
const [payload, setPayload] = useState<InitialDataPayload | null>(
  () => vscode.getState<InitialDataPayload>() ?? null,
);
```

`InitialDataPayload` は templates, configs, issues, editor, editorRevision, autoSaveDelay を全て含む。

### Config 変更時の再レンダリングチェーン

1. Config 変更 → `onChange` → `updatePayload` (`App.tsx:331-372`) が新しい `payload` オブジェクトを生成
2. `setPayload(nextPayload)` で React state 更新
3. `payload` 変更により `App` コンポーネント全体が再レンダリング
4. 毎回の再レンダリングで `templateCatalog` が再生成される (`App.tsx:218-220`):
   ```typescript
   const templateCatalog = payload.templates.flatMap(
     (fileData) => fileData.templates,
   );
   ```
5. `ConfigEditor` に新しい `templates` prop (参照が異なる) が渡される
6. `ConfigEditor` 内で template 関連の派生値が全て再計算される (`ConfigEditor.tsx:89-111`)

### Webview への `initial-data` メッセージによるリセット

Extension 側で `syncUiWithWorkspace` が実行されると、Webview に `initial-data` メッセージが送信される (`editorPanel.ts:118`)。

```typescript
// App.tsx:140-154
function onMessage(event: MessageEvent<HostMessage>) {
  if (rpc.handle(event.data)) {
    return;
  }

  const message = event.data;
  if (message.type !== 'initial-data') {
    return;
  }

  startTransition(() => {
    setPayload(message.payload);  // 全量置換
  });
}
```

この `setPayload` は **全データの参照を完全に置換する** ため、Config のみの変更であっても Template データの参照が変わり、Template 関連のあらゆる派生計算が再実行される。

### 最適化の欠如

| 最適化手法 | 状態 |
|-----------|------|
| `React.memo` (ConfigEditor / TemplateEditor) | 未使用 |
| `useMemo` (templateCatalog) | 未使用 |
| `useCallback` (onChange, onRename 等) | 未使用 |
| State の分離 (templates / configs を別 state に) | 未分離 |

---

## イベントフロー図

### Config 有効無効トグル (チェックボックス)

```
[User] チェックボックス クリック
  │
  ▼
configView.onDidChangeCheckboxState (extension.ts:231)
  │
  ▼
handleConfigCheckboxChange (extension.ts:108-137)
  │
  ▼
store.toggleConfigEnabled / toggleConfigFileEnabled
  │
  ▼
writeConfigFile (workspaceStore.ts:807-819)
  │                                ← 直接の UI 更新なし
  ▼
[FileSystemWatcher 検知待ち] ← 遅延発生箇所
  │
  ▼
configWatcher.onDidChange (extension.ts:222)
  │
  ▼
syncUiWithWorkspace({ kind: 'config' })
  │
  ├→ store.readAll()               ← Template も読み直し
  ├→ applySnapshot(snapshot, 'config')  ← Config ツリーのみ更新 (正しい)
  └→ editorPanel.syncWithWorkspaceData  ← 全データ Webview 送信
```

### Config エディタでの設定変更

```
[User] Config フィールド編集
  │
  ▼
ConfigEditor.onChange (App.tsx:302-313)
  │
  ├→ updatePayload → setPayload    ← Webview 全体再レンダリング
  │                                  (templateCatalog 再生成)
  │
  └→ enqueueUpdate → RPC 送信
       │
       ▼
     editorPanel.handleMessage (update-config)
       │
       ▼
     applyEntryPatch (editorPanel.ts:252-313)
       │
       ├→ store.patchConfigEntry → ファイル書き込み
       │     │
       │     └→ [FileSystemWatcher 発火]
       │          │
       │          ▼
       │        configWatcher.onDidChange
       │          │
       │          ▼
       │        syncUiWithWorkspace({ kind: 'config' })  ← 2 回目の sync
       │
       └→ onDidMutate = refreshViews (extension.ts:104)
            │
            ▼
          syncUiWithWorkspace({ kind: 未指定 = 'both' })  ← 1 回目の sync
            │
            ├→ store.readAll()              ← Template も読み直し
            ├→ templateProvider.refresh()   ← Template ツリー不要更新!
            ├→ configProvider.refresh()
            └→ editorPanel.syncWithWorkspaceData
                 │
                 ▼
               Webview に initial-data 送信 (全量)
                 │
                 ▼
               setPayload(全量)            ← 全コンポーネント再レンダリング
```

---

## 影響のまとめ

| 問題 | 影響箇所 | 重大度 |
|------|---------|--------|
| トグル時の FileSystemWatcher 依存 | チェックボックス操作の体感遅延 | 中 |
| `onDidMutate` → `refreshViews` の `kind` 未指定 | Template ツリーの不要な再構築 | 高 |
| `readAll()` が Template/Config を分離できない | Config 変更時の不要な Template ファイル I/O | 中 |
| `syncUiWithWorkspace` と FileSystemWatcher の二重発火 | 同一変更に対して 2 回の readAll + UI 更新 | 高 |
| `editorPanel.syncWithWorkspaceData` が全データ送信 | Webview の不要な再レンダリング | 中 |
| Webview の単一 `payload` state | Config 変更が Template 系コンポーネントに波及 | 中 |
| `templateCatalog` の毎回再生成 | 不要な計算と prop 参照の変更 | 低 |

---

## 問題箇所の一覧

### Extension 側

| ファイル | 行 | 問題 |
|----------|-----|------|
| `extension.ts` | 108-137 | `handleConfigCheckboxChange` がファイル書き込み後に UI 更新を呼ばない |
| `extension.ts` | 104-106 | `refreshViews` が `kind` 未指定で `syncUiWithWorkspace` を呼ぶ |
| `extension.ts` | 100 | `applySnapshot` のデフォルト `kind` が `'both'` |
| `extension.ts` | 101 | `editorPanel.syncWithWorkspaceData` に `kind` が渡されない |
| `extension.ts` | 222-226 | FileSystemWatcher が `onDidMutate` と同じタイミングで発火し二重更新 |
| `editorPanel.ts` | 292 | `onDidMutate()` が Config パッチ成功時に呼ばれるが kind 情報なし |
| `editorPanel.ts` | 100-119 | `syncWithWorkspaceData` が `kind` を区別せず全データ送信 |
| `editorPanel.ts` | 324-325 | `postInitialData` が常に全 snapshot を展開して送信 |
| `workspaceStore.ts` | 103-114 | `readAll()` が Template/Config の個別読み込みに対応していない |
| `provider.ts` | 66-71 | `refresh()` が `fire(undefined)` でツリー全体を再構築 |

### Webview 側

| ファイル | 行 | 問題 |
|----------|-----|------|
| `App.tsx` | 28-30 | 全データを単一の `useState` で管理 |
| `App.tsx` | 151-153 | `initial-data` 受信時に `setPayload` で全量置換 |
| `App.tsx` | 218-220 | `templateCatalog` が `useMemo` なしで毎レンダリング再生成 |
| `App.tsx` | 260-272, 302-314 | `onChange` が毎レンダリングで新しいクロージャを生成 |
